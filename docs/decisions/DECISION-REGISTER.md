# PulseLink Decision Register

This register separates Owner-confirmed product/security decisions from proposals, implementation evidence and unresolved questions. A design statement is not runtime evidence.

## Confirmed baseline — `APPROVED`

- One Owner account may manage multiple Stores.
- One account may use multiple phones; each app installation has its own session and FCM token lifecycle.
- Initial Owner creation uses controlled provisioning through the API; no public signup grants administrative Store/device authority.
- Device bearer tokens are CSPRNG-generated, shown once, and stored only as SHA-256 verifiers. Rotation issues a new token and invalidates the old credential when the transaction commits.
- Bootstrap credentials are separate from operational device tokens; bootstrap TTL is 30 minutes and the maximum failed-attempt limit is 5.
- Physical reset clears local device configuration and requires reconnection/provisioning; it does not release backend ownership or delete Device ID, event history or audit history.
- Firmware has no persistent offline retry queue in the MVP. An event may be lost after reboot or power loss.
- Device event idempotency is database-backed by unique `eventId`; same normalized payload is a stable duplicate, conflicting reuse is `409`.
- FCM is best-effort; invalid tokens are deactivated, and transactional outbox is outside the MVP.
- Sensitive business state and its audit record commit in the same transaction; audit retention is 365 days.
- Integration tests must fail closed with `PULSELINK_INTEGRATION_TESTS=1`, `NODE_ENV=test`, dedicated `TEST_DATABASE_URL`, no fallback to `DATABASE_URL`, and explicit host/database safety checks.
- Access JWT uses RS256 with issuer `pulselink-api`, audience `pulselink-app`, and `kid`-based key rotation. Protected requests check Account status and `authVersion` authoritatively from the database; this is a policy decision, not runtime evidence.
- Password-reset TTL is 15 minutes. Reset requests are limited to 5 per account or normalized email per hour plus a source/IP limit; responses must prevent account enumeration.
- Email verification is required before sensitive Store/Device operations. Initial Owner controlled provisioning requires its own verification flow.
- Every mobile Session must belong to an AppInstallation. Refresh tokens rotate; detected reuse revokes all sessions for the account.
- FCM token ciphertext must be encrypted at rest with a runtime-managed key, and a duplicate token rebinds to the newest installation while the old binding is invalidated.

## Verified implementation — `IMPLEMENTED` / `VERIFIED`

- `GET /health/live` and `GET /health/ready` are implemented; health route tests exist.
- Fastify/Pino logging is configured with redaction for authorization and cookie headers.
- Prisma 7 PostgreSQL adapter wiring, schema and initial migration exist.
- Account/password primitives, session rotation/reuse service, DB-authoritative account access, injectable authentication routes, Store membership authorization and injectable AppInstallation/FCM token management are PARTIAL implementation evidence; public app wiring, email provider, key storage, distributed rate limiting, FCM delivery and Store/installation mutation audit persistence remain incomplete.
- The repository currently has no `firmware/`, `apps/mobile/` or `packages/contracts/` source tree.
- A fail-closed integration-test database guard is now implemented and unit-tested; it does not run migrations or connect to PostgreSQL by itself.

## Authentication readiness register

| Decision | Status | Recommended direction and trade-off | Schema/API impact | Blocks implementation? |
| --- | --- | --- | --- | --- |
| JWT algorithm | APPROVED | RS256. | JWT validation configuration and key metadata. | No further decision; runtime still required. |
| JWT issuer and audience | APPROVED | `iss=pulselink-api`, `aud=pulselink-app`; reject mismatches and never derive them from request headers. | Auth configuration and token-validation tests. | No further decision; runtime still required. |
| Signing-key management and rotation | APPROVED | Use `kid` rotation with private keys outside the database/source. Provider, schedule and retirement procedure remain OPEN. | Key configuration/runbook. | Provider/schedule remain a blocker for production. |
| Immediate access-JWT revocation after disable | APPROVED | Protected requests check Account status and `authVersion` authoritatively from the database. | Account fields and auth middleware behavior. | Runtime middleware remains. |
| Password-reset token TTL | APPROVED | 15 minutes, single-use, verifier-only. | Reset-token model and reset API contract. | Runtime flow remains. |
| Password-reset rate limits and enumeration | APPROVED | 5 requests/account or normalized email/hour plus source/IP limit; generic responses. | Rate-limit storage/config and stable reset responses. | Exact source/IP implementation remains. |
| Account verification | APPROVED | Required before sensitive Store/Device operations; controlled initial Owner has a separate verification flow. | Account verification state and email-delivery contract. | Provider, verification TTL and endpoint scope remain OPEN. |
| Session schema and refresh-token reuse | APPROVED | Every mobile session belongs to an installation; opaque tokens rotate; reuse revokes all account sessions. | Account, AppInstallation and Session models plus refresh endpoints. | Runtime transaction implementation remains. |
| Session–installation account binding | APPROVED | Session retains `accountId` for account-scoped lookup/revocation and uses a composite database foreign key `(appInstallationId, accountId)` to the matching AppInstallation pair. | Additive Prisma relation and SQL constraint; existing separate Account and installation foreign keys remain. | Runtime rotation/revocation transactions remain. |
| Account/Store relationship | APPROVED | One Owner account managing multiple Stores is approved. Recommend an explicit membership relation instead of extending `Staff.storeId`; exact roles, multiple-Owner policy and lifecycle remain OPEN. | Replaces the current one-Store Staff shape for future account scope; affects authorization endpoints. | Yes for scoped auth and provisioning. |
| Owner provisioning and authorization boundary | APPROVED | Provision the initial Owner through a controlled CLI calling a protected HTTPS API; never direct CLI-to-PostgreSQL. The actor credential, route protection, exact permission and audit fields remain OPEN. | Provisioning API, actor/session requirements and audit transaction. | Yes for provisioning endpoint. |

The statuses above describe policy and implementation evidence separately. Authentication and Store authorization runtime are partial and test-backed; this is not a production-readiness claim.

## Proposed or selected, not Owner-approved — `PROPOSED`

- Self-managed email/password authentication using maintained scrypt configuration.
- JWT access tokens with 15-minute lifetime and opaque rotating refresh sessions.
- Membership schema that can later support multiple Owners/Staff per Store.
- Backend-controlled bootstrap redemption and device recovery state machine.

## Open decisions — `OPEN`

- Key storage provider, rotation schedule/retirement procedure, verification-token TTL, email provider and email-verification rate limits.
- Exact endpoint list blocked before email verification and source/IP rate-limit implementation details.
- Exact Store membership roles, multiple-Owner policy, transfer authority and target-Store verification.
- Prisma cannot express the PostgreSQL partial predicate for the one-active-Owner rule; the manual partial unique index must remain in migration SQL and be checked for drift on later schema changes.
- Bootstrap attempt-window reset/cooldown, entropy/format, physical-button proof and concurrent-claim recovery.
- Event fields, normalized payload, response/error codes, body limit and per-device rate limits.
- Audit model/readers/integrity enforcement beyond the approved same-transaction and 365-day invariants.
- `AuditEvent` foundation and transaction integration are PARTIAL/IMPLEMENTED for password reset, session logout/reuse, Store create/update and AppInstallation register/rebind/revoke. Database privilege enforcement, retention operation and distributed security-event rate limiting remain OPEN.
- FCM eligibility details for disabled accounts, Store departure and provider failures; encryption key provider remains OPEN.
- Production FCM encryption/fingerprint key provider, rotation schedule and operational secret injection remain OPEN; the current service requires injected key material and fails closed when it is missing.
- Initial device enrollment is `APPROVED` for the prototype through USB and a controlled commissioning tool. The Owner app is the official provisioning flow after registration; hardware-backed attestation, mandatory Secure Boot/flash-encryption/eFuse configuration and production hardening are outside the prototype.
- Device provisioning schema foundation is `IMPLEMENTED` in migration `20261015130000_device_provisioning_foundation`: independent Device provisioning/enrollment state, enrollment public-key metadata and `ProvisioningSession` with restrictive foreign keys, scoped idempotency, five-attempt field and one-active-session-per-Device SQL partial index. J.3 must still implement atomic redemption, authorization, challenge verification, credential issue/recovery and AuditEvent transaction boundaries.
- J.3 provisioning backend is `IMPLEMENTED` for the prototype: injected operator enrollment authorization, verified Owner session management, P-256 DER challenge signatures, atomic one-time redeem, five-attempt lockout, verifier-only operational credentials and audit integration. Firmware/USB tool, production operator credential storage, distributed rate limiting and production hardening remain out of scope or `OPEN`.
- Device provisioning protocol design is `PARTIAL` in `docs/features/device-provisioning-design.md`. Production key injection/rotation, SoftAP TLS/pinning UX, cooldown/operator unlock policy and production hardware security configuration remain `OPEN`.

## Scope status

Phase 0 documentation synchronization is not a production-readiness claim. Phase 1 implementation must stop at the listed security/authorization gates when a missing decision changes the trust model or schema semantics.
