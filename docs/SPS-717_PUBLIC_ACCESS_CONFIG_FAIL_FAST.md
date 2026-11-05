# SPS-717 — восстановить fail-fast public-access конфигурации

## Причина

`PublicAccessProperties` — record с compact constructor. В таком конструкторе
параметры можно нормализовать, но поля записи присваиваются только после
завершения тела. Метод `isEnabled()` читает поле `this.enabled`. В момент
вызова оно ещё хранит значение по умолчанию, а не параметр `enabled=true`.

Поэтому ветка обязательных проверок JDBC, identity pepper, Secure cookie и
SMTP не выполнялась. Включённый public access с пустой конфигурацией создавал
объект вместо остановки запуска. Это ломает инвариант WT-654: неполный
Internet mode не должен стартовать.

## Исправление

В compact constructor проверяется уже нормализованный параметр:

```java
if (Boolean.TRUE.equals(enabled)) {
```

`isEnabled()` по-прежнему читает поле, но только после создания объекта.
Сообщение об ошибке называет отсутствующий параметр и не содержит его значение,
пароль, pepper или email.

`enabled=null` и `enabled=false` остаются выключенными. В этом состоянии
PostgreSQL и SMTP не требуются. LAN `/api/v1` не меняется.
`PUBLIC_ACCESS_ENABLED` в примерах окружения остаётся `false`.

## Тесты

`PublicAccessPropertiesTest` проверяет:

- выключенный и `null` enabled без private configuration;
- отказ при пустых `jdbc-url`, `jdbc-username`, `jdbc-password`,
  `identity-pepper`;
- отказ при `cookie-secure=false`;
- отказ при пустых `email.host`, `email.username`, `email.password`,
  `email.from`;
- прежний отказ для порта вне диапазона 1–65535;
- успешное создание полной конфигурации с `isEnabled() == true`;
- отсутствие пароля, pepper и email в тексте ошибки.

`PublicAccessPropertiesBindingTest` поднимает узкий
`ApplicationContextRunner` только с binding `PublicAccessProperties`.
Настоящие PostgreSQL, Flyway и SMTP не запускаются. При `enabled=true` и
пустом `jdbc-url` создание контекста завершается `IllegalArgumentException`,
а сообщение не содержит тестовые credentials.

## Regression без исправления

Временный возврат к `if (isEnabled())` не коммитился.

Команда:

```bash
./gradlew :backend:test --no-daemon \
  --tests com.spectemus.simul.backend.publicaccess.PublicAccessPropertiesTest.rejectsEnabledAccessWhenJdbcUrlIsMissing
```

Результат: exit code 1.

```text
PublicAccessPropertiesTest > rejectsEnabledAccessWhenJdbcUrlIsMissing() FAILED
    java.lang.AssertionError at PublicAccessPropertiesTest.java:142
1 test completed, 1 failed
BUILD FAILED
REGRESS_EXIT=1
```

После возврата проверки параметра тот же тест входит в успешный прогон.

## Откат

Вернуть в compact constructor вызов `isEnabled()`. Это снова пропустит
неполную конфигурацию. Данные и LAN API откат не затрагивает.

## Вне тикета

LiveKit token, создание Internet room, `/api/v1`, новые `/api/v2` endpoints,
frontend, выбор режима, revoke/disconnect, TURN/WSS, миграции PostgreSQL,
настоящие SMTP/DB credentials, Windows FFmpeg installer и ручные сборки
installers.

## Проверки

`git diff --check` — без замечаний.

`./gradlew :backend:test --no-daemon` — BUILD SUCCESSFUL, 143 теста.

`pnpm check` завершился успешно.

- frontend: 155 тестов в 31 файле
- desktop: 58 тестов
- backend: 143 теста
- media poc: 13 тестов
- LAN scripts: 36, media poc scripts: 4, staging preflight: 8
