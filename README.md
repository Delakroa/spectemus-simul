# Watch Together

Watch Together is a private synchronized watching MVP. The host selects a local video file, creates a private room, and invites guests with one link. The application is not a video hosting service: movie bytes stay on the host machine.

## Current Status

P0 technical feasibility is complete.

- WT-001 proved local MP4 capture and LiveKit delivery.
- WT-002 documented the browser and codec boundary.
- WT-003 documented the first quality and latency baseline.
- WT-004 accepted the media pipeline decision and added a first playback-state data-channel prototype.

The repository is now in P1 foundation. WT-101 is complete: the monorepo layout is established and the P0 media PoC is preserved as a reference implementation. Product backend, React frontend, Redis/PostgreSQL infrastructure, rooms, chat, and voice are intentionally left for later tickets.

## Repository Layout

```text
backend/                    Future Spring Boot application, starts in WT-102.
frontend/                   Future React application, starts in WT-103.
infra/                      Future local/beta infrastructure, starts in WT-104.
docs/                       Plans, ADRs, compatibility and quality notes.
poc/media-capture-livekit/  P0 media pipeline proof of concept.
```

## Root Commands

Install dependencies from the repository root:

```bash
pnpm install
```

Run all currently implemented checks:

```bash
pnpm test
pnpm build
pnpm check
```

Run the P0 media PoC from the root:

```bash
pnpm dev:poc
```

Stop the PoC LiveKit container:

```bash
pnpm dev:poc:down
```

## P0 Reference

The media PoC remains available as a reference implementation in [poc/media-capture-livekit](poc/media-capture-livekit/README.md).

Important P0 documents:

- [WT-002 compatibility matrix](docs/WT-002_COMPATIBILITY_MATRIX.md)
- [WT-003 quality and latency](docs/WT-003_QUALITY_LATENCY.md)
- [WT-004 media pipeline ADR](docs/WT-004_MEDIA_PIPELINE_ADR.md)
- [WT-004 product-state prototype](docs/WT-004_PRODUCT_STATE.md)

## Foundation Rules

- Keep movie bytes out of backend services.
- Keep LiveKit as the media plane.
- Keep Spring Boot as the future authority for rooms, roles, access, state, tokens, presence, TTL, audit, and telemetry.
- Do not promote PoC token or room logic into product code without WT-301 and room lifecycle contracts.
- Put secrets in local `.env` files or secret storage only. Commit examples, never real values.
