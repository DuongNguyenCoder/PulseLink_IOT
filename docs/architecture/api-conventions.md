# API Conventions

## Versioning

- Health and operational endpoints: `/health/*`.
- Business endpoints: `/v1/...`.
- Breaking contract changes require a versioning decision.

## Success responses

Use a stable response shape where it improves client handling. For simple health endpoints, a small purpose-built response is acceptable. For business endpoints, prefer:

```json
{
  "data": {},
  "meta": {
    "requestId": "..."
  }
}
```

## Error responses

Use:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "requestId": "..."
  }
}
```

Never expose stack traces, SQL statements, raw secrets or internal file paths. Validation details may be included only after ensuring they contain no secret values.

## Status codes

- `200`: successful read/action.
- `201`: resource created.
- `202`: accepted for asynchronous processing only after durable acceptance is defined.
- `400`: malformed/invalid request.
- `401`: missing/invalid device authentication.
- `403`: authenticated but not permitted.
- `404`: resource not found.
- `409`: idempotency conflict or state conflict where appropriate.
- `413`: payload too large.
- `429`: rate limit.
- `500`: unexpected server error.
- `503`: dependency unavailable/not ready.

## Validation

Every body, params and query input from outside the process must be validated at runtime with Zod. TypeScript types are not runtime validation.

## Idempotency

A duplicate event with the same `eventId` and identical meaning should not create another event. The API contract must explicitly decide whether a duplicate returns `200` with the existing result or `409`; document that choice and test it.

## Identity and Store scope

## Authentication route boundary

The authentication module exposes an injectable `/v1/auth` route plugin for
signup, email verification, login, refresh, logout and password reset. It
requires an externally supplied email sender, signing key and distributed
rate-limit implementation; those providers must not be hardcoded in the API
or replaced by production in-memory state. Protected routes use the reusable
database-authoritative authentication hook and must re-check Account status
and `authVersion`.

### Email verification link contract

The email verification link is an HTTPS landing flow at
`GET /verify-email?token={token}`. Opening the link validates only the token
shape, places the one-time token in a short-lived `Secure`, `HttpOnly`,
`SameSite=Strict` cookie and renders a confirmation page. It does not consume
the token on `GET`, protecting against link previews and security scanners.

The confirmation form submits `POST /verify-email/complete` with the browser's
`application/x-www-form-urlencoded` form media type and no token body; the
server accepts this bounded, ignored form body and reads the token only from
the protected cookie. Only that request calls the existing token-consumption
service. The existing API contract
`POST /v1/auth/verify-email` with `{ token }` remains available for mobile or
manual clients. Neither route returns the token or account details. Invalid,
expired and already-consumed tokens are rendered as a generic verification
failure by the landing flow and mapped through the existing API error contract
by the API route.

### First-installation login bootstrap

`POST /v1/auth/login` remains the authentication endpoint. For an existing
ACTIVE installation, the client may send the installation ID without changing
its stored FCM token. For a new installation, the request includes the
platform and may omit the FCM token. The server authenticates the Account
first, then atomically persists the installation and the Session that
references it. Access and refresh tokens are returned only after the
transaction commits. A revoked installation still follows the existing token
registration policy.

The installation ID is a client-generated destination identifier, not proof of
Account identity. The FCM token is never an identity or authorization proof and
must not be logged. A token already actively bound to another Account is not
automatically transferred by this flow. Missing FCM token material is
represented by NULL, never by a placeholder value. After login, the
authenticated client can register or refresh a token through
`POST /v1/installations/`.

- App-user authentication, operator authorization and device authentication are separate concerns.
- Owner authorization is Store-scoped; one Owner account may manage multiple Stores. A future membership model must preserve room for multiple members without making the Owner-only MVP depend on Staff UI.
- A provisioning or ownership-changing operation must carry an authenticated operator identity and an unambiguous Store scope; missing or ambiguous scope fails closed.
- Only an authorized Owner may claim or transfer a device. MVP does not implement a separate Staff account or invitation workflow.
- Device event requests derive Store ownership from the authenticated device and must not accept a device-supplied Store as authority.
- FCM registration tokens identify notification destinations only and do not grant access to users, devices or Stores.
- Store creation and metadata mutations require an active database membership; sensitive Store mutations append AuditEvent in the same transaction.
- Each app installation has an independent session and FCM-token lifecycle; adding an installation must not require device re-claiming or rotate the ESP32 credential.
- AppInstallation endpoints derive Account identity from the authenticated request. FCM ciphertext is never returned; a token already bound to another installation is rejected rather than silently rebound, and only one ACTIVE binding is allowed per fingerprint.
- The ACTIVE fingerprint uniqueness predicate is maintained by reviewed SQL because Prisma schema indexes cannot express the PostgreSQL partial predicate; future migration review must check for drift rather than expecting Prisma to model this index.

## Audit events

Security-sensitive mutations append an `AuditEvent` in the same Prisma transaction
as the business change. Audit metadata is allowlisted and sanitized; request bodies
and credentials are never copied into audit records. The application exposes no
normal update/delete path for audit events. The database role used by production
should be limited to INSERT/SELECT for this table, with retention of 365 days
managed operationally; no retention deletion job is part of the MVP.

- Physical reset clears local device configuration and requires authenticated backend reconnection/provisioning; it does not delete backend ownership, event history or audit history.
