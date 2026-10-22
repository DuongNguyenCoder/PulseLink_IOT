# Transactional notification outbox and worker

## MVP recipient source

The MVP uses active `StaffPushToken` rows whose `Staff` is active and belongs to the device's Store. `AppInstallation` is not used by this pipeline: its FCM value is encrypted and it has no `DeviceNotification` recipient relation yet. This avoids duplicate delivery and avoids treating an encrypted installation record as a sendable token.

## Event transaction

`POST /v1/device-events` authenticates the device and, for a new event, runs the `DeviceEvent` insert and `DeviceNotification` inserts in one PostgreSQL transaction. Each eligible `StaffPushToken` is snapshotted into one durable job. A duplicate event is resolved by the existing unique `eventId` invariant and creates no new jobs. FCM is never called by the HTTP request.

If a Store has no eligible staff token, the event is still durably accepted and zero jobs are created. The worker is independent of the request lifecycle.

## Worker claiming and retry

Run the worker with:

```powershell
npm run worker
```

The worker claims `PENDING` jobs and expired `PROCESSING` leases using PostgreSQL `FOR UPDATE SKIP LOCKED`. A claim increments `attempts` and sets a lease. If the process crashes, the expired lease can be claimed again. The default worker concurrency is 10 and the default lease is 60 seconds.

Transient FCM failures are rescheduled with bounded exponential backoff and jitter, up to five attempts. Invalid/unregistered tokens are deactivated and their job is marked `FAILED`. Other provider failures are stored as a bounded reason and marked `FAILED`. Delivery is at-least-once: a crash after FCM accepts a message but before the database update can result in a duplicate send; exactly-once delivery is not claimed.

## FCM configuration

Inject these values through the local environment or a secret manager; never commit them:

```text
FCM_PROJECT_ID
FCM_CLIENT_EMAIL
FCM_PRIVATE_KEY
```

`FCM_PRIVATE_KEY` may use `\\n` escapes. The worker uses Firebase Admin SDK and never logs credentials or FCM token values. Unit tests inject an `FcmSender` fake; PostgreSQL integration tests use the real database but do not call FCM.

## Database migration

Migration `20261016100000_notification_outbox_worker` adds `PROCESSING`, `nextAttemptAt`, `leaseUntil`, and claiming/retry indexes to `DeviceNotification`. It is additive and must be applied with the normal reviewed migration workflow. Do not use `migrate reset` or point integration commands at the development database.

Migration `20261016110000_notification_observability` adds the durable
`NotificationWorkerHeartbeat` table. Each worker upserts its heartbeat and
last processed timestamp; the API exposes queue diagnostics at
`GET /health/notifications` (with the configured
`X-Health-Diagnostics-Token` header in production). The response contains status counts, retry-ready
jobs, expired leases, oldest pending age, and worker heartbeat ages. It never
contains FCM tokens, payloads, or credentials.

The worker also keeps process-local counters for processed, sent, retried,
failed, invalid-token, and lease-recovery outcomes. Structured Pino logs record
bounded outcome fields and event-to-send latency. The queue is at-least-once;
an uncertain provider result can still cause a duplicate notification.

There is intentionally no unauthenticated replay endpoint. `FAILED` jobs are
terminal until an authenticated operations workflow is defined; adding replay
must reset the existing job in place and append an audit event rather than
creating a duplicate job.

For diagnosis, check `/health/live`, `/health/ready`, then
`/health/notifications`; compare `oldestPendingAgeSeconds`, `expiredLeases`,
worker heartbeat age, and the worker's structured outcome logs. Apply the
observability migration only to the intended database, for example the
dedicated `pulselink_test` database during integration verification.
