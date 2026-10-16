---
name: pulselink-development
description: Implement and maintain PulseLink features consistently across firmware, API, database, notifications, and documentation. Use for feature work, bug fixes, schema changes, API endpoints, code reviews, or agent handoffs.
---

# PulseLink Development Skill

## Before coding

1. Read root `AGENTS.md`, `docs/architecture/overview.md`, and `docs/decisions/ADR-0001-stack.md`.
2. For API tasks, read `server/api/AGENTS.md`.
3. Inspect relevant source, package versions, schema, migrations and tests. Do not assume the repository matches an old chat.
4. Summarize the requirement, acceptance criteria, files to change, and risk before editing.
5. If the request is ambiguous or destructive, ask for clarification before proceeding.

## Required implementation loop

1. Plan the smallest complete change.
2. Implement one vertical slice, preserving existing conventions.
3. Validate all external input with Zod and keep business rules out of route handlers.
4. Add tests for success, invalid input, authorization and failure/retry paths as relevant.
5. Update docs and `.env.example` when behavior or configuration changes.
6. Run typecheck, build, tests and schema validation as applicable.
7. Report changed files, actual command outputs/results, assumptions and remaining risks.

## Backend patterns

- TypeScript ESM, Fastify 5, Zod, Fastify/Pino logger, Prisma 7.10, PostgreSQL.
- Prisma 7 PostgreSQL runtime uses `@prisma/adapter-pg` and `pg`.
- Keep one PrismaClient per API process; connect on startup and disconnect on shutdown.
- Separate `routes` (HTTP mapping), `schemas` (Zod contracts), `services` (business logic), and `repositories` only when a repository boundary provides value.
- Use a consistent response/error contract documented in `docs/architecture/api-conventions.md`.
- Never trust a device identifier alone as authentication.
- Persist event idempotency with a unique constraint on `eventId`; a retry must reuse the same event ID.
- Do not report an event as accepted until its durable database write succeeds.
- Push delivery is at-least-once unless a provider explicitly guarantees otherwise. Track each event/token attempt and make retries safe.

## Database safety

- Treat migrations as append-only history.
- Review generated SQL before applying a migration.
- Never run `migrate reset`, delete migration folders, or run destructive SQL without explicit user approval.
- Do not use `db push` as the normal shared-development workflow.
- Update schema, migration, generated client, tests and docs together when a model changes.
- Keep secrets out of seed data, logs and source control.

## Firmware/API contract

- Event payloads should be versionable and documented.
- ESP32 retries must reuse `eventId`; do not create a new ID for every HTTP retry.
- Include UTC `occurredAt`, firmware version and only bounded diagnostic fields.
- API should distinguish invalid payload, failed authentication, rate limit, transient server failure and duplicate event.
- Never place device secrets in firmware logs or expose them in API responses.

## Done checklist

- [ ] Acceptance criteria covered
- [ ] Zod validation and error mapping updated
- [ ] Tests added/updated
- [ ] `npm run typecheck` passes
- [ ] `npm run build` passes
- [ ] `npx prisma validate` passes if schema/config changed
- [ ] Docs updated
- [ ] No secrets or destructive/unrelated changes
