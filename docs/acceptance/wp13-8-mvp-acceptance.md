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
