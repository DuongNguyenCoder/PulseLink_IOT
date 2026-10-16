# ADR-0001: MVP stack and architecture

- Status: Accepted for MVP; revisit only with evidence or explicit approval.
- Date: 2026-10-10

## Decision
- Firmware: ESP32-S3 with ESP-IDF and C/C++.
- Backend: Node.js ESM + TypeScript + Fastify 5.
- Validation: Zod.
- Logging: Fastify built-in Pino logger.
- Persistence: PostgreSQL + Prisma 7.10 with PostgreSQL driver adapter.
- Push: Firebase Cloud Messaging.
- Local DB: Docker Compose.
- Architecture: modular monolith for the API.

## Rationale
- One API service is simpler to deploy and maintain for the first cafe.
- TypeScript contracts and Zod validation reduce mismatch between runtime input and static types.
- PostgreSQL uniqueness constraints support durable idempotency.
- Docker Compose makes local database setup repeatable.
- Modular boundaries preserve future extraction options without starting with distributed-system complexity.

## Consequences
- Prisma 7 PostgreSQL runtime requires `@prisma/adapter-pg` and `pg`.
- `prisma` and `@prisma/client` versions must be aligned.
- Database changes are managed through reviewed migrations.
- FCM delivery is external and may fail; delivery state and retry policy must be persisted.
- AI agents must not change this stack or upgrade major versions without approval.
