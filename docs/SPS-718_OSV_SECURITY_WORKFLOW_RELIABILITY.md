# SPS-718 — сделать OSV Security Scan надёжным и честным

## Причина

`Security Scan` вызывал reusable workflows
`google/osv-scanner-action` `@v2.3.8`. После успешного сканирования PR job
пытался прокинуть полные JSON (`old-results` / `new-results`, ~181 КБ каждый)
через GitHub Actions job outputs и падал:

```text
Fail to evaluate job outputs
Maximum object size exceeded
```

Это инфраструктурный предел outputs, а не новая уязвимость из product-диффа.
При этом full scan на `main` / schedule действительно находит уязвимые
зависимости и должен падать именно из‑за findings (fail-closed).

## Исправление

Reusable OSV workflows убраны. В `.github/workflows/security-scan.yml` теперь
локальные jobs:

| Job                     | Когда                                 | Поведение                                                                                |
| ----------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------- |
| `Dependency review`     | `pull_request`                        | без изменений по смыслу; action закреплён на SHA                                         |
| `OSV PR scan`           | `pull_request`, `merge_group`         | base vs head JSON на диске → reporter → SARIF/artifact; падает только на **новых** vulns |
| `OSV full scan`         | `push`/`schedule`/`workflow_dispatch` | полный JSON → reporter с `fail-on-vuln=true`; падает на существующих findings            |
| `OSV fail-closed smoke` | всегда                                | pinned binary + известный уязвимый fixture; ожидает exit `1`                             |
| `Secret scan`           | всегда                                | gitleaks, без ослабления                                                                 |

Большие результаты больше не пишутся в `$GITHUB_OUTPUT`. JSON и SARIF
загружаются как artifacts и в Code Scanning.

Actions закреплены на commit SHA (`checkout`, `dependency-review-action`,
`osv-scanner-action` / `osv-reporter-action` v2.5.1, `upload-artifact`,
`codeql-action/upload-sarif`). Top-level `permissions: contents: read`;
`security-events: write` только у OSV jobs с SARIF.

`continue-on-error` стоит только на шаге **scanner** (как у upstream): бинарь
выходит с кодом 1 при findings, а решение о fail принимает **reporter** без
`continue-on-error` и без `fail-on-vuln: false`.

## PR scan vs full scan

- **PR scan** сравнивает результаты base и head. Уже известные уязвимости на
  `main` не валят PR. Новые — валят.
- **Full scan** смотрит только текущее дерево и падает, пока findings есть.
  Это намеренно: Security Scan на `main` остаётся красным до SPS-719.

## Fixture fail-closed

`ci/osv-fixtures/known-vulnerable/package-lock.json.fixture` фиксирует
`lodash@4.17.20`. Имя `.fixture` нужно, чтобы Dependency review и recursive
OSV scan не приняли его за product lockfile.

Smoke job копирует fixture во временный `package-lock.json` и требует
exit code `1`.

## Почему findings не подавлены

Полный локальный scan `pnpm-lock.yaml` / recursive tree показывает уязвимости
как минимум в Electron, fast-uri, js-yaml, minimatch, nanoid, postcss,
react-router, source-map-js, tar, undici, Vite, Vitest, Zod и ряде backend
библиотек. Их не чинят и не игнорируют в SPS-718. Follow-up: **SPS-719**.

## Команды и результаты

```bash
curl -fsSL -o /tmp/osv-scanner \
  https://github.com/google/osv-scanner/releases/download/v2.3.8/osv-scanner_darwin_arm64
chmod +x /tmp/osv-scanner

# Fixture must fail closed
mkdir -p /tmp/vuln-lock
cp ci/osv-fixtures/known-vulnerable/package-lock.json.fixture /tmp/vuln-lock/package-lock.json
/tmp/osv-scanner scan --format=table --lockfile=/tmp/vuln-lock/package-lock.json
# exit 1; lodash 4.17.20 → 4 GHSA

# Product lockfile still has real findings
/tmp/osv-scanner scan --format=json --lockfile=pnpm-lock.yaml
# exit 1; 18 packages / 83 vulnerability hits (undici, electron, vite, …)

# Recursive scan does not see the .fixture file as a lockfile
/tmp/osv-scanner scan --format=json -r .
# exit 1; product findings остаются, fixture lodash отсутствует
```

`git diff --check` — без замечаний.

`pnpm check` завершился успешно.

- frontend: 155 тестов в 31 файле
- desktop: 58 тестов
- backend build/test: BUILD SUCCESSFUL
- media poc: 13 тестов
- LAN scripts: 36, media poc scripts: 4, staging preflight: 8

## Откат

Вернуть `uses: google/osv-scanner-action/.../osv-scanner-reusable*.yml@v2.3.8`.
Снова появится `Maximum object size exceeded` на PR при крупных JSON.

## Вне тикета

- SPS-719: обновление уязвимых зависимостей до зелёного full scan.
- Product/backend/frontend код, массовый bump зависимостей, ослабление
  Dependency review / Secret scan.
