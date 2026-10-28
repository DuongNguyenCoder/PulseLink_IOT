# WP14.33–WP14.37 — Commissioning Readiness Report

Date: 2026-10-28 (Asia/Saigon)

Run: `WP14-RUN-033`

Status: **PARTIALLY COMPLETED — GATES B/C BLOCKED; GATE D PREPARED, NOT PHYSICALLY VERIFIED**

## Executive summary

This increment adds one repeatable, read-only commissioning preflight entrypoint. It emits JSON and Markdown summaries, checks local development tools and artifacts, validates that any optional backend probe is an explicit development HTTPS origin, and only queries Prisma migration status after validating the dedicated loopback test database target. The script does not open COM ports, start containers, run migrations, write a database, or contact a backend unless its explicit probe switch is used.

The fresh preflight found the development toolchain, ESP-IDF 5.5.5 Python environment, Docker daemon, Owner APK, connected ADB device, serial interface enumeration and test-database migration status. It correctly returned `BLOCKED`: the local commissioning profile and redemption URL are unset, the configured firmware event endpoint is not an approved local development target, and operational credential storage remains disabled. Backend HTTPS probing and the runtime Android API origin were skipped. No backend request was made.

No firmware, Android or backend product source changed in this increment. WP14-RUN-032 verification remains historical evidence for those components. No key enrollment was attempted and no hardware commissioning was run.

## WP14.33 preflight entrypoint

Run from the repository root:

```powershell
./scripts/Test-CommissioningReadiness.ps1
```

Optional read-only checks:

```powershell
./scripts/Test-CommissioningReadiness.ps1 -CheckTestDatabase
./scripts/Test-CommissioningReadiness.ps1 -ProbeBackend
```

`-ProbeBackend` requires the process environment variable `PULSELINK_PREFLIGHT_API_BASE_URL`, which must be a clean HTTPS origin without path, credentials, query or fragment and must resolve to loopback, a private/link-local address, `.local` or `.test`. It requests only the existing `/health/live` route using normal TLS hostname/certificate validation. Public hosts are rejected before network access. A liveness response proves only that the API process answered; it does not authenticate a Device or prove commissioning.

`-CheckTestDatabase` reads `TEST_DATABASE_URL` from the process environment or local API `.env`, but never prints it. It refuses anything except loopback host, port `5434`, and database `pulselink_test`; it never falls back to `DATABASE_URL`. It checks TCP reachability and runs only read-only `prisma migrate status`. It performs no migration or integration write.

Each check is classified `PASS`, `FAIL`, `BLOCKED` or `SKIPPED`, with a reason and next action. Exit codes are 0 for all checks pass, 1 for a check failure, 2 when blocked, and 3 when only skipped checks remain. The JSON and human-readable output default to `%TEMP%\pulselink-commissioning-preflight\commissioning-preflight.{json,md}`; `-OutputDirectory` selects another location. No secrets, database URL or configured firmware endpoint are written to those reports.

### Fresh preflight evidence

Command:

```powershell
./scripts/Test-CommissioningReadiness.ps1 -CheckTestDatabase -OutputDirectory "$env:TEMP/pulselink-wp1433-preflight-final"
```

Exit code: **2** (`BLOCKED` overall), with **14 PASS, 0 FAIL, 4 BLOCKED, 2 SKIPPED**. The run used the read-only Prisma migration-status query after validating `127.0.0.1:5434/pulselink_test`.

| Check | Result | Evidence / meaning |
| --- | --- | --- |
| Git, Node, npm, Python, managed CMake/Ninja, ADB | PASS | Versions obtained from local tools; ESP-IDF-managed CMake/Ninja were found under `IDF_TOOLS_PATH`. |
| ESP-IDF | PASS | The configured installation's Python entrypoint reported v5.5.5. No build was run by preflight. |
| Docker daemon | PASS | Read-only daemon version query answered. No container was started. |
| Android artifact and device | PASS | APK exists (915,134 bytes); one authorized ADB device listed. No install, login or app traffic occurred. |
| Serial enumeration | PASS | One serial interface enumerated by Windows PnP; no COM port opened. This does not identify or prove the board. |
| ESP-IDF certificate bundle | PASS | Selected in local `sdkconfig`; no TLS connection/runtime validation was performed. |
| Commissioning profile | BLOCKED | Local `sdkconfig` keeps the commissioning profile disabled. |
| Firmware redemption origin | BLOCKED | Local redemption origin is unset. |
| Firmware event origin | BLOCKED | Configured origin is outside the preflight's approved local-development host set; it was not contacted or printed. |
| Operational credential provider | BLOCKED | Provider remains disabled/fail-closed. |
| Android API origin | SKIPPED | App obtains the HTTPS origin at runtime; preflight did not access app state. |
| Backend HTTPS | SKIPPED | No explicit development origin was configured and no API request was made. |
| PostgreSQL target/migrations | PASS | Read-only Prisma status succeeded for `pulselink_test`, port 5434. No migration/write occurred. |

An additional URL-guard check supplied a public test hostname to the explicit probe path. It was rejected before making a request: **PASS**, exit 0. The PowerShell parser check for the entrypoint also passed, exit 0.

The first in-sandbox attempt to run Prisma status reached the already-validated test target but Prisma's schema-engine process creation returned `EPERM`; it was recorded as blocked. The exact preflight was rerun with approved elevated execution and then completed the read-only migration status successfully. No database writes were made.

## WP14.34 trusted enrollment

### Existing verified contract

WP14-RUN-032 implemented the operator-authorized `POST /v1/operator/devices/:deviceId/enrollment` contract. It checks an ECDSA P-256/SHA-256 DER proof over the domain-separated Device key, key version, canonical SPKI, 32-byte challenge and expiry transcript. Expiry is limited to five minutes; the backend only claims an eligible `UNENROLLED` Device once, and a unique database constraint prevents reuse of a non-null enrollment public key. Owner self-enrollment was removed. PostgreSQL integration coverage for the implementation passed 41/41 in RUN-032.

This backend contract is not a manufacturing identity source. Repository inspection still finds no board-side enrollment-proof endpoint or factory/operator channel that uses the protected Device private key to sign this transcript. An operator request-builder that accepts a client-provided key would not establish device authenticity, so no such trust-bypassing utility was added. Do not enroll a board until an approved station can obtain the public SPKI and signature from the actual board without exporting its private key. Challenge generation can occur at that station, with expiry capped at five minutes; replay remains constrained by the one-time Device state transition.

**Gate B: BLOCKED.** Backend proof verification exists; proof acquisition and enrollment on real hardware are not implemented or verified.

## WP14.35 protected key and credential storage decision record

Repository and installed ESP-IDF 5.5.5 sources were checked. Firmware initializes ordinary NVS in the current runtime. Identity provider compile gates require both identity-provider configuration and NVS encryption. Operational credential storage is an interface/fail-closed gate; no production provider is registered in `main.c`. Local `sdkconfig` keeps NVS encryption, commissioning and operational storage disabled. The selected certificate bundle does not change these storage facts.

| Option | Benefits | Key custody and provisioning | Recovery / limitations | Decision |
| --- | --- | --- | --- | --- |
| ESP-IDF encrypted NVS with HMAC-based key protection | NVS encryption keys can be derived through the ESP32-S3 HMAC peripheral from a per-device eFuse key; avoids storing the derived NVS key as plaintext in the NVS key partition. | Requires an approved per-device HMAC eFuse key source, selected key ID, factory provisioning and secure NVS initialization. | Loss/corruption or wrong HMAC key can make NVS unreadable; same-device recovery and replacement require explicit revoke/re-enroll. Hardware lifecycle is not recoverable by a software fallback. | Preferred candidate for review, **not approved or enabled**. The ESP-IDF workflow itself provisions irreversible eFuse state. |
| Encrypted NVS with flash-encryption-protected NVS key partition | ESP-IDF supports generated NVS encryption keys stored in an `nvs_keys` partition; flash encryption protects that key partition and other encrypted flash. | Requires key-partition layout and provisioning, plus flash-encryption policy and device-mode lifecycle. | Interrupted provisioning, lost key partition or replacement can make data inaccessible; recovery must be designed before enabling. Flash encryption is irreversible under the normal production flow. | Alternative only if the project adopts a broader flash-security manufacturing policy. Not enabled. |
| Secure Boot | Authenticates booted firmware and helps prevent unauthorized firmware replacement. | Requires signing-key custody and hardware provisioning. | Does not by itself encrypt NVS or protect a bearer credential from direct flash reading. | Complementary control, not a credential-storage substitute. Not enabled. |
| Software encryption with a key embedded in firmware or ordinary NVS | Minimal implementation cost. | Key is recoverable from the image/storage or shared across devices. | Does not meet the per-device protected-key requirement and creates extraction/fleet compromise risk. | Rejected; no fallback added. |
| External secure element/platform-managed provider | Potentially stronger isolated key custody if an actual component and IDF driver exist. | Requires a selected, present component, integration, provisioning and recovery procedure. | No such component is evidenced in this repository/board configuration. | Not selected; no hardware assumption made. |

NVS encryption protects data at rest but does not by itself authenticate firmware. Secure Boot authenticates firmware but does not encrypt credential data. Flash Encryption adds flash confidentiality and changes recovery/manufacturing constraints. Exact eFuse key block/key ID, reset/factory-recovery behavior, power-loss procedure, rotation/revocation and replacement-board policy require project-owner/security approval. No flags, partition layout, eFuse or board state were changed.

Acceptance before production provider registration: approved key custody and recovery policy; reviewed encrypted-NVS initialization and partition design; fail-closed read/write/read-back implementation; interruption/corruption tests; approved physical verification of reboot/power-loss and recovery. Host doubles cannot prove flash confidentiality or hardware persistence.

**Gate C: BLOCKED.** Provider remains disabled and credential storage remains unavailable.

## WP14.36 integration contract and status

No firmware/Android/backend product source changed in RUN-033. Existing sources retain the following sequence and gates:

```text
Owner-authorized provisioning session
  -> physical commissioning window -> enrolled-key SoftAP handshake
  -> encrypted Wi-Fi payload -> Station association/IP
  -> redemption -> protected persistence gate
  -> authenticated read-only Device status -> ONLINE
  -> authenticated Device Event -> database commit/ACK
```

Existing RUN-031/032 software evidence says: Owner API requires HTTPS; local SoftAP HTTP is protected at the application layer; firmware backend HTTP uses the ESP certificate bundle; status uses the operational credential provider and exact Device identity; Event Store scope derives from the authenticated Device; backend persists Event before success and has idempotency tests. These remain source/test evidence, not physical proof. The ESP runtime still has its older non-commissioning smoke URL setting; this preflight intentionally never uses it. The Owner app takes its API HTTPS origin at runtime. Do not point either client at `localhost` when the API is on another machine.

The preflight detected the current local firmware profile is not ready to commission: commissioning and operational storage are disabled, the redemption origin is empty, and the configured event endpoint is not accepted as a local development HTTPS target. Do not build/use that config for physical E2E. No change was made to runtime behavior or API contracts.

## WP14.37 development harness, observability and operator runbook

### Development topology

- API: `server/api`, `npm run dev`; local API health routes are `/health/live` (process liveness) and `/health/ready` (database readiness). Liveness does not authenticate a Device. The actual firmware and Android device require a reachable HTTPS host and trusted certificate; phone/board `localhost` refers to themselves, not the developer workstation.
- Test PostgreSQL: the repository Compose test service binds loopback port 5434 to `pulselink_test`; `npm run db:test:up` is the existing start command, but was not run here. Preflight verified the currently configured target and migration status read-only. No dev DB on port 5433 was used.
- Android: `apps/android-fcm-test/owner`; Gradle wrapper tasks are `:owner:testDebugUnitTest` and `:owner:assembleDebug`. The app requires an HTTPS API origin at runtime.
- Firmware: use ESP-IDF v5.5.5 as described in `docs/development/firmware-build.md` and `scripts/Invoke-FirmwareBuild.ps1`. Current local profile has commissioning/storage disabled. Build does not flash.
- Host C: `firmware/esp32/tests/README.md` documents the Docker host harness. Docker daemon is now reachable by read-only preflight, but the suite was not rerun in this increment.

### Event and lifecycle evidence

Use existing non-secret identifiers: provisioning session ID, Device ID, backend request ID, and the same `eventId` across retry. Do not create a new event ID per retry. Current firmware/API sources do not establish a single commissioning correlation ID carried across every subsystem, so this increment does not invent one or log credentials to approximate correlation. To prove each milestone, preserve redacted Owner state/API response IDs; device state and network observations from operator-approved serial access; backend enrollment/redeem/status responses with secrets removed; database event row keyed by Device/event ID; and the matching event ACK. A listening port, liveness response, ADB device or Wi-Fi association alone is not proof of the next milestone.

### WP14.38 operator acceptance sequence (not run)

1. Obtain project-owner approval for per-device identity creation, HMAC/NVS key custody, secure boot/flash policy, factory reset, recovery, revocation and replacement. Record an approved procedure before any fuse/security action.
2. Confirm the exact board model/revision, schematic, button GPIO/electrical level and serial port using non-resetting identification. Do not open the serial port until board operation is authorized because DTR/RTS may reset it.
3. Prepare a development-only HTTPS API origin reachable from both phone and board, with a certificate whose hostname and CA validate on Android and ESP-IDF. Confirm it is not production/staging. Set the preflight origin explicitly and run `-ProbeBackend`; expect `/health/live` PASS but do not treat it as Device authentication.
4. Start/verify only the dedicated test DB as needed. Run preflight with `-CheckTestDatabase`; expect migration status PASS for `pulselink_test:5434`. Integration tests must use the same test target and must not reset it.
5. Complete the approved factory station flow: provision a unique on-device P-256 identity, retrieve canonical SPKI and request the Device to sign the exact enrollment transcript without private-key export. Use an authorized operator with `DEVICES_WRITE`; post the signed proof to the existing operator enrollment route. Expect first enrollment success and replay/conflicting claim rejection.
6. Apply the approved protected-storage firmware/profile only after key provisioning/recovery steps are authorized. Perform approved programming, verify storage readiness/read-back, then reboot/power-cycle only under the approved test procedure. Expect no identity regeneration and fail-closed behavior on corruption/missing key.
7. Build the Owner APK and the exact firmware profile; record artifact hashes/versions and app-partition headroom. Operator performs any approved flash. Confirm the app uses the dev HTTPS origin and Owner account has active OWNER membership in the selected Store.
8. Physically open the board's commissioning window. In the app create/select Store, select the already enrolled Device and provisioning session, connect to its SoftAP, verify the enrolled Device proof, and submit only a dedicated test Wi-Fi credential through the encrypted channel. Expect no success state from local HTTP alone.
9. Observe Station association and IP, then redemption, storage readiness, authenticated `/v1/device-status` for the expected Device, and backend-confirmed ONLINE in that order. A credential storage failure, TLS error, wrong identity or timeout must remain failed/blocked.
10. Press the operational button. Verify backend scope is derived from the authenticated Device and a committed event row exists before ACK. Retry the same logical Event with the same `eventId`; expect one row only. Confirm notification intent for eligible recipient using a fake/test provider; do not send real FCM/email without separate approval.
11. Under approved test procedure, reboot/power-cycle and verify identity and operational credential recovery, authenticated status, and event behavior. Test wrong Wi-Fi password, AP unavailable, backend timeout, TLS failure, cancellation and expiry. Revoke the Device/test credential and confirm status/event rejection.
12. Cleanup only test credentials/data according to the approved retention policy. Share only redacted logs: no passwords, token, Authorization header, private key, bootstrap/session secret or full connection string.

Expected WP14.38 evidence bundle: APK and firmware hashes/build profiles, approved board/revision identity, enrollment response and replay rejection (redacted), handshake success, station IP and disconnect/retry results, redemption/persistence/reboot results, authenticated status response, stable event ID and one committed DB row before ACK, and the Owner-visible status. None of these physical steps ran in WP14-RUN-033.

## Gate matrix

| Gate | Status | Reason |
| --- | --- | --- |
| A — Software readiness | **PARTIAL** | WP14-RUN-032 backend, PostgreSQL, C host, Android and firmware evidence is historical and still directly applicable; fresh preflight validates tools/artifacts/test migration state. No product suites/builds were rerun in RUN-033. No explicit development API HTTPS endpoint is configured; local commissioning profile is disabled. |
| B — Trusted device readiness | **BLOCKED** | Backend proof verification exists; no approved board/factory channel supplies the proof from the actual private key. No board enrollment attempted. |
| C — Secure storage readiness | **BLOCKED** | Key custody/recovery policy has no approval; protected identity/operational provider remains disabled/unregistered. |
| D — Physical E2E readiness | **PREPARED, NOT PASS** | APK and ADB target are present, serial enumerated, and runbook exists. Firmware endpoint/profile and protected storage are not ready; no hardware operation or Wi-Fi credential transfer occurred. |

## Commands and evidence classification

Fresh in WP14-RUN-033:

| Command/check | Result |
| --- | --- |
| PowerShell Parser API on `scripts/Test-CommissioningReadiness.ps1` | PASS, exit 0, no parse errors. |
| `Test-CommissioningReadiness.ps1 -CheckTestDatabase` | Overall BLOCKED, process exit 2; 14 PASS, 0 FAIL, 4 BLOCKED, 2 SKIPPED. JSON/Markdown generated under `%TEMP%\pulselink-wp1433-preflight-final`. |
| Read-only Docker daemon `docker info --format ...` via preflight | PASS; no container started. |
| Read-only serial PnP enumeration via preflight | PASS; one serial interface listed, port unopened. |
| Read-only Prisma migration status via preflight | PASS; exact target `pulselink_test`, loopback port 5434; no migration/write. |
| Preflight public-host URL guard | PASS, exit 0; host rejected before request. |
| In-sandbox Prisma-engine attempt | BLOCKED, EPERM before query completion; rerun under approved elevated execution passed. |
| `git diff --check` | To be recorded after final review in WP14-RUN-033. |

Historical evidence (not rerun here): WP14-RUN-032 backend full suite 137 passed/43 skipped/0 failed, focused provisioning 15 passed, typecheck/build/Prisma validate pass; PostgreSQL integration 41/41 on `pulselink_test:5434`; C host 9 runners pass; Android JVM 14/14 and APK build pass (915,134 bytes); ESP-IDF default `0xf7280/0x100000` and commissioning compile `0xf92f0/0x100000`. Hardware E2E was not run in RUN-032 either.

## Changed files and safety

- `scripts/Test-CommissioningReadiness.ps1`: single read-only preflight entrypoint with machine/human outputs, strict backend probe gating, database target validation and serial enumeration without opening ports.
- `docs/.gitignore`: explicitly allows the new required WP14.33–WP14.37 report while preserving the audit-directory ignore behavior for other files.
- `docs/audits/wp14-engineering-log.md`: append-only WP14-RUN-033 entry.
- `docs/audits/wp14-9-end-to-end-commissioning-report.md`: current summary update and link.
- `docs/audits/wp14-33-37-commissioning-readiness-report.md`: this readiness record/runbook.

No schema/migration, backend product source, Android source, firmware source, partition layout, NVS/eFuse/security setting or notification policy changed. No production/staging infrastructure was contacted. No real notification, database write, container start, serial open, flash/reset/erase, eFuse operation or Wi-Fi credential transfer occurred.

## Decisions and operator actions required

1. **Trusted enrollment:** approve the manufacturing/operator identity source and how the board signs enrollment without exporting the private key. Then implement/integrate that exact board/factory channel and test first enrollment plus replay rejection.
2. **Protected storage:** approve per-device HMAC/NVS key custody and full recovery/factory-reset/replacement policy, including any exact eFuse/Flash Encryption/Secure Boot operations. No such operation is authorized by this report.
3. **Development E2E:** provide a non-production HTTPS API origin reachable from phone and ESP32, dedicated test router/credentials, and confirm its CA/hostname. Set local firmware redemption/event origins to that endpoint only after review.
4. **Physical test authorization:** separately authorize the exact board programming/serial/test steps, including any reset-causing DTR/RTS behavior, after steps 1–3 are ready.

Until then, keep commissioning and protected credential storage disabled. Overall result is **PARTIALLY COMPLETED**, not E2E complete.
