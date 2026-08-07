# AGENTS.md

## Project

Spectemus Simul is a private, local-media co-watch application. The host keeps
movie bytes locally; guests receive synchronized playback through LiveKit.

## Repository layout

- `backend/` — Spring Boot server-side product state, REST/WebSocket APIs, and
  Redis-backed room lifecycle.
- `frontend/` — React browser UI and browser media lifecycle.
- `desktop/` — Electron host application and packaging.
- `contracts/` — REST OpenAPI, WebSocket JSON Schemas, and examples.
- `infra/` — Docker Compose, LAN, and staging infrastructure.
- `e2e/` — Playwright multi-user tests.
- `poc/` — reference prototypes only; do not treat them as product code.
- `docs/` — ADRs, ticket notes, evidence, and project conventions.

Read `docs/CONVENTIONS.md` and the nearest README/ticket document before
changing a subsystem.

## Working rules

- Keep one change set focused on one backlog ticket or coherent bug fix.
- Keep user-facing text and documentation in Russian; keep code identifiers,
  protocol fields, and standard technical names in English.
- Preserve the backend/frontend/infra ownership boundaries above.
- Do not upload local movie files to the application backend, log full local
  file paths, commit secrets, or expose LiveKit API secrets to frontend code.
- Use root package-manager commands from the repository root. Use the Gradle
  wrapper rather than a system Gradle installation for backend tasks.

## Contracts and implementation

- `contracts/openapi.yaml` is the REST source of truth.
- `contracts/schemas/` is the source of truth for WebSocket and shared payloads.
- Add or update contracts and valid/invalid boundary tests with any product API
  or event change. Breaking changes need a new API version or `schemaVersion`.
- Validate all network and WebSocket payloads at the boundary. Unknown server
  events are ignored; unknown client commands are rejected.
- REST paths use lowercase nouns beneath `/api/v1`; external errors use
  `application/problem+json` and include a safe `correlationId`.
- Backend: prefer constructor injection, records for immutable DTOs, `Instant`
  in UTC, and explicit DTOs over untyped maps. Check permission and validation
  before changing authoritative state.
- Frontend: TypeScript stays strict, without `any` at API/media boundaries.
  Use runtime schema validation, avoid duplicating server room state, and clean
  up every network or media resource on effect teardown/reconnect.

## Tests and verification

Run the narrowest relevant check while iterating. Before handoff, run the
applicable root quality commands:

```bash
pnpm contracts:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check
```

Useful targeted commands:

```bash
pnpm backend:test
pnpm backend:build
pnpm backend:bootRun
pnpm dev:frontend
pnpm infra:up
pnpm infra:check
pnpm test:e2e
```

Add regression coverage for defect fixes and cover error, malformed-payload,
unknown-event/code, and stale-version paths where applicable. Do not claim a
check passed unless it was run successfully.

## Documentation and completion

Update the nearest README and relevant ticket document for product changes.
Record how to run and verify the change, known limitations, and risks/follow-up
work. Follow `docs/DEFINITION_OF_DONE.md`: no hidden TODOs/debug code, safe
configuration defaults, and no sensitive data in logs, errors, or fixtures.
