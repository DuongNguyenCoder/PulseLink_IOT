# PulseLink Architecture Overview

## Product

PulseLink is a service-call button system for cafes/restaurants. A physical ESP32 button produces an event; the backend stores it and sends best-effort push notifications to eligible Owner app installations.

## Current agreed stack

- Firmware: ESP32-S3-WROOM-1 N16R8, C/C++ with ESP-IDF, GPIO button, LED, Wi-Fi and NVS. WP08 adds a bounded persistent event retry queue; queue-full and NVS failure cases remain explicit limitations.
- App: PulseLink Owner application for account access, Store/device management, onboarding and operational push notifications. The repository currently contains no mobile app source.
- API: Node.js ESM, TypeScript, Fastify 5, Zod, Fastify's Pino logger.
- Database: PostgreSQL, Prisma 7.10, `@prisma/adapter-pg`, `pg`.
- Notifications: Firebase Cloud Messaging (FCM).
- Contracts: document HTTP payloads now; extract shared contract package when mobile/firmware integration stabilizes.
- Local infrastructure: Docker Compose; PostgreSQL host port may be 5433 if host 5432 is unavailable.

## High-level flow

1. An authenticated Owner account may enter onboarding; only an authorized Owner scope may complete a device claim.
2. The ESP32 enters physical-button-gated SoftAP pairing and exchanges a one-time bootstrap secret.
3. After claim, the device authenticates to the API with its separate operational bearer token.
4. When Wi-Fi and HTTPS are available, the device submits a button event with stable `eventId` and UTC `occurredAt`.
5. API validates the request, authenticates the device, and stores the event idempotently in PostgreSQL.
6. Backend selects active app installations with valid FCM tokens for eligible Owner accounts in the device's Store and sends best-effort notifications through FCM.

## Boundaries

- `firmware/esp32/`: hardware and embedded behavior.
- `server/api/`: HTTP API, domain services, persistence and notification integration.
- `apps/mobile/`: Owner-facing mobile app (future; absent in the current repository).
- `packages/contracts/`: shared, versioned contracts (future).
- `infrastructure/docker/`: local service configuration.
- `docs/`: architecture, standards, ADRs, runbooks and feature specs.

## MVP non-goals

Do not add a distributed broker, Kubernetes, microservices, Redis or multi-tenant authorization framework before a measured need exists. A PostgreSQL-backed durable event and notification record is the starting point.

## Reliability invariants

- An event ID is generated once by firmware and reused for retries, including after reboot while its NVS queue record remains.
- Database uniqueness is the source of truth for event idempotency.
- An event is acknowledged only after durable storage succeeds.
- The bounded firmware queue preserves up to eight offline events; delivery is still not guaranteed when the queue is full or storage fails.
- Notifications can be retried; duplicate sends must be considered possible.
- FCM registration tokens identify push destinations, not staff identity or authorization.
- One Owner account may have multiple app installations; each installation has its own session and FCM token lifecycle.
- Account/session, Store authorization and AppInstallation token-management runtime slices are implemented and test-backed; provisioning, event ingestion and FCM delivery remain future phases. This overview is not a production-readiness claim.
- Device credentials, app-user credentials and bootstrap pairing secrets are separate trust artifacts.
- A user may have memberships in multiple Stores; the backend derives active Store scope from authorized membership rather than trusting client-supplied role or Store data.
- Owners manage device claim and transfer. MVP does not implement a separate Staff account or invitation workflow.
- Secrets are never stored in plaintext when a hash or secret manager is appropriate.
- Store timezone is for presentation/scheduling; event timestamps are UTC.
