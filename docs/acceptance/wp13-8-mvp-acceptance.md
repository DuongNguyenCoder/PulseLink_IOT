# WP13.8 — PulseLink MVP Acceptance Harness

## Scope and status

This checklist is the single acceptance record for the Owner-to-Device MVP.
It distinguishes source/test evidence from PostgreSQL integration, Android
device testing, firmware hardware testing and real FCM delivery.

Overall status: **PARTIALLY COMPLETED — SOFTWARE EVIDENCE AVAILABLE; PRODUCTION APP, SOFTAP AND HARDWARE E2E BLOCKED**.

The default notification mode remains `legacy`. No FCM/email was sent and no
staging/production data was changed.

## Evidence matrix

| Area | Current evidence | Status |
| --- | --- | --- |
| SignUp/SignIn/session | Backend unit/route tests and full suite | PASS — automated |
| Store creation and OWNER membership | Service/route coverage; PostgreSQL run blocked in this execution | PARTIAL |
| Owner Device registration/listing | Owner-scoped routes/services/tests | PASS — automated; PostgreSQL recheck pending |
| Enrollment/provisioning session | Route/service/crypto tests; hardware identity unavailable | PARTIAL |
| Device Event authentication/idempotency | Unit/route coverage; PostgreSQL/concurrency recheck pending | PARTIAL |
| Notification job/worker | Unit/route coverage with outbound boundary tests | PASS — automated; real delivery not verified |
| Android Owner application | Production module `apps/android-fcm-test/owner` now exists; no commissioning transport | PARTIAL |
| SoftAP commissioning | Protocol is documented but firmware transport is not implemented | BLOCKED |
| ESP32 identity persistence | Host/compile evidence only; encrypted NVS/eFuse unverified | BLOCKED |
| Physical GPIO4 gate | Host state-machine evidence; board runtime not verified | NOT VERIFIED |
| Real FCM delivery | No approved test provider/device execution | BLOCKED |

## Backend acceptance

For each case, retain request/response evidence with credentials and tokens
redacted.

| Case | Preconditions | Expected result | Status |
| --- | --- | --- | --- |
| New Account signup/signin | Clean test account | Account/session created according to auth contract | PASS — automated |
| Create Store | Authenticated Account | Store and OWNER membership committed atomically | PASS — unit/route; PostgreSQL rerun pending |
| Cross-Store access | Account has Store A only | Store B resources return authorization failure | PASS — automated coverage |
| Register/list Device | Active OWNER membership | Device is bound to selected Store; metadata contains no secret | PASS — automated coverage |
| Enrollment | Owner scope, valid P-256 public key | Device enrollment updates only the scoped Device | PASS — automated coverage |
| Provisioning session expiry | Expired session | Redemption rejected; no operational credential issued | PASS — automated coverage |
| Provisioning replay | Consumed session | Second redemption rejected | PASS — automated coverage |
| Device Event Store scope | Valid Device credential | Store derived from authenticated Device, not payload | PASS — automated coverage |
| Duplicate event | Same `eventId` retry | No duplicate event/job beyond contract | PARTIAL — PostgreSQL rerun pending |
| Concurrent duplicate event | Concurrent same `eventId` requests | Database uniqueness prevents duplicate | BLOCKED — PostgreSQL unavailable |
| Device disabled/revoked | Device not eligible | Event rejected and no notification job created | PASS — automated coverage; PostgreSQL rerun pending |
| Worker/provider failure | Fake provider at outbound boundary | Retry/invalid-token classification follows worker contract | PASS — automated |

## Android acceptance

The existing module is `apps/android-fcm-test`, package
`com.pulselink.fcmtest`. It is not the production Owner application.

| Case | Expected result | Status |
| --- | --- | --- |
| Diagnostic payload parsing | Validates `eventId`/`eventType`; rejects malformed payload | PASS — unit test |
| Diagnostic debug build | APK builds without production claims | PASS — `assembleDebug` |
| Production SignUp/SignIn | `apps/android-fcm-test/owner`, HTTPS API client and Keystore-backed session | PASS — build evidence; device click-through not verified |
| Store/Device management UI | Production Owner UI calls real Store/Device contracts | PASS — build evidence; device click-through not verified |
| Commissioning/SoftAP UI | Uses approved authenticated protocol | BLOCKED — transport not implemented |
| Permission/session/logout behavior | Tested on Android device/emulator | NOT VERIFIED — no device click-through |
| Notification tap on a real device | Opens supported screen after validated payload | NOT VERIFIED |

The production artifact is `apps/android-fcm-test/owner/build/outputs/apk/debug/owner-debug.apk`.
It is a separate application module with application ID `com.pulselink.owner`.
It is not the diagnostic FCM app and does not contain a fake commissioning
success path.

## ESP32-S3 acceptance

| Case | Expected result | Status |
| --- | --- | --- |
| ESP-IDF compile | Source builds with ESP-IDF 5.5.5, target `esp32s3` | PASS — compile-only |
| Firmware size | App fits partition with operational headroom | PASS with warning — 3% free |
| Physical confirmation state machine | Short/long press, timeout, cancel and consume-once behavior | PASS — host assertions; board GPIO not verified |
| GPIO4 electrical behavior | Confirmed on the designated board | NOT VERIFIED |
| Per-device protected identity | Private key persists and is protected across reboot | BLOCKED — eFuse/encrypted NVS not verified |
| SoftAP startup gate | Only physical confirmation opens commissioning | BLOCKED — transport absent |
| Wi-Fi credential exchange | Authenticated/confidential/replay-protected channel | BLOCKED |
| Wi-Fi join/reconnect | Device reports only verified backend/device state | BLOCKED — no hardware test |
| Device Event retry | Existing firmware event contract remains intact | NOT VERIFIED on hardware |

## Manual E2E procedure for a future approved test bench

1. Create a fresh test Account and verify email through the approved test
   mechanism.
2. Sign in with the production Owner application.
3. Create a Store and capture the returned Store ID without exposing tokens.
4. Register a Device in that Store and verify the safe metadata response.
5. Enroll the Device with its actual per-device public key.
6. Press and hold the verified physical button on the designated ESP32-S3;
   capture the physical-gate evidence.
7. Connect the Owner app to the authenticated SoftAP protocol and send Wi-Fi
   credentials only after Device/session trust verification.
8. Confirm backend provisioning redemption, Wi-Fi join and the real online
   signal. Do not equate record creation with online status.
9. Trigger the physical Device Event and verify the event is stored under the
   authenticated Device's Store.
10. Retry the same event ID and verify idempotency.
11. Verify the notification job/worker. Only with an approved test FCM project
   and device may real delivery be tested.
12. Reboot the ESP32 and repeat the safe recovery check.
13. Attempt cross-Store access with a second Account and verify denial.
14. Disable/revoke the Device and verify event/provisioning denial.

For every step record preconditions, exact action, expected result, evidence
location, timestamp and one of `PASS`, `FAIL`, `BLOCKED` or `NOT VERIFIED`.

## Required environment gates

- Dedicated PostgreSQL test database must be verified as
  `127.0.0.1:5434/pulselink_test` before any write/integration run.
- No migration reset, production/staging access or destructive database
  operation is allowed.
- Hardware tests require an explicitly identified ESP32-S3 board and approved
  interaction procedure.
- FCM delivery requires an approved test Firebase project/device. Real tokens
  and credentials must not be stored in the repository or logs.
- Hardware security changes require separate approval; do not select an eFuse
  block or enable encrypted NVS opportunistically.

## WP13.10 verification record

Status: `PARTIALLY COMPLETED`.

| Area | Evidence | Status |
| --- | --- | --- |
| Owner app unit/build | `./gradlew.bat :owner:testDebugUnitTest :owner:assembleDebug`; separate `com.pulselink.owner` APK | PASS — build evidence |
| Android click-through | `adb devices` returned no attached emulator/device | BLOCKED / NOT VERIFIED |
| PostgreSQL target | Healthy dedicated service at `127.0.0.1:5434/pulselink_test` | PASS — target verified |
| PostgreSQL integration | Guarded rerun: 40 passed, 2 skipped; 1 file passed, 1 skipped | PASS with existing skips |
| Provisioning/device-event/notification focused tests | 37 passed across 8 files | PASS |
| SoftAP/Wi-Fi credential exchange | No transport implementation; no credentials sent | BLOCKED |
| GPIO4/eFuse/protected identity persistence | No new hardware interaction | NOT VERIFIED |
| Real FCM delivery | No approved test project/device; no FCM sent | BLOCKED |

The initial integration invocation without test password configuration failed
before application assertions; the subsequent guarded rerun used the local
test-only configuration without exposing its value. No migration, reset,
production/staging access, firmware flash, eFuse operation, FCM or email send
was performed for WP13.10.

## WP13.11–WP13.15 continuation record

Status: `PARTIALLY COMPLETED`.

| Requirement | Evidence | Result |
| --- | --- | --- |
| Owner app crash hardening | API-compatible response reader and Activity lifecycle guard | PASS — source/unit evidence |
| Owner/diagnostic Android build | Gradle unit tests and debug builds | PASS |
| Android device launch | Device `23021RAAEG`, Android 15; process/activity observed | PASS — launch smoke only |
| Fixed APK install and SignUp/SignIn | `adb install -r` refused with user restriction | BLOCKED / NOT VERIFIED |
| Backend regression | Typecheck, build and Prisma validation exit 0 | PASS |
| PostgreSQL integration | `127.0.0.1:5434/pulselink_test`: 40 passed, 2 skipped | PASS with skips |
| SoftAP/Wi-Fi commissioning | No verified transport or credential exchange | BLOCKED |
| Protected device identity | No encrypted-NVS/eFuse/board persistence evidence | BLOCKED |
| Hardware E2E/FCM | Not executed; no real FCM sent | BLOCKED / NOT VERIFIED |

The next required runtime action is operator-approved installation of the new
APK on the Android device, followed by redacted Logcat capture while exercising
valid and invalid SignUp/SignIn and API-error paths. This record does not infer
those results from the build or from the old installed APK.

## WP13.11-R1 runtime record

| Check | Evidence | Result |
| --- | --- | --- |
| ADB target | Device `23021RAAEG`, state `device`, Android 15 | PASS |
| APK/package | `owner-debug.apk`, `com.pulselink.owner`, version `0.1.0`/code `1` | PASS |
| APK installation | `adb install -r` | PASS |
| App launch/process | Owner Activity visible; process remained alive | PASS |
| Empty SignUp validation | UI displayed validation error; no crash | PASS |
| Empty SignIn validation | UI displayed validation error; no crash | PASS |
| SignUp success | No authorized test account supplied | NOT VERIFIED |
| SignIn success/failure against API | No authorized test credential supplied | NOT VERIFIED |
| API/network error path | Not exercised with a backend request in this run | NOT VERIFIED |
| Owner Logcat | No `FATAL EXCEPTION` for Owner process in captured window | PASS — smoke window |

No app data was cleared, no uninstall was performed, and no FCM/email,
database migration or production/staging operation was performed.

The supplied test credential was not submitted because the app had no approved
HTTPS API base URL configured and no local API listener was available. The
Owner client intentionally rejects plain HTTP; authenticated mobile runtime
cases remain `NOT VERIFIED` until an approved HTTPS test endpoint is provided.

Focused backend regression:
`npm test -- --run src/modules/auth src/modules/stores src/modules/devices
src/modules/provisioning src/modules/device-events src/modules/notifications
src/test-support/integration-db-guard.test.ts` — **PASS**, 99 passed, 2
skipped; 24 files passed, 1 skipped.

The user supplied an HTTPS API hostname and test-account credential for a
follow-up runtime check. A read-only request to
`https://pulselink.chuanxinstore.com/health/live` timed out after 15 seconds;
DNS resolved, but API reachability and test-environment identity were not
established. The credential was not submitted to that endpoint. Authenticated
SignUp/SignIn therefore remains `BLOCKED / NOT VERIFIED` pending an approved,
reachable HTTPS test endpoint.

## WP13.11-R2 supplied endpoint record

| Check | Evidence | Result |
| --- | --- | --- |
| HTTPS health | `GET /health/live` returned HTTP 200 | PASS — read-only |
| SignIn on installed Owner APK | UI reached `Signed in securely`; process alive | PASS — device runtime |
| SignIn Logcat | No fatal exception in filtered Owner process log | PASS |
| Store/Device write flow | Not run against an environment not independently identified as test-only | NOT VERIFIED |
| Session restore change | New APK reinstall refused by `INSTALL_FAILED_USER_RESTRICTED` | NOT VERIFIED |

The supplied credential was used only by direct UI input and was not written to
source, logs, reports or persistent test artifacts. No Store/Device records,
migrations, FCM/email sends or production/staging changes were performed.

## WP13.11-R3 authentication/session record

| Check | Evidence | Result |
| --- | --- | --- |
| New APK update | `adb install -r` succeeded; app data preserved | PASS |
| SignIn | UI displayed `Signed in securely`; process alive | PASS — device runtime |
| Restart/session restore | Force-stop/relaunch displayed `Session restored` | PASS — device runtime |
| Wrong-password no-crash | Process remained alive; no fatal exception | PASS — crash safety |
| Wrong-password error text | UI extraction did not capture stable status text | NOT VERIFIED |
| Store/Device mutation | Not executed | NOT VERIFIED |

## WP14.0 execution record

Status: `PARTIALLY COMPLETED`.

| Area | Result | Evidence |
| --- | --- | --- |
| Owner HTTPS SignIn | PASS | Android 15 device UI and process evidence |
| Owner session restore | PASS | Force-stop/relaunch showed restored session |
| Backend provisioning/event/notification tests | PASS | 99 passed, 2 skipped |
| Firmware host tests | PASS | Docker GCC 13.2.0; both executables exit 0 |
| Firmware build | PASS — compile-only | ESP-IDF 5.5.5 evidence; no flash |
| SoftAP transport | BLOCKED | No firmware/app transport implementation |
| Protected identity persistence | BLOCKED | Encrypted NVS/eFuse not runtime verified |
| Wi-Fi provisioning | BLOCKED | No authenticated credential channel |
| Board Device Event | BLOCKED | No newly commissioned board |

No Store/Device write, migration, reset, firmware flash, eFuse operation or
FCM/email send was performed.

## WP14.1 execution record

Status: `PARTIALLY COMPLETED`.

| Area | Result | Evidence |
| --- | --- | --- |
| Existing provisioning contract | PASS | Backend and host canonical/signature tests |
| Physical gate host runtime | PASS | Docker GCC 13.2 executable |
| Identity/canonical payload host runtime | PASS | Docker GCC 13.2 executable |
| Owner SignIn/session restore | PASS | Android 15 device |
| Fresh ESP-IDF build | BLOCKED | `idf.py` unavailable in current shell |
| Firmware provisioning client | BLOCKED | No implementation in current source |
| SoftAP trust/transport | BLOCKED | No implementation in firmware/app |
| Protected NVS identity persistence | BLOCKED | No board/eFuse/NVS runtime evidence |
| Board Wi-Fi/Device Event E2E | BLOCKED | No commissioning run |

No old firmware artifact was used to claim a fresh build. No plaintext fallback,
shared bootstrap secret, Store/Device write, migration, flash, eFuse or FCM/email
operation was performed.

## WP14.2 execution record

Status: `PARTIALLY COMPLETED`.

| Area | Result | Evidence |
| --- | --- | --- |
| ESP-IDF 5.5.5 toolchain | **PASS** | Fresh current-source build using the installed Python 3.11 ESP-IDF environment |
| ESP32-S3 firmware build | **PASS** | `idf.py build` with `NINJAFLAGS=-j1`, exit 0 |
| Partition headroom | **PASS WITH RISK** | `0xf7220` of `0x100000`; `0x8de0` free (~3%) |
| Trust bootstrap | **PROPOSED / APPROVAL REQUIRED** | ADR-0004 defines the boundary and open transport/trust-anchor decisions |
| Protected identity storage | **BLOCKED** | No approved eFuse/security configuration or board persistence evidence |
| SoftAP/Wi-Fi credential exchange | **BLOCKED** | Deliberately not implemented before trust/storage approval |
| Hardware commissioning | **NOT VERIFIED** | No board flash or runtime operation performed |

The build was fresh from the current dirty source; no old artifact was used as
proof. The installed export script has a Python 3.14 path mismatch, so the
documented direct Python 3.11 invocation was used. No eFuse, Flash Encryption,
Secure Boot, database, migration, production/staging endpoint or real
FCM/email provider was touched.

## WP14.3 execution record

Status: `PARTIALLY COMPLETED`.

| Area | Result | Evidence |
| --- | --- | --- |
| Trust bootstrap alternatives | **PROPOSED / APPROVAL REQUIRED** | ADR-0004 compares per-device TLS pinning and authenticated ephemeral ECDH |
| Commissioning lifecycle controller | **PASS** | 24 host assertions in Docker GCC 13.2.0 |
| Physical gate integration | **NOT VERIFIED** | Controller is not wired to GPIO or SoftAP |
| Protected identity persistence | **BLOCKED** | No approved eFuse/NVS runtime configuration |
| SoftAP/Wi-Fi credentials | **BLOCKED** | No approved authenticated transport implementation |
| Fresh firmware build | **PASS** | ESP-IDF 5.5.5, ESP32-S3, single-job build exit 0 |
| Firmware size | **PASS WITH RISK** | 3% app partition headroom remains |

No plaintext fallback, shared bootstrap secret, eFuse write, board flash,
database migration, production/staging write or real FCM/email send was used.

## WP14.4 execution record

Status: `COMPLETED FOR DESIGN/FOUNDATION SCOPE`.

| Area | Result | Evidence |
| --- | --- | --- |
| Trust bootstrap comparison | **PASS — DESIGN** | ADR-0004 compares TLS/public-key pinning and authenticated ECDH |
| Preferred option | **PROPOSED — OWNER APPROVAL REQUIRED** | Authenticated ECDH rooted in enrolled Device key |
| Protected identity source audit | **PASS — SOURCE** | Provider conditions and fail-closed behavior inspected |
| Encrypted NVS/private-key persistence | **NOT VERIFIED** | No approved eFuse configuration or board runtime evidence |
| SoftAP/Wi-Fi exchange | **BLOCKED** | Explicitly excluded until trust/storage approval |
| Host tests | **PASS** | Physical gate, identity and commissioning controller tests |
| Firmware build | **PASS — COMPILE ONLY** | ESP-IDF 5.5.5, ESP32-S3, ~3% partition headroom |

The secure commissioning system is not accepted as hardware-ready. No
plaintext fallback, shared secret, eFuse write, flash, database migration or
real notification send was performed.

## WP14.5 execution record

Status: `COMPLETED FOR APPROVAL-PACKAGE SCOPE`.

| Requirement | Result | Evidence |
| --- | --- | --- |
| Decision register with owner approval fields | **PASS — DESIGN** | ADR-0004 TB/ST decision matrix; all statuses remain OPEN |
| ECDH protocol candidate | **PASS — NOT FROZEN** | Message sequence, transcript fields and negative-test requirements documented |
| Protected-storage recovery matrix | **PASS — DESIGN** | Empty, corrupt, unreadable, interrupted-write, reboot and replacement cases recorded |
| SoftAP listener/Wi-Fi exchange | **BLOCKED** | Explicitly not implemented pending approvals |
| Hardware protected storage | **NOT VERIFIED** | No board runtime/eFuse evidence |
| Host/build evidence | **RETAINED** | WP14.3 host tests and ESP-IDF build evidence |

No decision was self-approved. No eFuse, flash, database, migration, Wi-Fi
credential, FCM/email or production/staging operation was performed.

## WP14.7 execution record

Status: `PARTIALLY COMPLETED`.

| Area | Result | Evidence |
| --- | --- | --- |
| Shared transcript encoding | **PASS** | C and Android deterministic vector tests |
| Android unit tests/build | **PASS** | Gradle Owner test and debug APK build |
| Firmware build | **PASS — COMPILE ONLY** | ESP-IDF 5.5.5 / ESP32-S3 |
| ECDH/HKDF/AES-GCM transport | **NOT IMPLEMENTED** | No crypto/session transport code added |
| SoftAP discovery/listener | **BLOCKED** | Not implemented |
| Protected Device identity | **BLOCKED** | Encrypted NVS and board persistence unavailable |
| Wi-Fi credential exchange | **BLOCKED** | Deliberately not exposed before identity/transport verification |
| Hardware E2E | **NOT VERIFIED** | No board run |

The implementation remains below the hardware commissioning acceptance gate.

## WP14.8 execution record

Status: `PARTIALLY COMPLETED`.

| Area | Result | Evidence |
| --- | --- | --- |
| Existing C/Java transcript foundation | **PASS** | Host vector tests and Android unit/build evidence |
| SoftAP firmware transport | **BLOCKED** | No SoftAP lifecycle or local server in source |
| ECDH/HKDF/AES-GCM integration | **BLOCKED** | No approved runtime trust-anchor delivery or crypto transport implementation |
| Android Wi-Fi commissioning | **BLOCKED** | No SoftAP discovery/network handoff/client flow |
| Backend redemption client | **BLOCKED** | Firmware has no redemption client; existing API remains server-side contract |
| Protected identity persistence | **BLOCKED** | Encrypted NVS/eFuse not configured or runtime verified |
| Fresh firmware build | **PASS — COMPILE ONLY** | ESP-IDF 5.5.5 / ESP32-S3; ~3% headroom |
| Hardware E2E | **NOT VERIFIED** | No board operation performed |

The package stopped at the security boundary rather than adding an
unauthenticated or plaintext prototype path.

## WP14.6 execution record

Status: `BLOCKED`.

| Area | Result | Evidence |
| --- | --- | --- |
| Existing commissioning controller | **PASS — HOST ONLY** | Prior Docker host tests |
| SoftAP firmware transport | **BLOCKED** | No implementation in current firmware |
| Android commissioning client | **BLOCKED** | No SoftAP discovery/handshake/credential client |
| Authenticated ECDH protocol | **BLOCKED** | KDF/AEAD and trust-anchor decisions remain OPEN |
| Protected identity provider | **BLOCKED** | Operational build is fail-closed; NVS security not runtime verified |
| Hardware E2E | **NOT VERIFIED** | No board commissioning run |

WP14.6 did not add a weak fallback or claim a prototype transport. Owner
approval of the cryptographic/trust decisions and protected-storage path is
required before implementation can proceed safely.
