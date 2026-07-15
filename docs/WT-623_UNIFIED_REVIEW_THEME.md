# WT-623 — unified review theme

## Цель

Убрать ощущение двух разных приложений: прежде стартовая страница и формы
создания комнаты были светлыми, а активная private-review room — тёмной. Для
пользователя это разрывает сценарий «открыть сервис → создать комнату →
пригласить близкого человека → смотреть вместе».

## Область

- Входная страница, hero, preview stage, формы создания/входа, feedback,
  system status и закрытая room получают один dark private-review язык.
- Header, footer, primary action, borders, focus states и feedback/status
  сообщения используют палитру активной комнаты.
- `/operator` сознательно остаётся светлой служебной панелью: операторский
  инструмент не является частью пользовательского сценария просмотра.

## Реализация

- Dark shell включается CSS-селекторами только когда `AppShell` содержит
  `.home--entry` или `.home--room`; route `/operator` не наследует изменения.
- Entry workspace стал одной тёмной surface с media preview, а primary action
  использует тот же amber/coral/violet gradient, что и active room.
- Формы, feedback и system details получили контрастные dark surfaces и
  purple focus outline без изменения API, room lifecycle или media behavior.
- Mobile breakpoint сохраняет одну колонку и ширину private-review shell.

## Проверки

```bash
pnpm --filter @watch-together/frontend test
pnpm --filter @watch-together/frontend typecheck
pnpm format:check
pnpm check
```

## Границы и follow-up

- Это визуальная консолидация, а не redesign navigation и не новый media
  feature. Структура forms и доступные keyboard/focus states сохранены.
- Следующий UX-фокус после проверки темы: лёгкий onboarding для первого
  просмотра и stage reactions/анимации сообщений, которые пользователь
  обозначил как желаемые.
