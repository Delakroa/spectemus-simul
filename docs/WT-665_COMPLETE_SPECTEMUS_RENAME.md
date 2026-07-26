# WT-665 — Завершение технического ребрендинга Spectemus Simul

## Решение

В preview действует **полный ребрендинг**, а не вариант «новое имя только в
интерфейсе». Старое имя `Watch Together` и его технические варианты не должны
оставаться в поставляемом продукте, рабочих командах или публичных контрактах.

Это намеренно несовместимое изменение допустимо сейчас: стабильного внешнего
API, опубликованных npm-пакетов и подписанного desktop release ещё нет. После
начала внешней beta такой migration был бы значительно дороже и потребовал бы
периода совместимости.

| Область                                    | Новое правило                         |
| ------------------------------------------ | ------------------------------------- |
| Название в интерфейсе                      | `Spectemus Simul`                     |
| Технический slug                           | `spectemus-simul`                     |
| Java package и Gradle group                | `com.spectemus.simul`                 |
| pnpm workspace scope                       | `@spectemus-simul/*`                  |
| Backend artifact                           | `spectemus-simul-backend`             |
| Compose project и dev data names           | `spectemus-simul`                     |
| Browser storage, Redis keys, test fixtures | `spectemusSimul` / `spectemus-simul`  |
| Contract schema ID и Problem Details type  | `https://spectemus-simul.invalid/...` |

Домен `.invalid` преднамеренно не претендует на будущий сайт продукта и не
может быть занят. Для JSON Schema ID и RFC 9457 problem type достаточно
стабильного URI-идентификатора; он не обязан быть доступным по сети. До
публичного API этот namespace фиксируется как часть контракта.

## Границы изменения

- Переименовать display text, баннер и ссылки на asset.
- Переименовать Java package, application class, workspace package names,
  Gradle artifact, Compose project, storage keys и конфигурационные prefixes.
- Заменить schema ID, `$ref` и Problem Details URI одновременно с контрактными
  примерами и тестами.
- Сохранить только нейтральные продуктовые слова вроде `co-watch` или
  `watch-party`, если они не являются прежним именем.
- Не добавлять Internet/TURN/cloud functionality и не менять поведение LAN
  комнаты: это отдельные задачи.

## Последствия для preview

- Обновление сбросит локальный operator token и текущие Redis room keys.
- Старые Docker volume и Compose containers не будут автоматически подхвачены
  новым project name. Для чистой developer-среды их можно остановить и удалить
  перед запуском новой конфигурации.
- Старые invite и старый desktop artifact не получают compatibility bridge.
  Комнаты preview эфемерны, поэтому это корректнее и безопаснее, чем оставлять
  параллельные brand namespace.

## Проверка

```bash
pnpm contracts:check
pnpm check:ci
pnpm desktop:prepare
git diff --check
rg -i 'watch[-_ ]?together|watchtogether' --glob '!**/node_modules/**' --glob '!**/.git/**' .
```

Последняя команда не должна находить старое имя как имя продукта или
идентификатор. Допустимы лишь записи в самом отчёте WT-665, где оно необходимо
для объяснения migration.

## Следующий приоритет после WT-665

Отдельно провести code review desktop + LAN слоя: запуск sidecar, выбор
физического адреса, gateway fallback, firewall и сценарий host/guest на двух
реальных компьютерах. Cloud hardening P5–P8 остаётся архитектурным заделом для
Internet alpha, но не опережает этот LAN quality gate.
