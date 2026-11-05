# SPS-719 — устранить уязвимости зависимостей

## Источник

Полный OSV scan на `main` после SPS-718:

- GitHub Actions run:
  https://github.com/Delakroa/spectemus-simul/actions/runs/42051922357
- Artifact: `osv-full-json` (`results.json`)
- HEAD: `1497cf8797202141fc347e8c13315b80c3bca13d`

`ci/osv-fixtures/known-vulnerable/package-lock.json.fixture` не трогали: это
намеренный fail-closed smoke для lodash 4.17.20.

## Стратегия

1. Прямые зависимости обновлены в текущих major-линиях.
2. Backend — через Spring Boot BOM 4.1.2 (без ручных Netty/Tomcat/Jackson
   overrides): BOM уже тянет безопасные линии.
3. Транзитивные npm findings без безопасного родителя — узкие
   `overrides` в `pnpm-workspace.yaml` (pnpm 11 больше не читает
   `package.json#pnpm`).
4. Lockfiles обновлены штатно: `pnpm install`,
   `./gradlew :backend:dependencies --write-locks`.

## Таблица обновлений

### Direct

| Компонент              | Было    | Стало   | Где                                      |
| ---------------------- | ------- | ------- | ---------------------------------------- |
| Spring Boot plugin/BOM | 4.1.0   | 4.1.2   | `backend/build.gradle.kts`               |
| electron               | 43.2.0  | 43.8.7  | `desktop/package.json`                   |
| electron-builder       | 26.15.3 | 26.18.1 | `desktop/package.json`                   |
| react-router-dom       | 7.18.1  | 7.18.5  | `frontend/package.json`                  |
| zod                    | 4.4.3   | 4.6.7   | `frontend/package.json`                  |
| vite (frontend)        | 8.1.3   | 8.1.6   | `frontend/package.json`                  |
| vite (POC)             | 6.4.3   | 6.4.5   | `poc/media-capture-livekit/package.json` |
| vitest                 | 4.1.10  | 4.1.12  | frontend + POC                           |
| eslint                 | 10.6.0  | 10.14.0 | `frontend/package.json`                  |

### Backend via Spring Boot 4.1.2 BOM (transitive)

| Компонент                | Было         | Стало через BOM 4.1.2 | OSV min         |
| ------------------------ | ------------ | --------------------- | --------------- |
| io.netty:netty-codec-dns | 4.2.15.Final | 4.2.19.Final          | 4.2.16.Final    |
| io.netty:netty-handler   | 4.2.15.Final | 4.2.19.Final          | 4.2.17.Final    |
| log4j-api                | 2.25.4       | 2.25.5                | 2.25.5 / 2.26.1 |
| tomcat-embed-core        | 11.0.22      | 11.0.27               | 11.0.25         |
| spring-webmvc            | 7.0.8        | 7.0.10                | 7.0.9           |
| jackson-core / databind  | 3.1.4        | 3.1.7                 | 3.1.7           |

### npm transitive (путь → override)

| Компонент                                                      | Было                    | Стало                   | Родительский путь                          | Override                 |
| -------------------------------------------------------------- | ----------------------- | ----------------------- | ------------------------------------------ | ------------------------ |
| @xmldom/xmldom                                                 | 0.8.13                  | 0.8.15                  | electron-builder → app-builder-lib → plist | да                       |
| brace-expansion 1/2/5                                          | 1.1.16 / 2.1.2 / 5.0.7  | 1.1.21 / 2.1.7 / 5.0.12 | electron-builder / eslint → minimatch      | да                       |
| minimatch 9/10                                                 | 9.0.9 / 10.2.5–10.2.6   | 11.0.4                  | @electron/universal, eslint                | да (`^9`/`^10` → 11.0.4) |
| js-yaml                                                        | 4.3.0                   | 4.3.2                   | electron-builder, swagger-parser           | да                       |
| tar                                                            | 7.5.20                  | 7.5.22                  | electron-builder / node-gyp                | да                       |
| undici 6/7                                                     | 6.27.0 / 7.28.0         | 6.29.1 / 7.30.2         | node-gyp; electron/@electron/get; jsdom    | да                       |
| fast-uri                                                       | 3.1.3                   | 3.1.9                   | ajv / swagger-parser / app-builder-lib     | да                       |
| postcss / nanoid / source-map-js                               | 8.5.16 / 3.3.15 / 1.2.1 | 8.5.23 / 3.3.18 / 1.2.2 | vite@6.4.5 / jsdom css-tree                | да                       |
| browserslist                                                   | 4.28.5                  | 4.29.5                  | @babel via eslint-plugin-react-hooks       | да                       |
| baseline-browser-mapping                                       | 2.10.42                 | 2.11.35                 | browserslist                               | да                       |
| @vitest/mocker / react-router / electron / vite / vitest / zod | —                       | закрыты прямыми bump    | direct                                     | нет                      |

## Почему overrides

Безопасного родительского релиза не хватало для:

- `electron-builder@26.18.1` (xmldom, js-yaml, tar, brace-expansion/minimatch);
- `eslint@10.14.0` / `@eslint/config-array` (minimatch всё ещё `^10`, а OSV чист
  только с 11.0.1+);
- `vite@6.4.5` (postcss всё ещё 8.5.16);
- `ajv@8.20.0` (fast-uri 3.1.3).

Overrides узкие по уязвимому major-диапазону (`pkg@^N` → safe), не по голому
имени пакета: будущий bump родителя на новый major не удерживается старым
пином. Удалять, когда родители подтянут безопасные версии сами.

## OSV до / после

До (artifact run 42051922357): 7 Maven + множество npm findings, exit 1.

После локально (`osv-scanner` v2.3.8):

```bash
osv-scanner scan --format=json -r .
# exit 0; product findings: 0
# scanned pnpm-lock.yaml + backend/gradle.lockfile
# .fixture не участвует в recursive scan
```

## Проверки

- `git diff --check` — без замечаний
- `pnpm install --frozen-lockfile` — ok
- `./gradlew :backend:test --no-daemon` — BUILD SUCCESSFUL, 143 теста
- `pnpm audit --prod --audit-level high` — No known vulnerabilities found
- `pnpm check` — успешно
  - frontend: 155 тестов
  - desktop: 58 тестов
  - media poc: 13 тестов
  - backend build/test: BUILD SUCCESSFUL
  - LAN scripts: 36, media poc scripts: 4, staging: 8
- Electron: `43.8.7`

## Риски совместимости

- `minimatch@11` через override на потребителях `^9`/`^10` (Electron tooling,
  ESLint): API близкий, но возможны edge-case в path matching.
- Vite POC остаётся на 6.x; frontend — на 8.1.6 (минимальный безопасный 8.x).
- Spring Boot 4.1.2 — patch в той же 4.1 линии, Java 25 сохранена.

## Откат

1. Вернуть версии в `backend/build.gradle.kts`, `desktop/frontend/poc`
   `package.json`.
2. Убрать блок `overrides` из `pnpm-workspace.yaml`.
3. `pnpm install` и `./gradlew :backend:dependencies --write-locks`.
4. Полный OSV снова станет красным — это ожидаемо до повторной remediation.

## Вне тикета

Internet mode, media pipeline, UI, suppressions OSV, ослабление Security Scan.
