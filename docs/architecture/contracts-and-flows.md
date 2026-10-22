# Contracts, Trust Boundaries, and Critical Flows

## API conventions — proposed until confirmed in code

- Prefer an explicit `/v1` prefix for public API routes.
- Validate request params, query, headers and body at the boundary using Zod.
- Use UTC ISO-8601 timestamps on the wire.
- Use stable machine-readable error codes and a request/correlation ID.
- Never expose stack traces, SQL details, credentials, or secrets in client errors.
- Once deployed to firmware, maintain backward compatibility or explicitly version incompatible contract changes.

Example response envelope (proposal; align with existing API if already established):

```json
{
  "data": {},
  "requestId": "..."
}
```

Example error envelope (proposal):

```json
{
  "error": {
    "code": "REQUEST_INVALID",
    "message": "Request validation failed",
    "details": []
  },
  "requestId": "..."
}
```

## Trust artifacts

| Artifact                      | Principal/use         | Required handling                                                              |
| ----------------------------- | --------------------- | ------------------------------------------------------------------------------ |
| App session/access credential | Owner app → API       | TLS only; never log raw credential; revocable lifecycle                        |
| Refresh/session secret        | One app installation  | Rotate/revoke/expire according to selected auth design; hash where appropriate |
| Pairing bootstrap secret      | Physical pairing flow | Short-lived, single-use, attempt-limited; not an operational credential        |
| Device operational credential | One ESP32 → API       | High entropy, scoped to one device, revocable/rotatable; never log             |
| FCM registration token        | API → FCM destination | Per-installation lifecycle; destination only, not identity or authorization    |

## Pairing and claim flow

1. Authenticated Owner starts onboarding.
2. Device enters pairing only after a physical button-gated action.
3. A one-time bootstrap secret/challenge is exchanged over the setup flow.
4. API verifies expiry, single-use status, claim eligibility and Owner authorization for the target Store.
5. Claim binds the device to the Store atomically and issues a separate device operational credential.
6. Record audit details without recording raw secrets.
7. On transfer, revoke old device credentials and invalidate old Store association before issuing new credentials.

Details such as how the bootstrap secret is displayed/transferred remain open; do not invent a protocol without an approved design.

## Device event ingestion

Proposed payload shape; exact fields and event ID scope must be decided before release:

```json
{
  "eventId": "stable identifier generated once by firmware",
  "occurredAt": "2026-10-17T07:00:00.000Z",
  "eventType": "service_call",
  "schemaVersion": 1
}
```

Required semantics:

- Device identity and Store assignment are resolved server-side from the device credential.
- The event ID and occurrence timestamp are stable across retries.
- PostgreSQL uniqueness is the idempotency authority.
- Store event data and durable notification work in a transaction where applicable.
- Do not call FCM inside the event-ingestion database transaction.
- Acknowledge only after durable storage commits.
- A duplicate event ID is an idempotent success only when it is consistent with the original device/event; conflicting reuse should be rejected.

## Notification flow

1. Event and durable notification intent are committed.
2. A worker claims due jobs transactionally; multiple workers may use row locking such as `FOR UPDATE SKIP LOCKED` and a lease.
3. Provider calls happen outside the DB-locking transaction.
4. Record outcome per app installation.
5. Retry transient failures with bounded exponential backoff and jitter.
6. Deactivate a token only for confirmed invalid/unregistered-token responses, not generic failures.
7. Duplicate sends remain possible if provider accepted a send but the worker crashed before recording success.

## Firmware queue

- Queue capacity: up to eight offline events.
- Generate event ID once when accepting the physical press; persist the event before depending on network delivery.
- Retry with same event ID and `occurredAt`, including after reboot while the NVS record remains.
- Remove an item only after the API's durable-acceptance acknowledgment.
- Queue full, NVS write failure, power loss during mutation and damaged/corrupt storage are explicit reliability boundaries.
- Use bounded backoff with jitter; do not reconnect in a tight loop.
