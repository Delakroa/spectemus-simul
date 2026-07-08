# Project Conventions

## Scope Control

Implement one backlog ticket per branch. Do not mix room lifecycle, media lifecycle, chat, voice, and infrastructure work in one change.

## Repository Boundaries

- `backend/` owns server-side product state and APIs.
- `frontend/` owns product UI and browser media lifecycle.
- `infra/` owns local and deployment infrastructure.
- `poc/` contains reference prototypes only.
- `docs/` contains ADRs, compatibility notes, quality notes, contracts, and handoff reports.

## Privacy

- Do not upload local movie files to the application backend.
- Do not log full local file paths.
- Do not commit real secrets.
- Do not put LiveKit API secrets in frontend code.

## Documentation

Each ticket should update the closest relevant document and include:

- how to run;
- what was verified;
- known limitations;
- next-ticket risks.

## Commands

Root commands should stay stable:

```bash
pnpm test
pnpm build
pnpm check
```

Ticket-specific commands may be added, but root checks must remain the main quality gate.
