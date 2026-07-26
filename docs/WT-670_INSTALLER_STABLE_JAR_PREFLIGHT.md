# WT-670 — согласовать installer preflight с именем backend JAR

## Инцидент

После WT-669 GitHub Actions успешно собирал backend под стабильным именем, но
installer preflight всё ещё проверял прежний файл с версией
`0.1.0-SNAPSHOT`. Поэтому Mac и Windows jobs останавливались до packaging.

## Исправление

Preflight использует то же имя `spectemus-simul-backend.jar`, что Gradle,
desktop runtime и electron-builder. Следующий installer workflow подтверждает
полную цепочку: build, preflight, packaging и install smoke на трёх платформах.
