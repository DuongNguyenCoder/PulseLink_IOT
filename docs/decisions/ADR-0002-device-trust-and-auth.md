# ADR-0002: Device provisioning and authentication

- Status: Proposed — design record; Owner-confirmed constraints are listed in `DECISION-REGISTER.md`, while implementation and remaining decisions are still open
- Date: 2026-10-12
- Scope: MVP device registration, device authentication and event ingestion

## Context

`deviceKey` identifies a device but is not a credential. The API must bind a device to one Store, authenticate it over HTTPS, support safe retries, and avoid storing or logging plaintext secrets. The current schema has `Device.deviceSecretHash`, a unique `DeviceEvent.eventId`, and device status fields, but no provisioning or authentication workflow exists yet. The selected account model allows one user to belong to multiple Stores, which is not represented by the current single `Staff.storeId` relation and requires a separate schema decision before implementation.

## Decision closure record

The following choices distinguish the Owner-confirmed baseline from proposals. They do not imply runtime implementation. Details not stated here remain `OPEN` or `PROPOSED`.

| Decision                   | Status   | Recorded choice                                                                                                                      |
| -------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| User authentication        | APPROVED | Email/password with maintained scrypt, RS256 access JWT (`iss=pulselink-api`, `aud=pulselink-app`, `kid`) and opaque rotating sessions; runtime is not implemented. |
| Account–Store relationship | APPROVED | One Owner account may manage multiple Stores; a membership model must remain extensible for future members.                         |
| Initial Owner creation     | APPROVED | Controlled provisioning through the API; no public signup grants administrative authority.                                         |
| Audit                      | APPROVED | Sensitive business state change and audit record commit in the same PostgreSQL transaction; retention baseline is 365 days.         |
| Device transfer            | PROPOSED | Owner-authorized transfer is required, but source/target rules and transaction details remain OPEN.                                 |
| FCM transactional outbox   | APPROVED | Outside MVP; evaluate in a later phase. No outbox is implied by this ADR.                                                          |
| Integration tests          | APPROVED | Dedicated test database and fail-closed safety guard are mandatory.                                                                |

### A. Self-managed user authentication

Email is the primary login identifier with password authentication and separate recovery/verification flows. Passwords use a maintained scrypt configuration; no custom cryptography is permitted. Access JWTs use RS256 with `iss=pulselink-api`, `aud=pulselink-app` and `kid` rotation. Protected requests check Account status and `authVersion` authoritatively from the database. Refresh tokens are opaque and rotating; reuse revokes all account sessions. Password reset TTL is 15 minutes and reset requests use the approved account/source rate-limit policy.

The identity of an Owner performing provisioning must come from an authenticated PulseLink user session plus an authorized Store membership, not from a device token or an untrusted client field. Key storage provider, rotation schedule, email provider, verification-token TTL and exact protected endpoint list remain `OPEN`.

### B. Store memberships and permissions

The approved direction is membership-based and one Owner account may manage multiple Stores. A future membership model may add Staff or additional Owners; the active Store must be selected from memberships the backend has already authorized. Missing membership, ambiguous active Store selection, inactive membership or disabled Store must fail closed. The additive account/session schema uses `StoreMembership`; it does not migrate legacy `Staff` rows or approve multiple active Owners in the MVP.

Every mobile `Session` is bound to an `AppInstallation`, and the database relation must bind both `appInstallationId` and `accountId` to the same `AppInstallation` row. The separate Account foreign key remains for account-scoped lookup and revocation. This composite constraint is a data-integrity guard; refresh rotation, reuse detection and account-wide revocation still require runtime transactions.

The proposal is that a Store may have multiple Owners. Owners may invite, disable and restore Staff according to the future permission catalog. Staff may view basic device information and receive notifications by default, but may not claim devices, transfer devices, rotate/revoke credentials or otherwise manage devices. Role names, multiple-Owner rules, active-Store selection, invitation permissions and restoration policy remain `OPEN`.

The current `Staff.storeId` field represents one Store only. It is evidence of an implementation gap, not a reason to silently change the schema in this phase.

### C. Initial Owner provisioning and Staff invitations

Initial Owner creation must use a controlled provisioning process. No public Owner registration endpoint is approved. The operator identity, provisioning credential, one-time token format, expiry, audit fields and failure recovery are `OPEN`; the controlled process must fail closed and must not write directly from a CLI to PostgreSQL.

Staff invitations are proposed to be Store-scoped, single-use, expiring and revocable, with explicit resend behavior. Disabled accounts must not authenticate or receive notifications according to the approved policy. Reusing an email or other login identifier after disablement requires an explicit account-lifecycle decision. Invitation expiry, redemption, revoke/resend and identifier reuse are `OPEN`.

### D. Device bootstrap, claim, credential lifecycle and transfer

Only an authorized Owner may complete a device claim. Bootstrap pairing remains physical-button-gated and uses a one-time, expiring secret separate from the operational bearer token. The bootstrap verifier/storage method, expiry, attempt limit, throttling, reset/reissue behavior and concurrent redemption transaction are `OPEN`.

Physical reset does not release backend ownership. An Owner may request transfer, but the backend must authorize both the source and target Store, update ownership and invalidate the old credential under one defined workflow. The ordering, transaction boundary, partial-failure recovery and offline-device policy are `OPEN`. Plaintext device tokens are shown only when a credential is issued and can never be retrieved later.

### E. Audit scope

At minimum, the design must consider audit records for initial Owner provisioning, invitations, membership changes, login security events where appropriate, device claim, transfer, credential issue/rotation/revocation, account disablement, Store disablement and other sensitive state changes.

The proposed minimum audit projection contains actor/user reference, affected resource reference, Store context, action, outcome, request/correlation ID and UTC timestamp. It must exclude passwords, OTPs, bootstrap secrets, device/user/refresh tokens, Authorization headers and unnecessary raw payloads. Sensitive state and its audit insert are atomic, with a 365-day retention baseline; audit readers, authorization, integrity protection and append-only enforcement remain `OPEN`. Pino logs are operational records and do not replace business audit.

### F. FCM boundary for MVP

Transactional outbox is explicitly outside the MVP. Event persistence and push delivery must remain separate concerns: durable event acceptance does not mean FCM delivery succeeded. Recipients must be active eligible Owner app installations with valid Store scope and an FCM token for the device's Store. MVP does not require a separate Staff account or invitation workflow.

The implementation policy for registering/revoking FCM tokens, invalid/unregistered tokens, send failures, multiple installations and disabled or transferred Staff is `OPEN`. FCM is not exactly-once and its token is neither identity nor authorization.

### G. Integration-test isolation

Integration tests must require `PULSELINK_INTEGRATION_TESTS=1`, `NODE_ENV=test` and a dedicated `TEST_DATABASE_URL`. The URL must not equal `DATABASE_URL`, must match an explicit test database name/host allowlist, and must be rejected when missing, malformed, shared, development, production or otherwise unverifiable. CI should use an ephemeral or explicitly isolated database. The repository now has a unit-tested guard, but no integration migration/cleanup operation is wired to it yet.

## Trust model options

| Option                                  | Security                                                                           | Operations                                                | MVP / one Store                                       | Multi-Store                                | Recovery and revocation                                                   | Main risk                                                       |
| --------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Pre-provision with a trusted admin tool | Strongest when the tool and transport are controlled; no public enrollment surface | Moderate: operator must configure each device             | Good for a small deployment                           | Good: Store binding is explicit            | Credential can be revoked and a replacement can be issued by the operator | Compromise of the admin tool or provisioning workstation        |
| One-time enrollment code with expiry    | Good if high-entropy, short-lived, single-use and delivered out of band            | Moderate; requires code lifecycle and enrollment endpoint | Good if a trusted operator can display/print the code | Good if code is scoped to one Store        | Code is consumed once; device credential can then be rotated/revoked      | Code theft or concurrent redemption if not claimed atomically   |
| Self-registration by public device ID   | Weak; an attacker can claim an unregistered device or guess identifiers            | Lowest                                                    | Simple but unsafe                                     | Poor without stronger tenant authorization | Weak; ownership is ambiguous                                              | Device impersonation, Store misbinding and credential hijacking |

## Decision for MVP

Use pre-provisioning through an internal controlled CLI. The operator selects an existing Store, enters or verifies the hardware identity, and asks the server to generate a high-entropy bearer token. The CLI calls a protected provisioning API over HTTPS and does not connect directly to PostgreSQL or receive production database credentials. The API stores only a SHA-256 token verifier plus the Store association.

This decision avoids an unauthenticated public registration endpoint and does not invent an admin identity model that is not present in the current repository. A one-time enrollment flow remains a future option if operational evidence shows that pre-provisioning is too expensive.

## Phase 1 architecture proposals

The choices in this section are selected proposals for Phase 1. They are not evidence of owner approval, and they do not imply that the corresponding runtime, mobile or firmware behavior exists.

### 1. Onboarding permission boundary

The app may expose a non-authoritative onboarding start step to an authenticated user, but only an Owner with the required Store membership and permission may complete a device claim, select ownership, move a device between Stores, or issue/revoke credentials. Staff must not manage device ownership or credentials.

The backend must fail closed when the signed-in user has no valid membership, when the active Store is ambiguous, or when the user is not an authorized Owner. The exact permission name, active-Store selection and behavior for users with no membership remain open decisions.

### 2. Wi-Fi pairing and bootstrap secret

The proposed onboarding flow is:

1. An operator or authorized app flow causes the device to enter pairing mode only after a physical button action.
2. The ESP32 exposes a temporary SoftAP for setup.
3. A QR code carries a device-specific bootstrap secret, not the operational device token.
4. The bootstrap secret is single-use, expires, and is exchanged only over the protected onboarding flow.
5. Successful claim consumes or invalidates the bootstrap secret before the operational device credential is used.

Bootstrap TTL is approved as 30 minutes and the maximum failed-attempt limit is 5. Attempt-window reset/cooldown, physical-button proof, entropy/format, storage/verifier details and failure handling remain OPEN. No real secret or token may appear in documentation, logs or examples.

### 3. User, operator and device identities

The proposal separates these concepts:

- A `Staff` identity represents a signed-in app user.
- A role or permission grants actions within a Store scope.
- An app installation and its FCM token identify a push destination; an FCM token is not a user identity or authorization proof.
- A `Device` and its `deviceId` identify an ESP32; a device identifier is not a credential.
- A device token is the long-lived operational credential for device API calls.
- A bootstrap secret is a temporary pairing credential and must not be reused as the operational device token.
- An operator is a Staff/user principal with the required Store-scoped permission, not a default shared administrator account.

The self-managed user login/session mechanism, token issuance/refresh/revocation, permission catalog and Store-scope checks remain open decisions. Device and app-user credentials must remain separate.

### 4. Reset and Store transfer

An ESP32 physical reset does not release backend ownership. Store transfer must be an authorized backend operation, scoped to the current and target Store, and must revoke the old device credential according to the approved transaction boundary. A device request must never self-select a new Store.

The role allowed to transfer a device, target-Store verification, timing of old-credential invalidation, partial-transfer recovery, audit behavior and offline-device handling remain open decisions. Until those decisions are approved, reset and transfer are design-only operations.

### 5. Notification recipient eligibility

The MVP proposal is to select app installations that have a currently usable FCM token, belong to an active staff account, and have the required permission in the Store associated with the authenticated device. Recipient selection is restricted to that Store; it must not broadcast across Stores.

The definitions of active staff, required permission, invalid or expired FCM-token handling, account disablement and Store departure remain open decisions. FCM tokens are destinations only and do not grant access to device or Store data.

### 6. Audit proposal

The proposal is to persist an audit record in the same PostgreSQL transaction as each sensitive state change. Audit is a business record and is not replaced by Pino operational logs. Candidate actions include provisioning, claim, rotation, revocation, disablement and Store reassignment.

The audit schema, complete action list, readers and integrity protection still require owner approval. Retention is 365 days, sensitive state and audit insert must be atomic, and plaintext secrets, bearer tokens, Authorization headers and unnecessary raw payloads must never be written to audit. A device credential must not create an operator audit record.

### 7. Phased implementation proposal

After the relevant approval gates are closed, the proposed implementation order is:

1. Finalize identity, authorization and Store scope.
2. Implement bootstrap pairing and device claim.
3. Implement device authentication and credential lifecycle.
4. Implement event ingestion, normalization, idempotency and concurrent-insert handling.
5. Implement audit transactions and API security controls.
6. Implement FCM recipient selection and delivery behavior.
7. Integrate firmware failure handling and perform end-to-end acceptance.

Each phase must have an explicit scope, tests, acceptance criteria and stop conditions. This ordering is a proposal, not an instruction to implement any phase in this document update.

| Proposed phase                        | Minimum acceptance criteria                                                                                                                               | Stop condition                                                                                                      |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Identity and Store scope              | A real operator/user trust source, permission checks and fail-closed Store scope are approved and testable.                                               | No provisioning or claim route is exposed while identity or scope is ambiguous.                                     |
| Bootstrap pairing and claim           | Physical-button gating, one-time bootstrap use, expiry, claim authorization, reset behavior and ownership persistence are specified and tested.           | Stop on replay, concurrent redemption, Store ambiguity or partial claim without a defined recovery path.            |
| Device authentication and credentials | Bearer verification, status checks, redaction, rotation and revocation have unit and route tests.                                                         | Stop if any secret appears in logs/responses or revocation is not effective after commit.                           |
| Event ingestion                       | Zod normalization, durable insert, unique-conflict fetch/compare, `200`/`409` semantics, limits and auth errors are covered, including concurrency tests. | Stop if an uncommitted event is acknowledged or concurrent duplicates can create two durable rows.                  |
| Audit and API security                | Sensitive state changes and audit records share the approved transaction; rate/body limits and stable error mapping are verified.                         | Stop if audit can diverge from the sensitive state change or sensitive data is logged.                              |
| FCM recipient selection and delivery  | Store-scoped recipient eligibility, invalid-token handling and duplicate-safe delivery behavior are approved and tested.                                  | Stop if recipients can cross Store boundaries or delivery semantics are described as exactly-once without evidence. |
| Firmware and end-to-end acceptance    | Device pairing, token use, current-session retry and offline-loss behavior match the contract on real hardware or an approved equivalent.                 | Stop if firmware persists an unapproved queue or loses the event ID across an active-session retry.                 |

### 8. Offline behavior baseline

The recorded baseline remains current-session retry only. The ESP32 does not persist an offline queue, and an event may be lost after reboot, power loss or loss of power before successful submission. The system is not described as lossless or exactly-once. Any future change to this policy requires a separate decision covering firmware storage, flash wear, ordering, retry, capacity and idempotency.

## Operator authentication and authorization

The current repository has no user authentication, operator session model or role/scope middleware. The selected direction is self-managed PulseLink authentication, but its protocol and key management are not approved. Therefore Phase 1B must not expose a provisioning endpoint until the user trust source and Owner authorization model are approved.

The recommended boundary is an authenticated internal tool or API endpoint protected by PulseLink's own approved user session. The resulting principal must contain an immutable user/operator reference, an Owner membership and an explicit device-management permission for the selected Store. Authentication proves the user identity; authorization proves that the Owner may provision or transfer within the selected Store. A device secret must never authenticate an operator.

For the MVP, a controlled provisioning CLI or internal app flow may be used. The boundary is a dedicated operator workstation or controlled runner, connecting to a protected provisioning API over HTTPS. The tool must not receive production database credentials or write directly to PostgreSQL. It must authenticate the Owner through the approved PulseLink session, request only an authorized Store membership, and fail closed when the membership is absent or ambiguous. It must not become an unauthenticated public HTTP endpoint, and its execution environment, actor identity, target Store, outcome and request ID must be separately audited.

## Provisioning contract draft

This contract is a design draft only. The route name is not approved until operator authentication and authorization are implemented.

### Create device

Suggested protected operation: `POST /v1/operator/devices`.

Request fields:

```json
{
  "storeId": "store-id-selected-by-authorized-operator",
  "name": "Front counter button",
  "type": "CALL_BUTTON",
  "firmwareVersion": "1.0.0"
}
```

- `storeId` is selected by the authorized operator and must be checked against the operator's Store scope.
- The device does not submit or choose its Store.
- `deviceKey` should be generated server-side as an opaque, high-entropy identifier (for example, 32 random bytes encoded as base64url, which fits the current 64-character limit). A physical serial/MAC identity is not currently represented in the schema and must not be smuggled into `deviceKey` without a separate contract decision.
- The credential secret is generated from a CSPRNG, provisioned to the device through the controlled tool, and returned in the create response exactly once.

Success: `201` with a stable envelope containing the device id, generated `deviceKey`, Store binding, status and one-time `deviceToken`. The token must never appear in later reads, logs, audit metadata or error responses.

Expected failures:

- Invalid request: `400 VALIDATION_ERROR`.
- Store absent or inactive: `404 RESOURCE_NOT_FOUND` or a deliberately non-enumerating authorization response.
- Operator lacks Store scope: `403 FORBIDDEN`.
- `deviceKey` collision, if an operator-supplied key is ever allowed: `409 DEVICE_KEY_CONFLICT`; creation must not overwrite the existing record.
- Database failure: `503 DEPENDENCY_UNAVAILABLE` when retry is safe, otherwise `500 INTERNAL_SERVER_ERROR`.

### Lost or reset device

The old secret is never returned. An authorized operator must revoke or disable the old credential, generate a replacement, and complete provisioning again. Reusing the same `deviceKey` is allowed only through an explicit operator-controlled rotation workflow; it must not be an implicit upsert.

### Credential storage decision

Use a random bearer token generated server-side with a CSPRNG. The token is high entropy and not intended to be memorized or selected by a human. PostgreSQL stores `SHA-256(token)` as a fixed-length verifier; the server hashes the received token and compares the two digests using constant-time comparison. A one-way SHA-256 verifier is appropriate here because the server does not need to recover the token or use it as a cryptographic key. Bcrypt/Argon2 are not the default for this credential type because their primary benefit is slowing guesses against low-entropy passwords, while this token's security comes from sufficient CSPRNG entropy and rate limiting.

The existing `Device.deviceSecretHash VARCHAR(255)` can be retained without a schema change because its name and size accommodate the verifier semantic. The implementation must document the encoding, for example lowercase hex or base64url, and use one representation consistently. A future migration may rename it to `deviceTokenSha256` for clarity, but that is not required before Phase 1B.

Credential rotation generates a new token and replaces the stored verifier in one authorized operation. The old token becomes invalid after the transaction commits. Revocation disables the device or otherwise marks the credential unusable; every subsequent request checks the current device status and verifier.

### Provisioning rules

1. Only an explicitly authorized operator or controlled provisioning tool may create a Device record.
2. `storeId` comes from the operator's selected Store, never from an unauthenticated device request.
3. The device secret is generated with a cryptographically secure random source, is sent only over the controlled provisioning channel plus HTTPS where applicable, and is displayed once.
4. The API stores only the SHA-256 verifier of the bearer token. The plaintext token is never logged, returned by a later read, or included in diagnostics.
5. The device starts in `PENDING`; activation requires successful authenticated communication and an explicit provisioning completion step.
6. A lost or factory-reset device is not silently re-enrolled. An operator revokes the old credential, issues a replacement, and reconfigures the device.
7. Credential rotation creates a replacement credential through an operator-controlled action. The old credential is disabled after the new credential is confirmed, with only a narrowly bounded overlap if a future protocol requires it.
8. Revocation sets the device to `DISABLED` or otherwise invalidates its credential. Authentication must check both the verifier and device status.

## Future one-time enrollment alternative

If adopted later, the enrollment code must be generated by an authorized operator, be scoped to exactly one Store and one device enrollment, expire quickly, have sufficient entropy, and be stored only as a hash. Redemption must claim the code in one database transaction protected by a unique constraint or equivalent atomic update. Concurrent requests must result in exactly one success; all later attempts must fail without revealing whether another device used it. The code must never be derived from `deviceKey` or printed in logs.

## Device authentication protocol proposal

Use HTTPS with a bearer token:

```text
Authorization: Bearer <deviceToken>
Content-Type: application/json
```

- `deviceKey` remains an identifier and is not required as a separate credential header.
- The server generates a high-entropy token with a CSPRNG and stores only its SHA-256 verifier.
- The server hashes the received token and compares the fixed-length digest using constant-time comparison.
- The token is not bound cryptographically to method, path, query or body. HMAC, canonicalization and timestamp freshness are explicitly not part of this protocol.
- HTTPS is mandatory outside local development.

### Event authentication and replay trade-off

Each button press creates a unique `eventId` using a suitable UUID/CSPRNG generator. The bearer token authenticates the device, while PostgreSQL uniqueness and normalized payload comparison provide event idempotency.

A stolen bearer token can replay requests and consume network, rate-limit and database resources. `eventId` prevents duplicate durable events but does not prevent replay attempts. Mitigations in this protocol are TLS, token redaction, per-device rate limiting, request/body limits, device status checks, durable unique `eventId`, duplicate payload comparison, bounded processing time and operational monitoring. Timestamp freshness and request signing are future architecture options, not hidden additions to this protocol.

Offline policy: the ESP32 sends only when Wi-Fi and HTTPS are available. It has no persistent retry queue. An event that fails to send may be lost after reboot or power loss. A bounded RAM buffer may hold an in-flight request during the current session only; it must never become a persistent queue.

### Verification and lifecycle rules

- Reject missing, malformed, revoked or invalid bearer tokens with generic `401`.
- Reject disabled devices with the same generic device-auth response.
- Derive the device and Store from the verified token; never trust a device-supplied `storeId`.
- Do not log the Authorization header, bearer token, raw credential or full event payload.
- Rotation replaces the stored SHA-256 verifier in one authorized transaction; the old token fails all subsequent authentication checks after commit.
- Revocation is effective immediately after commit and must be checked on every authenticated request.

## API contract draft for Phase 1

The following is a draft, not implemented:

- Operator-controlled provisioning is out of the public device API surface.
- Authenticated event endpoint: `POST /v1/device-events`.
- Request body includes `eventId`, `type`, `occurredAt`, `firmwareVersion`, bounded diagnostics and no `storeId`.
- Success is returned only after durable persistence. A first accepted event returns `201`; an identical retry may return `200` with the existing event result; a conflicting reuse returns `409`.
- Invalid or missing bearer token returns `401`; disabled device returns the same generic `401` to avoid account/device enumeration.
- Validation is `400`; rate limiting is `429`; database/dependency failure is `503` or `500` according to retry safety.

### Event equivalence and race handling

Event equivalence is computed after Zod parsing and deterministic normalization:

- UUIDs are compared in canonical lower-case form.
- `occurredAt` is compared as the same UTC instant.
- Enum values are compared after schema parsing.
- Optional absent fields are omitted consistently; `null` remains distinct from absent unless the contract explicitly says otherwise.
- Diagnostic JSON objects are recursively key-sorted; arrays preserve order; numbers and strings are not silently coerced.
- The comparison projection includes every event field that affects meaning, including event type, timestamp, firmware version, RSSI and bounded payload.

The implementation must not rely on a check-then-insert sequence. It must attempt the durable insert under the unique `eventId` constraint, catch the unique-conflict case, fetch the committed existing row, compare the normalized projection, then return `200` for an identical event or `409` for a conflict. This remains correct when two requests race.

### Draft response semantics

| Situation                            |                                                        Status | Code / behavior                                            |
| ------------------------------------ | ------------------------------------------------------------: | ---------------------------------------------------------- |
| Device provisioned                   |                                                           201 | Return device metadata and secret once only                |
| Device not found                     | 404 for operator resource lookup; generic 401 for device auth | Do not leak credential state from device endpoints         |
| Invalid/missing bearer token         |                                                           401 | Generic authentication failure                             |
| Disabled device                      |                                                           401 | Same generic device-auth response as invalid credential    |
| Duplicate device key                 |                                                           409 | No overwrite or implicit rebind                            |
| First event insert                   |                                                           201 | Only after durable commit                                  |
| Same event ID and equivalent meaning |                                                           200 | Return existing event result; no second event/notification |
| Same event ID and different meaning  |                                                           409 | Idempotency conflict                                       |
| Validation failure                   |                                                           400 | Stable `VALIDATION_ERROR` envelope                         |
| Rate limit                           |                                                           429 | Stable rate-limit response; do not reveal secrets          |
| Database/dependency failure          |                                                    503 or 500 | Do not acknowledge an uncommitted event                    |

## Credential lifecycle and audit policy

Audit records for provisioning, rotation, revocation, disablement and Store reassignment must contain operator identity, target device id/key reference, Store scope, action, outcome, request id and UTC timestamp. They must not contain secret material, Authorization headers, signatures, raw provisioning payloads or full event bodies. The repository now has an `AuditEvent` foundation and shared transaction writer; provisioning-specific action names and production database privilege enforcement remain subject to the J.1.1 design and later implementation review.

The required atomicity is: the sensitive state change and its audit record commit in the same database transaction. If either fails, neither is acknowledged. For external side effects such as delivering the one-time secret to a device, persist the state/audit transaction first, then perform delivery with a correlation id and a recoverable delivery status; never roll back a committed credential based only on an uncertain network response. The future audit model should use an append-only record with a unique operation/request id and should prevent ordinary device credentials from writing audit records. Until that migration exists, the controlled provisioning tool must provide an equivalent tamper-evident operational audit trail.

Rotation invalidates the old credential after the replacement is confirmed. Revocation is effective immediately for authentication. A disabled device must not be re-enabled by a device request.

Notification delivery may use a transactional outbox in a later implementation. The outbox records durable work after the event transaction commits, but it does not provide exactly-once external FCM delivery and does not replace the audit record. Duplicate sends and provider retries remain possible and must be safe.

## Test and dependency security notes

The API currently has unit/in-process Vitest coverage, but no PostgreSQL integration harness. Integration tests must use a separately provisioned database/database name and a dedicated `TEST_DATABASE_URL`. The harness must require `PULSELINK_INTEGRATION_TESTS=1`, require `NODE_ENV=test`, reject missing or empty test URLs, require a database name matching `pulselink_test_*`, reject equality with `DATABASE_URL`, reject known development/production database names and configured production hosts, and fail closed if the URL cannot be parsed safely. Tests must use an append-only migration deployment or isolated disposable infrastructure, never `migrate reset` against a shared database. CI should provision the database ephemerally and destroy only that isolated resource after the job.

The Phase 0.5 `npm install` output reported four high vulnerabilities, but a subsequent read-only `npm audit --json` and `npm audit --omit=dev --json` currently report zero vulnerabilities. No affected package could be identified from the current audit report, so no `npm audit fix` or automatic upgrade is justified. Re-run audit in CI with the lockfile and review any new advisory before release.

## Decision status

### Baseline recorded for the MVP

- Provisioning uses a controlled internal CLI over a protected HTTPS API; no direct CLI-to-PostgreSQL access.
- Operator requests require an authenticated identity, `operatorId`, `devices:write`, explicit Store scope and fail-closed scope checks.
- Devices use a server-generated high-entropy bearer token over HTTPS; PostgreSQL stores only its SHA-256 verifier.
- Token issuance is one-time; rotation replaces the verifier; revocation/disablement is checked on every authenticated request.
- ESP32 has no persistent offline retry queue; an unsent event may be lost after reboot or power loss.
- `eventId` uniqueness plus normalized payload comparison define `200` equivalent duplicates and `409` conflicting reuse.
- Bearer authentication is not request signing; replay can still consume resources.

These are recorded architectural baselines, not evidence that the corresponding runtime behavior has been implemented or that formal owner approval has been recorded outside this decision log.

The former persistent-retry-queue wording was removed from the current root/backend instructions, architecture overview and feature ordering. The current MVP documentation consistently states that offline events may be lost after reboot or power loss.

### Selected proposals from Decision Closure (not approved)

- Build user authentication inside PulseLink using standard maintained password hashing and a separately designed session/token lifecycle.
- Allow one account to have multiple explicit Store memberships; the current `Staff.storeId` schema is not sufficient for this selected proposal.
- Provision the initial Owner through a controlled process, with no public Owner self-registration.
- Restrict device claim and device management to authorized Owners; Staff do not manage device credentials.
- Permit Owner-requested device transfer only after source/target authorization and a consistent old-credential revocation workflow are approved.
- Keep FCM transactional outbox outside the MVP.
- Require a dedicated integration database and fail-closed test guard.

These selections narrow the architecture but do not approve membership permission names, bootstrap lifecycle, transfer transactions, email provider/verification TTL, key storage provider/rotation schedule or test allowlists.

### Requires owner approval

- Key storage provider, rotation schedule/retirement procedure, email provider, verification-token TTL and exact pre-verification endpoint list.
- Multi-Store membership representation, multiple-Owner policy, active-Store selection, membership lifecycle and permission catalog.
- Controlled initial Owner provisioning actor, credential, expiry, one-time use and audit behavior.
- Whether a non-Owner may start a non-authoritative onboarding step, and which separate permission is required to complete a claim or change ownership.
- Store-scope enforcement and Owner authorization for claim and transfer.
- Bootstrap SoftAP secret expiry, attempt limit, throttling, verifier/storage, reset/reissue and claim-failure behavior.
- Store transfer authority, target-Store verification, old-credential invalidation timing and partial-transfer recovery.
- Operator identity provider, operator authentication method, protected route and API version.
- Long-term retention of `Device.deviceSecretHash` versus a future semantic rename migration.
- Audit persistence model, append-only guarantees, retention and transaction boundary.
- Transactional outbox scope for FCM and its at-least-once delivery behavior.
- Active-staff and recipient permission rules, invalid FCM-token handling and Store departure behavior.
- Exact rate-limit policy, body limits, stable auth error contract and the production/development host and database denylist for integration tests.

### Not implemented

Provisioning CLI, operator authorization, token generation/verifier logic, rotation, revocation, bearer middleware, event routes, database audit records, notification outbox, integration-test guard and firmware offline behavior are design-only. No endpoint or database operation should be inferred from this ADR.

## Phase 1B Entry Gate

`APPROVED` means the Owner-confirmed baseline is fixed; `PROPOSED` means a design proposal not yet approved; `OPEN` means an owner decision or unresolved operational contract is required; `IMPLEMENTED`/`VERIFIED` require runtime evidence. None of these statuses means production readiness by itself.

| Gate                                                               | Status | Requirement / reason                                                                                        |
| ------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------- |
| User authentication and session lifecycle                          | APPROVED | RS256/issuer/audience/kid, authVersion DB checks, 15-minute reset TTL, approved rate limits and session reuse policy are fixed; runtime is absent. |
| Multi-Store membership and permission model                        | APPROVED | Membership schema is present for one Account to manage multiple Stores; exact roles, active-Store selection, lifecycle and multiple active Owners remain open. |
| Initial Owner provisioning boundary                                | OPEN   | Controlled provisioning is selected; actor credential, one-time flow and audit details remain open.         |
| Operator identity and authorization                                | OPEN   | Owner authorization, protected route and API version are not selected in sufficient detail.                 |
| Onboarding start versus claim authority                            | OPEN   | Only authorized Owners may claim; exact permission and no-membership behavior remain undecided.             |
| Bootstrap SoftAP secret lifecycle                                  | OPEN   | Expiry, attempt limit, storage/verifier, reset and failure behavior are not approved.                       |
| Store scoping and fail-closed behavior                             | PROPOSED | Store scope is explicit; runtime enforcement is absent.                                                   |
| Store transfer and reset behavior                                  | OPEN   | Owner-requested transfer is selected; target verification, transaction and revocation timing are open.      |
| Token issuance, one-time display, rotation and revocation contract | PROPOSED | Bearer-token lifecycle is defined; implementation and tests are absent.                                  |
| Token redaction in logs/errors/audit                               | PROPOSED | Prohibition is documented; runtime enforcement remains Phase 1B work.                                    |
| Disabled/revoked device handling                                   | PROPOSED | Generic authentication rejection is defined; middleware is not implemented.                              |
| Event payload schema and normalization                             | OPEN   | Fields and exact normalization contract remain to be confirmed.                                           |
| Event ID uniqueness and duplicate semantics                        | APPROVED | Database uniqueness exists; runtime duplicate handling is not implemented.                                 |
| Concurrent insert handling                                         | PROPOSED | Must rely on PostgreSQL unique conflict plus fetch-and-compare, not pre-check only.                       |
| Rate limits, body limits and exact auth error policy               | OPEN   | Exact per-device limits and operational thresholds are not approved.                                        |
| Offline-loss policy in firmware/backend documentation              | APPROVED | Current documents state no persistent queue and possible event loss.                                       |
| Audit persistence and transaction boundary                         | APPROVED | Same-transaction audit and 365-day retention are fixed; model/readers/enforcement remain open.             |
| FCM transactional outbox                                           | APPROVED | Explicitly outside MVP; evaluate in a later phase.                                                         |
| FCM recipient eligibility and invalid-token handling               | OPEN   | Active-staff, permission and token lifecycle rules are not approved.                                        |
| Integration-test database guard                                    | PROPOSED | Dedicated DB and fail-closed policy are approved; guard is implemented/unit-tested, but no destructive integration setup invokes it yet. |
| Integration tests for concurrency, auth, revocation and rollback   | OPEN   | Test cases are identified but require Phase 1B implementation and isolated DB setup.                        |
| Logging, redaction and stable error expectations                   | PROPOSED | Documentation is aligned; runtime enforcement remains unimplemented.                                      |

## Consequences

- MVP needs a trusted provisioning operator/tool before device rollout.
- No unauthenticated public registration endpoint is required.
- Bearer-token verification, event idempotency and replay resource controls must be implemented and tested together.
- The ESP32 does not persist an offline retry queue; an unsent event may be lost after reboot or power loss.
- The current schema is not changed by this ADR. Credential rotation history, enrollment-code storage and replay records require a separate schema decision if those workflows are approved.

## Open approvals before Phase 1B

1. Approve the self-managed authentication protocol, password hashing configuration, access/refresh token lifecycle, key management and recovery controls.
2. Approve the multi-Store membership representation, multiple-Owner policy, active-Store selection and permission catalog.
3. Approve the controlled initial Owner provisioning actor, credential, one-time flow, expiry and audit behavior.
4. Approve that only an authorized Owner may claim or manage a device, including the exact permission and no-membership behavior.
5. Approve Store-scope resolution, transfer authority, target verification and the timing/transaction behavior for old-credential revocation.
6. Approve bootstrap SoftAP secret expiry, attempt limits, throttling, storage/verifier and reset/reissue behavior.
7. Confirm retaining `Device.deviceSecretHash` as the SHA-256 bearer-token verifier, or approve a later semantic rename migration.
8. Approve the audit persistence model, action list, readers, retention, integrity controls and same-transaction atomicity.
9. Approve active-staff and recipient permission rules, invalid FCM-token handling and Store departure behavior.
10. Confirm transactional outbox remains outside MVP; define a separate later decision if scope changes.
11. Approve the isolated integration-test database policy, explicit allowlist and CI cleanup boundary.
12. Approve exact rate limits, request/body limits, stable auth errors and the production/development database and host denylist.
