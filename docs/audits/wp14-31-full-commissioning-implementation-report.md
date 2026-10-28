# WP14.31 — Full Commissioning Implementation Report

Date: 2026-10-28 (Asia/Saigon)  
Run: `WP14-RUN-031`  
Status: **PARTIALLY COMPLETED — HARDWARE E2E NOT VERIFIED**

## Summary

WP14.31 connected and verified the software-side commissioning flow as far as
the existing trust and storage gates permit. It improves the runtime ordering
from SoftAP configuration through station association, redemption, persistence,
authenticated status and event delivery. Android now waits for backend Device
status rather than treating a successful local HTTP exchange as online. The
backend records `ONLINE` with the authenticated event transaction.

The complete commissioning flow cannot be claimed: the production identity
provider and protected operational-credential provider are unavailable under
the current security configuration, and the Owner flow requires an already
enrolled Device but does not itself establish the trusted enrolled public key.
No Android phone or ESP32 runtime test was performed.

## Initial gaps and implementation

| Area | Gap observed | WP14.31 result |
| --- | --- | --- |
| Firmware lifecycle | SoftAP and Station shared Wi-Fi ownership and transition sequencing needed integration; HTTP callback must not run blocking redemption. | Existing Wi-Fi owner retained. Credential callback queues bounded data; Station join occurs asynchronously; redemption starts after IP; status confirmation is required before firmware ONLINE. |
| Transport | Local credential response could be mistaken for completion; resource lifecycle needed cleanup. | SoftAP server is opened through the current lifecycle, transitions the already initialized driver to AP mode and returns to STA without a second driver initialization. Android closes session/network binding and clears the password. |
| Backend status | Authenticated Device status was read-only but did not reflect an accepted event in Owner-visible Device listing. | First authenticated event updates Device status/last-seen in the same transaction as event persistence; authorization race aborts the transaction. |
| Android | UI needed to wait for backend evidence and handle network permission/cancel. | Wi-Fi permission and cancellation handling added; Owner API polling waits for PROVISIONED/ENROLLED and backend ONLINE state. |
| Cryptographic build | Commissioning-enabled link lacked the optional HKDF symbol. | Feature Kconfig selects `MBEDTLS_HKDF_C` only when commissioning is enabled. |
| Credential storage | No approved protected production provider/key custody/recovery. | Intentionally unchanged and fail-closed. No plain NVS or token fallback introduced. |

## Flow and contracts

```text
Owner-authenticated provisioning session
  -> physical gate -> bounded SoftAP -> enrolled-key handshake
  -> encrypted Wi-Fi configuration -> station association/IP
  -> existing backend redemption contract
  -> storage provider readiness/persistence gate
  -> authenticated read-only /v1/device-status probe
  -> firmware commissioning ONLINE
  -> authenticated Device Event
  -> DB transaction persists event and marks Device ONLINE
  -> Owner app polls Store Device list and reports ONLINE
```

The firmware sequence does not report ONLINE after SoftAP HTTP success, Wi-Fi
association alone, or redemption alone. Device Event remains gated on the
firmware lifecycle and operational credential provider. The backend derives
Device identity from the authenticated operational credential and derives
Store scope from the persisted Device relation. Existing provisioning/redeem,
Device status and event API contracts were reused. No schema or migration was
added. Event acceptance/status update is transactional; an authorization
failure rolls back, while idempotent duplicate behavior continues through the
existing event contract.

The protocol remains `pulselink-softap-commissioning-v1`: length-prefixed
big-endian transcript, P-256 ECDH, ECDSA P-256/SHA-256, HKDF-SHA-256 and
AES-128-GCM. No cipher or wire-contract change was made. The commissioning
compile profile selects the ESP-IDF HKDF implementation only.

## Source files changed in this increment

- `firmware/esp32/main/commissioning_transport.c/.h` — SoftAP/STA lifecycle
  integration and existing driver ownership.
- `firmware/esp32/main/commissioning_state.c` — allowed ordering of credential,
  Wi-Fi, redemption, persistence and terminal states.
- `firmware/esp32/main/commissioning_wifi_controller.c/.h` — bounded controller
  completion/failure cleanup and ONLINE gate.
- `firmware/esp32/main/commissioning_backend_reachability.c` — status result
  handling fails closed, including error/stale result paths.
- `firmware/esp32/main/main.c` — asynchronous credential handoff, Station,
  redemption, storage and status sequence; commissioning event gate.
- `firmware/esp32/main/Kconfig.projbuild` — feature-scoped HKDF dependency.
- `firmware/esp32/tests/commissioning_state_test.c`,
  `commissioning_wifi_controller_test.c`,
  `commissioning_backend_reachability_test.c`,
  `commissioning_event_gate_test.c` — lifecycle/reachability regression tests.
- `apps/android-fcm-test/owner/src/main/AndroidManifest.xml` — nearby Wi-Fi
  permission declarations.
- `apps/android-fcm-test/owner/src/main/java/com/pulselink/owner/MainActivity.java`
  — Owner flow, cancellation, permission and backend status polling.
- `apps/android-fcm-test/owner/src/main/java/com/pulselink/owner/CommissioningTransportClient.java`
  — sensitive in-memory buffer cleanup and session closure.
- `apps/android-fcm-test/owner/src/main/java/com/pulselink/owner/CommissioningDeviceStatus.java`
  and `src/test/.../CommissioningDeviceStatusTest.java` — strict status mapping.
- `server/api/src/modules/device-events/device-event.service.ts` and related
  service/route tests — authenticated transactional ONLINE update.
- `docs/.gitignore` — allow only the WP14 persistent log, summary and this
  report to appear in Git review; other audit artifacts remain ignored.
- `docs/audits/wp14-engineering-log.md` — appended RUN-031.
- `docs/audits/wp14-9-end-to-end-commissioning-report.md` — current summary.
- This report.

The working tree contained many pre-existing modifications and untracked WP14
files before this increment. They were preserved; this list identifies files
changed for the increment and is not a complete Git status inventory.

## Credential storage and security decision

No operational credential storage provider was approved or registered. Current
NVS Encryption and commissioning storage gates remain disabled; the production
path therefore fails closed before credentials can be persisted or the device
can become ONLINE. This avoids treating ordinary NVS as secret storage. No
eFuse selection/write, NVS Encryption enablement, Secure Boot/Flash Encryption
change, board flash/reset, plaintext fallback or build-time-token fallback was
performed. The provider interface/test doubles are not evidence of flash
protection or reboot durability.

Separate blocker: the Owner screen starts a session for an enrolled Device and
uses its enrolled public key, but there is no end-to-end trusted enrollment key
acquisition path for a fresh board. A public key received only over SoftAP is
not trusted. The firmware identity provider is likewise unavailable in the
current runtime configuration.

## Verification evidence

All commands below were run in this increment against the current dirty source.
Exit codes are recorded as observed.

| Check | Result |
| --- | --- |
| Isolated Docker C host suite (`gcc:13.2.0-bookworm`, read-only source mount, network disabled) | Exit 0; 9/9 executable runners passed: physical gate, identity, lifecycle, protocol, crypto interop, credential storage contract, event gate, Wi-Fi controller, backend reachability. Assertion-level total not emitted by the harness. Host-only. |
| Android `:owner:testDebugUnitTest :owner:assembleDebug` | Exit 0; JVM XML: 14 passed, 0 failed, 0 skipped. APK build passed. |
| Android APK | `apps/android-fcm-test/owner/build/outputs/apk/debug/owner-debug.apk`, 914788 bytes. |
| Backend focused `npm test -- --run src/modules/device-events src/modules/device-status src/modules/provisioning` | Exit 0; 8 files, 38 tests passed. |
| Backend full `npm test` | Exit 0; 33 files passed, 2 files skipped; 135 passed, 42 skipped, 0 failed. |
| Backend `npm run typecheck` | Exit 0. |
| Backend `npm run build` | Exit 0; Prisma client generation and TypeScript build. No schema migration. |
| ESP-IDF v5.5.5 default `esp32s3` build (`NINJAFLAGS=-j1`) | Exit 0; `0xf7280 / 0x100000`, `0x8d80` free (3%). |
| ESP-IDF v5.5.5 isolated commissioning-enabled `esp32s3` build | Exit 0; `0xf92f0 / 0x100000`, `0x6d10` free (3%). Compile evidence only; storage security remains disabled. |
| `git diff --check` | Exit 0; line-ending conversion warnings only. |
| PostgreSQL integration | Not run. `TEST_DATABASE_URL` was not configured; no database was contacted or written. |
| Physical Android and ESP32 E2E | Not run / not verified. No board flash/reset or phone install. |

Observed and resolved verification issues: initial Android JVM cases invoked
stubbed `org.json` methods and failed 3 tests; status parsing was made
pure-input testable and final run passed. One host C assertion expected an old
state transition and was aligned with the intended lifecycle; final 9/9
runners passed. Initial IDF commands lacked the IDF/CMake PATH; corrected using
the installed ESP-IDF 5.5.5 Python/toolchain paths. Commissioning profile first
failed link on missing `mbedtls_hkdf`; the feature-scoped Kconfig dependency was
added and isolated profile then built successfully. Failed attempts are not
counted as passes.

The default firmware configuration and the feature compile profile both leave
only about 3% app-partition space. The feature image is larger by `0x1b70`
(7024 bytes) than the baseline measured in this run; no partition layout was
changed. There is no heap/stack runtime measurement from a board.

## Development readiness and database

- Backend start script: `npm run dev` in `server/api`; runtime environment and
  TLS endpoint must be supplied by the developer's local configuration.
- Owner API base URL is entered in the app; Android emulator/device must use a
  reachable host address, not its own `localhost` for a remote development
  backend. No live topology was verified in this run.
- Firmware backend URL/CA configuration is in firmware Kconfig. Backend HTTPS
  must present a CA chain accepted by configured ESP-IDF certificate bundle;
  TLS validation was not relaxed.
- Android commands: from `apps/android-fcm-test`,
  `gradlew.bat :owner:testDebugUnitTest :owner:assembleDebug`.
- Firmware commands and host harness instructions remain in
  `docs/development/firmware-build.md` and `firmware/esp32/tests/README.md`.
- Database integration target: **not configured**. No host/port/database name
  could be verified, so no integration write test was run. Development DB port
  5433 and test DB port 5434 were not written.
- Notification tests use fakes; no real FCM/email was sent.

## Acceptance matrix

| Requirement | Status | Evidence / remaining condition |
| --- | --- | --- |
| Backend Owner Store/Device and provisioning APIs | PARTIALLY VERIFIED | Existing tests/typecheck/build pass; physical Owner flow not run. |
| Shared protocol/crypto | VERIFIED (software) | Shared fixture C host and Android JVM checks included in 9 host runners and 14 JVM tests; no ESP mbedTLS hardware runtime. |
| SoftAP server and firmware integration | COMPILE VERIFIED | Commissioning-enabled ESP-IDF build succeeds; no board server runtime. |
| Android SoftAP handoff | UNIT/BUILD VERIFIED | Permission/transport code builds; no phone Wi-Fi handoff or app lifecycle hardware test. |
| Wi-Fi credentials sent only after trust/session handshake | SOURCE/TEST VERIFIED | No plaintext fallback; requires enrolled trust material. Fresh-board enrollment path is blocked. |
| Redemption and operational credential persistence | BLOCKED | Storage/identity provider unavailable and fail-closed; no protected persistence evidence. |
| Authenticated firmware backend status -> ONLINE | SOURCE/HOST VERIFIED | Controller and status gates tested; no real HTTPS request/runtime confirmation. |
| Event persistence/idempotency and ONLINE status | BACKEND TEST VERIFIED | Backend suite passes; PostgreSQL integration not run. |
| Device Event from ESP32 | NOT VERIFIED | Requires approved protected credential and board runtime. |
| Notification intent/provider delivery | PARTIALLY VERIFIED | Existing fake/test behavior only; no FCM/email delivery. |
| Hardware E2E/reboot recovery | NOT VERIFIED | No physical device tests. |

## Operator steps before E2E and UI/UX polish

1. Approve a per-device identity and operational credential key-custody,
   encrypted-storage provisioning, recovery/factory-reset, revocation and
   replacement-board policy. Provisioning must not use a shared key.
2. Implement/enable the approved provider path only after that policy and the
   required manufacturing/provisioning process are established. Confirm
   protected storage and reboot/power-loss behavior on the target board.
3. Establish a trusted enrollment path for a fresh Device public key and make
   the Owner API return only the enrolled key bound to the Owner's Store
   session. Do not accept a key solely from SoftAP.
4. Configure a non-production HTTPS backend, trusted CA chain, Owner API base
   URL and a dedicated PostgreSQL test DB. Confirm network routing from phone
   and ESP32 to the backend. No secret values should be placed in source/docs.
5. Attach an approved Android device and ESP32-S3; operator reviews the exact
   firmware image and performs any authorized flash operation separately.
6. Run the physical sequence: Owner creates/selects Store, chooses enrolled
   Device, starts provisioning, confirms physical gate, connects SoftAP,
   supplies test Wi-Fi, observes redemption/storage/backend status, then
   triggers an event and verifies DB commit and correct Owner notification
   intent. Reboot and repeat status/event checks.
7. Only after functional/security acceptance, begin a separate UI/UX polish
   increment.

No production/staging database write, migration, real push/email, board flash,
reset, erase or eFuse operation occurred in WP14.31. Overall result remains
**PARTIALLY COMPLETED — HARDWARE E2E NOT VERIFIED**.
