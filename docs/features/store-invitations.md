# Store Invitations

## Scope

Store invitations are a pending workflow separate from `StoreMembership`.
Creating an invitation never grants Store access. Access is granted only when
the intended, authenticated Account accepts a valid invitation.

The current policy allows only an active Store `OWNER` to manage invitations,
and invitations can grant `STAFF` only. Owner transfer is outside this flow.

## Lifecycle

```text
PENDING -> ACCEPTED
PENDING -> REVOKED
PENDING -> EXPIRED
EXPIRED -> PENDING       (resend)
```

`ACCEPTED`, `REVOKED` and `EXPIRED` invitations cannot be accepted. A pending
invitation expires after seven days. Expiry is checked server-side; list and
inspection responses report an expired pending row as `EXPIRED`, and acceptance
persists the terminal status.

There is at most one `PENDING` invitation for a Store and normalized recipient
email. The database partial unique index is the concurrency backstop; a
duplicate create returns `409`.

## Token security

The API generates 32 random bytes and encodes them as base64url. Only the
SHA-256 hash is stored in `StoreInvitation.tokenHash`. The raw token is returned
only in the create/resend issuance response because the repository has no
invitation email sender configured. It is not logged or copied into
`AuditEvent.metadata`.

Inspection and acceptance receive the token in a JSON body rather than a URL to
avoid accidental URL/access-log/referrer exposure.

## API

Owner management:

- `POST /v1/stores/:storeId/invitations` — create a STAFF invitation; response contains the one-time issuance token.
- `GET /v1/stores/:storeId/invitations` — list with optional `status`, `page` and `limit`.
- `GET /v1/stores/:storeId/invitations/:invitationId` — inspect one invitation as its Store Owner.
- `POST /v1/stores/:storeId/invitations/:invitationId/revoke` — revoke a pending invitation.
- `POST /v1/stores/:storeId/invitations/:invitationId/resend` — replace the previous token and reset the seven-day expiry.

Recipient flow:

- `POST /v1/invitations/inspect` with `{ "token": "..." }` — public, non-secret invitation summary.
- `POST /v1/invitations/accept` with `{ "token": "..." }` — authenticated recipient acceptance.

The accepting Account email must equal the normalized invitation recipient
email. Acceptance and membership activation occur in one database transaction.
The unique `(accountId, storeId)` membership constraint and conditional
invitation update protect against concurrent acceptance and token replay.

No invitation email is sent by this implementation. A future email integration
must consume the issuance response at the application boundary and must never
persist or log the raw token.

The repository has no generic invitation-specific distributed rate limiter yet;
deployment should add one before exposing public inspection at scale. Token
validation is bounded by Zod and invalid tokens return a generic `404`.

## Audit events

The following actions are written transactionally:

- `STORE_INVITATION_CREATED`
- `STORE_INVITATION_ACCEPTED`
- `STORE_INVITATION_REVOKED`
- `STORE_INVITATION_RESENT`

Audit metadata contains status/role/outcome only; it never contains the token,
token hash, password, session token or FCM token.
