# WT-101 Monorepo Foundation

## Status

Closed on 2026-07-08.

## Goal

Create the repository structure for the product MVP while preserving the P0 media PoC as a reference implementation.

## Scope

- Root workspace and root commands.
- `backend/`, `frontend/`, `infra/`, `docs/`, and `poc/` boundaries.
- Project README.
- Editor and ignore conventions.
- Existing PoC moved under `poc/media-capture-livekit`.

## Out of Scope

- Spring Boot application code.
- React application code.
- Redis/PostgreSQL compose stack.
- Reverse proxy.
- Product room lifecycle.
- Product LiveKit token flow.

## Acceptance Criteria

- The repository has explicit product and PoC boundaries.
- Root `pnpm test`, `pnpm build`, and `pnpm check` are documented.
- The P0 PoC remains runnable from the root through `pnpm dev:poc`.
- No real secrets are introduced.

## Verification

Executed after the monorepo move and before closing WT-101:

```bash
pnpm test
pnpm build
pnpm check
```

Result:

- 3 test files passed.
- 13 tests passed.
- production build passed.
- Vite reported only the existing large chunk warning for the PoC bundle.

## Agent Report

Done:

- moved the P0 PoC into `poc/media-capture-livekit`;
- added root workspace scripts;
- added `backend`, `frontend`, and `infra` ownership placeholders;
- added editor and repository conventions;
- updated the root README and PoC README.

Known limitation:

- WT-101 intentionally does not create runnable backend, frontend, or infrastructure applications. Those are owned by WT-102, WT-103, and WT-104.

## Next Tickets

- WT-102: Spring Boot backend skeleton.
- WT-103: React frontend skeleton.
- WT-104: local infrastructure stack.
