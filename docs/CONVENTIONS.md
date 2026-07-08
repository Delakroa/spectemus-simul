# Конвенции проекта

## Контроль области

Одна branch — один backlog ticket. Не смешивать room lifecycle, media lifecycle, chat, voice и infrastructure work в одном изменении.

## Границы репозитория

- `backend/` отвечает за server-side product state и APIs.
- `frontend/` отвечает за product UI и browser media lifecycle.
- `infra/` отвечает за local и deployment infrastructure.
- `poc/` содержит только reference prototypes.
- `docs/` содержит ADR, compatibility notes, quality notes, contracts и handoff reports.

## Приватность

- Не загружать локальные movie files в application backend.
- Не логировать полные local file paths.
- Не коммитить реальные секреты.
- Не помещать LiveKit API secrets во frontend code.

## Документация

Каждый тикет должен обновлять ближайший релевантный документ и фиксировать:

- как запускать;
- что было проверено;
- известные ограничения;
- риски для следующих тикетов.

## Команды

Root commands должны оставаться стабильными:

```bash
pnpm test
pnpm build
pnpm check
```

Ticket-specific commands можно добавлять, но root checks должны оставаться основным quality gate.
