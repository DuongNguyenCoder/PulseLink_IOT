# WP14.9 — End-to-End Commissioning Acceptance Report

Date: 2026-10-28
Status: **PARTIALLY COMPLETED — SOFTWARE FOUNDATION PASS; TRANSPORT AND HARDWARE E2E BLOCKED**

> **WP14.31 current status (WP14-RUN-031): PARTIALLY COMPLETED — HARDWARE E2E NOT VERIFIED.** The detailed, current increment evidence is in [WP14.31 report](wp14-31-full-commissioning-implementation-report.md). The historical sections below are retained as written and are not current implementation claims.

> **WP14.32 superseding status (WP14-RUN-032): PARTIALLY COMPLETED — PROTECTED STORAGE AND HARDWARE E2E BLOCKED.** Operator-only Device-bound proof enrollment and database key uniqueness are implemented; the verified PostgreSQL test migration and integration suite pass. See [WP14.32 report](wp14-32-enrollment-storage-e2e-closure-report.md).

## Executive summary

The repository contains an Owner-scoped backend provisioning contract, a
fail-closed ESP-IDF identity-provider boundary, a physical-gate state machine,
a commissioning lifecycle controller and a C/Android transcript encoder.
Those components are source/build/host-test evidence only.

The complete flow was not claimed because the current source still lacks a
SoftAP server, Android SoftAP commissioning client, firmware redemption client,
runtime protected identity storage and board evidence. No insecure fallback was
introduced.

## Current architecture and actual implementation

```text
Owner session -> Store OWNER authorization -> Device registration/enrollment
                                      \-> provisioning session/challenge

Firmware: physical gate -> lifecycle controller -> [SoftAP transport: absent]
Firmware identity: conditional encrypted-NVS provider -> fail-closed by default
Android: HTTPS Owner API + secure session -> transcript encoder only
Backend: session/redeem and Device Event contracts already exist
```

The existing backend redemption contract verifies the bootstrap value, challenge,
expiry, Device/Store binding and DER ECDSA signature before consuming the session
and issuing a Device operational credential. That contract was not changed in
WP14.9.

## WP14.31 current implementation and evidence

The current working tree now has an integrated, compile-tested SoftAP/Owner
transport path, bounded asynchronous Station Wi-Fi controller, backend
redemption then protected-storage gate then authenticated status ordering, and
Owner status polling. The backend marks a Device `ONLINE` atomically with
acceptance of its first authenticated Device Event; retries remain idempotent.
The firmware event sender is gated on the commissioning ONLINE lifecycle.

Fresh evidence in WP14-RUN-031: all 9 Docker host C runners passed; Android JVM
tests passed 14/14 and debug APK built (914788 bytes); backend focused tests
passed 38/38; full suite passed 135 with 42 skipped and 0 failed; backend
typecheck/build passed; default ESP-IDF build produced `0xf7280` bytes and the
isolated commissioning-enabled build produced `0xf92f0` bytes, each within the
`0x100000` app partition with 3% reported free; `git diff --check` passed.
The isolated profile enables only the HKDF implementation dependency and does
not enable protected storage. PostgreSQL integration was not run because the
test DB URL was not configured. These results are software/compile evidence,
not board runtime evidence.

Remaining gates: no approved/provisioned protected operational credential
provider or enrolled-device bootstrap path is available to the Owner flow;
there is no Android/ESP32 runtime evidence for SoftAP, Wi-Fi, storage recovery,
backend reachability or Device Event. FCM/email delivery was not invoked.

## Source changes available for this workstream

| File | Purpose |
| --- | --- |
| `firmware/esp32/main/commissioning_state.h/.c` | Transport-independent commissioning lifecycle and terminal/consume-once rules |
| `firmware/esp32/main/commissioning_protocol.h/.c` | Bounded binary transcript encoder; no network or credential handling |
| `firmware/esp32/tests/commissioning_state_test.c` | Host lifecycle tests |
| `firmware/esp32/tests/commissioning_protocol_test.c` | Host transcript vector/boundary tests |
| `apps/android-fcm-test/owner/.../CommissioningTranscript.java` | Android mirror of the transcript encoder |
| `apps/android-fcm-test/owner/.../CommissioningTranscriptTest.java` | Android transcript tests |
| `firmware/esp32/main/esp_device_identity_provider.c` | Existing conditional NVS/mbedTLS provider; unavailable in operational config |
| `docs/architecture/softap-commissioning-protocol.md` | Versioned transcript baseline and transport security boundary |
| `docs/decisions/ADR-0004-secure-commissioning-trust-bootstrap.md` | Trust, storage and recovery decisions |

No SoftAP listener, ECDH/HKDF/AES-GCM transport, Wi-Fi credential endpoint,
backend redemption client or operational-token persistence was added because
the protected identity and trust-anchor prerequisites are not verified.

## Protocol baseline

The transcript domain is `pulselink-softap-commissioning-v1`. Fields are
length-prefixed big-endian values with protocol version, session ID, Device
SPKI, challenge/session context, expiry, client context, both nonces and both
ephemeral public keys.

The intended future transport baseline is P-256 ECDH, ECDSA P-256/SHA-256,
HKDF-SHA-256 and AES-128-GCM. The actual key derivation, AEAD and message
transport are **not implemented or interoperably verified** in this report.

## Test and build evidence

### Host C

Command shape used with source mounted read-only and network disabled:

```powershell
docker run --rm --network none --read-only `
  --tmpfs /tmp:rw,exec,nosuid,size=64m `
  --mount type=bind,src=D:/project-PulseLink,dst=/src,readonly `
  --workdir /src/firmware/esp32 gcc:13.2.0-bookworm sh -lc "..."
```

The executable suite exited `0` after the transcript test boundary assertions
were corrected. Physical-gate, identity/canonical-payload, commissioning-state
and transcript tests passed. These are host tests, not ESP32 runtime evidence.

### Android

```powershell
./gradlew.bat :owner:testDebugUnitTest :owner:assembleDebug
```

Result: `BUILD SUCCESSFUL`, exit code `0`. This verifies the Owner module and
transcript unit tests, not SoftAP discovery or Android Wi-Fi handoff.

### Firmware

```powershell
$env:NINJAFLAGS='-j1'
& $idfPython "$idfRoot\tools\idf.py" --version
& $idfPython "$idfRoot\tools\idf.py" build
```

Result: ESP-IDF `v5.5.5`, target `esp32s3`, exit code `0`. The build produced
`pulselink_firmware.bin` at `0xf7220` bytes in a `0x100000` app partition,
leaving `0x8de0` bytes (approximately 3%) free. A non-fatal `ESP_ROM_ELF_DIR`
environment warning was observed.

### Backend/PostgreSQL

Prior dedicated integration evidence used `127.0.0.1:5434/pulselink_test` and
reported 40 passed, 2 skipped. WP14.9 made no backend/schema change and did not
rerun a write suite. No development port `5433`, staging or production database
was used.

## E2E acceptance matrix

| Step | Result | Evidence/blocker |
| --- | --- | --- |
| Owner SignUp/SignIn | PASS | Existing Android/backend evidence |
| Create Store and OWNER membership | PASS | Existing backend tests/evidence |
| Register Device in selected Store | PASS | Existing Owner-scoped API tests/evidence |
| Start provisioning session | PASS | Existing backend contract/tests |
| Discover ESP32 SoftAP | BLOCKED | No firmware SoftAP implementation |
| Physical confirmation on board | NOT VERIFIED | Host logic only; no board run |
| Verify enrolled Device identity | BLOCKED | No runtime protected identity/trust-anchor delivery |
| ECDH/HKDF/AES-GCM handshake | BLOCKED | Only transcript encoder exists |
| Send encrypted Wi-Fi credentials | BLOCKED | No transport endpoint |
| ESP32 joins Wi-Fi | NOT RUN | No commissioning transport/board run |
| Backend redemption from firmware | BLOCKED | No firmware redemption client |
| Operational credential persistence | BLOCKED | Encrypted NVS not runtime verified |
| Device Event from board | NOT RUN | No commissioned board |
| Android completion status | BLOCKED | No commissioning client |
| Retry/reconnect/reboot E2E | NOT RUN | Hardware and storage prerequisites missing |

## Security limitations

- Normal NVS is not treated as protected private-key storage.
- No eFuse was selected or written.
- Flash Encryption, Secure Boot and NVS Encryption were not enabled on hardware.
- A public key received only from SoftAP is not trusted.
- No plaintext, shared-secret or TLS-validation-bypass fallback was added.
- No password, private key, session key, bearer token or connection secret was
  written to logs or this report.

## Operator steps required for hardware acceptance

These steps are intentionally not executed by this worktree run:

1. Approve the trust-anchor delivery contract and protected-storage policy.
2. Verify the designated ESP32-S3 board and physical GPIO4 behavior.
3. Provision/verify the approved identity storage using a separately approved
   hardware-security procedure; do not improvise an eFuse block.
4. Implement and review the firmware/Android crypto transport and SoftAP path.
5. Build the exact source revision, then perform the board commissioning test
   without logging credentials.
6. Verify redemption, Device Event Store scope, duplicate event behavior and
   reboot recovery on the dedicated test backend.

No flash, erase, reset, eFuse write, production/staging write or real FCM/email
operation was performed for this report.

## Re-run guidance

Use the firmware build instructions in `docs/development/firmware-build.md`,
the Android Gradle tasks above and the Docker host-test instructions in
`firmware/esp32/tests/README.md`. Reconfirm the database target before any
write-capable integration test. Do not mark hardware steps PASS from compile or
host-test output.

## WP14.10 implementation update

Status: **PARTIALLY COMPLETED — CRYPTO HELPERS AND TESTS PASS; COMMISSIONING TRANSPORT REMAINS BLOCKED**.

### Source changes

- Added `firmware/esp32/main/commissioning_crypto.h/.c` using ESP-IDF/mbedTLS
  for ephemeral P-256 generation, raw public-key export, ECDH shared-secret
  derivation, HKDF-SHA-256, AES-128-GCM and SPKI/ECDSA signature verification.
- Added `CommissioningCrypto.java` using Android standard `EC`, `ECDH`,
  `SHA256withECDSA`, `HmacSHA256` and `AES/GCM/NoPadding` APIs.
- Added Android crypto tests for shared-secret equality, HKDF/AES-GCM round
  trip, tamper rejection and signature/message mutation rejection.
- Kept all helpers disconnected from production Wi-Fi credential handling while
  protected identity and trust-anchor delivery remain unavailable.

### WP14.10 verification

| Check | Result | Evidence |
| --- | --- | --- |
| ESP-IDF mbedTLS crypto helper compile | **PASS** | Fresh ESP-IDF 5.5.5 build, `esp32s3`, exit 0 |
| Android crypto unit tests | **PASS** | `:owner:testDebugUnitTest`, included in successful Gradle run |
| Android debug build | **PASS** | `:owner:assembleDebug`, exit 0 |
| Firmware size | **PASS WITH RISK** | `0xf7220`/`0x100000`; `0x8de0` free (~3%) |
| C/Java cryptographic interoperability | **NOT VERIFIED** | C helper target-compiled; no shared runtime vector executed across C and Java |
| SoftAP lifecycle/server | **BLOCKED** | No transport implementation |
| Android Wi-Fi handoff | **BLOCKED** | No commissioning UI/network flow |
| Protected identity persistence | **BLOCKED** | Encrypted NVS/provider disabled and not board-verified |
| Redemption/operational credential | **BLOCKED** | No firmware redemption client or persistence path |
| Device Event from board | **NOT RUN** | No board commissioning |

The crypto helpers are not evidence that the device identity is protected or
that a local channel is authenticated end-to-end. No Wi-Fi password, private
key, session key or bearer token was used in tests or written to logs.

### Remaining implementation boundary

The next code required is the SoftAP lifecycle/server, a server-delivered
verified trust anchor bound to the Owner/session/Device, firmware redemption
client and Android Wi-Fi handoff. Those parts must use the helpers above and
must remain fail-closed when the identity provider is unavailable. Until then,
the full Owner-to-board flow is not accepted.

## WP14.11 implementation update

Status: **PARTIALLY COMPLETED — OWNER-SESSION TRUST MATERIAL DELIVERY AND REGRESSION COVERAGE PASS; HARDWARE COMMISSIONING REMAINS NOT RUN**.

### Implemented source changes

- `server/api/src/modules/provisioning/provisioning.service.ts` now returns the
  enrolled Device public key together with a newly created provisioning session.
  The key is public SPKI material only; private keys and operational credentials
  are not returned. Session creation fails closed with HTTP 409 when the enrolled
  Device has no public key.
- `server/api/src/modules/provisioning/provisioning.routes.ts` exposes that
  already-enrolled public key in the existing authenticated Owner session
  response. No new route, schema, migration or Device Event contract was added.
- `server/api/src/modules/provisioning/provisioning.service.test.ts` adds
  regression coverage for public-key delivery and the missing-identity fail-closed
  path.
- `apps/android-fcm-test/owner/.../ApiClient.java` contains the existing Owner
  client method for the provisioning-session endpoint, including the response
  field needed by a future commissioning client. The method does not send Wi-Fi
  credentials or claim commissioning success.

This is a trust-bootstrap boundary only. The response field does not by itself
prove that a board is connected or that a public key received from SoftAP is
authentic; the Android client must compare it with a proof from the enrolled
Device before sending any credential.

### WP14.11 verification evidence

| Check | Result | Evidence |
| --- | --- | --- |
| Backend provisioning focused tests | **PASS** | `npm test -- --run src/modules/provisioning`; 4 files, 13/13 tests passed, exit 0 |
| Backend full unit/route suite | **PASS WITH SKIPS** | `npm test -- --run`; 32 files passed, 2 skipped; 127 passed, 42 skipped, exit 0 |
| Backend typecheck | **PASS** | `npm run typecheck`, exit 0 |
| Backend build/Prisma client generation | **PASS** | `npm run build`, Prisma 7.10.0 generated and TypeScript build completed, exit 0 |
| Owner Android unit tests/debug APK | **PASS** | `./gradlew.bat :owner:testDebugUnitTest :owner:assembleDebug`, `BUILD SUCCESSFUL`, exit 0 |
| Owner APK artifact | **PASS** | `apps/android-fcm-test/owner/build/outputs/apk/debug/owner-debug.apk`, 901335 bytes |
| Firmware source/build | **PASS — prior fresh build** | ESP-IDF 5.5.5, target `esp32s3`, `NINJAFLAGS=-j1`, binary `0xf7220` / partition `0x100000` |
| C host tests | **PASS — prior run** | Docker GCC 13.2.0 suite exited 0; no source changes to the tested C helpers in WP14.11 |
| C/Java runtime interoperability | **NOT VERIFIED** | No shared C-and-Java runtime vector was executed |
| PostgreSQL integration rerun | **NOT RUN** | No new DB write was required for this source-only contract change |
| SoftAP discovery/handoff | **NOT RUN** | No production SoftAP listener or Android Wi-Fi handoff exists |
| Firmware redemption/operational credential | **BLOCKED** | No firmware redemption client or protected persistence runtime evidence |
| Device Event from commissioned board | **NOT RUN** | No board commissioning was performed |
| Real FCM/email | **NOT RUN** | Explicitly excluded; fake/provider tests only |
| `git diff --check` | **PASS** | No whitespace errors; Git emitted existing LF/CRLF normalization warnings only |

### WP14.11 acceptance matrix

| Requirement | Result | Evidence/blocker |
| --- | --- | --- |
| Owner authentication and Store-scoped session creation | **PASS** | Existing Owner authorization tests plus provisioning focused suite |
| Enrolled Device public key available to Owner commissioning client | **PASS** | Existing session route now returns enrolled SPKI public key |
| Missing Device identity rejected | **PASS** | New service regression test; 409 fail-closed behavior |
| Trust anchor proof from board | **BLOCKED** | No SoftAP handshake/proof-of-possession path wired |
| Encrypted Wi-Fi credential exchange | **BLOCKED** | No transport endpoint; no plaintext fallback added |
| Backend redemption from firmware | **BLOCKED** | Firmware client not implemented |
| Operational credential persistence | **NOT VERIFIED** | Encrypted NVS/eFuse and board reboot persistence remain unverified |
| Authenticated Device Event from board | **NOT RUN** | Requires commissioned board and operational credential |
| Notification intent and Owner display | **NOT RUN** | No new event was generated; real FCM remains disabled |
| Hardware E2E | **BLOCKED** | No flash/reset/board runtime operation performed |

### Security and scope confirmation

No eFuse was written, no firmware was flashed or erased, no board was reset,
and no production/staging database was written. No Wi-Fi password, private key,
session key, bearer token or database secret was logged or added to this report.
The existing notification legacy behavior and `StaffPushToken` were unchanged.

The remaining high-value implementation boundary is the reviewed, interoperable
SoftAP handshake and firmware/Android transport. It must remain fail-closed until
the enrolled-key proof, protected identity storage policy and board runtime
procedure are available; the current results must not be reported as software or
hardware E2E acceptance.

## WP14.15 implementation update

Status: **PARTIALLY COMPLETED — C/JAVA CRYPTO VALUE INTEROPERABILITY VERIFIED; SOFTAP TRANSPORT, FIRMWARE REDEMPTION AND HARDWARE E2E REMAIN BLOCKED**.

### Implemented and tested

- Added test-only fixture
  `firmware/esp32/tests/fixtures/commissioning_crypto_v1.txt` containing fixed
  P-256 keys, public keys, shared secret, HKDF output, AES-GCM output and an
  ECDSA signature. These are deterministic test values and are not production
  credentials.
- Added `firmware/esp32/tests/commissioning_crypto_host_test.c`, a host-only
  OpenSSL EVP adapter. It reads the same fixture and verifies both ECDH parties,
  HKDF-SHA-256, AES-128-GCM ciphertext/tag and ECDSA signature mutation failure.
- Added `CommissioningCryptoInteropTest.java`, which reads the same fixture and
  verifies ECDH, HKDF, AES-GCM round-trip and ECDSA mutation rejection with the
  Android helper.
- Updated `firmware/esp32/tests/README.md` with the isolated host command and the
  explicit boundary that OpenSSL host execution is not ESP-IDF mbedTLS board
  evidence.

The fixture proves C/OpenSSL host and Java value interoperability for the listed
primitives. It does not prove ESP-IDF runtime behavior, protected key storage,
SoftAP networking or backend redemption. No production key or credential was
used.

### Commands and results

| Command | Result |
| --- | --- |
| Docker C host suite including crypto harness | **PASS**, exit 0; GCC 13.2.0/OpenSSL 3 container, source read-only and network disabled |
| `./gradlew.bat :owner:testDebugUnitTest :owner:assembleDebug` | **PASS**, `BUILD SUCCESSFUL`, exit 0; 38 actionable tasks |
| ESP-IDF 5.5.5 `idf.py build`, `NINJAFLAGS=-j1`, target `esp32s3` | **PASS**, exit 0 |
| Firmware size | **PASS WITH RISK**, `0xf7220 / 0x100000`, `0x8de0` free (~3%) |
| Backend full suite/typecheck/build | **PASS WITH SKIPS**, latest observed 127 passed / 42 skipped; no backend source changed in WP14.15 |
| PostgreSQL integration | **NOT RUN** | No database write was required for test-only crypto changes |
| `git diff --check` | **PASS** | Existing line-ending normalization warnings only |

### WP14.15 acceptance matrix

| Requirement | Result | Evidence / blocker |
| --- | --- | --- |
| Shared C/Java ECDH vector | **PASS** | Both harnesses read fixed vectors and match shared secret |
| Shared C/Java HKDF vector | **PASS** | Same salt/info/output fixture matches |
| Shared C/Java AES-128-GCM vector | **PASS** | Same key/nonce/AAD/ciphertext/tag; Java decrypts; C verifies output |
| Shared ECDSA verification vector | **PASS** | Same SPKI/signature; modified message rejected |
| C/Java transcript vector | **PASS** | Existing shared transcript fixture remains passing |
| ESP-IDF mbedTLS runtime crypto | **NOT VERIFIED** | Target compiles, but no board/test-target execution |
| SoftAP server | **BLOCKED** | No ESP-IDF HTTP server is wired to the physical-gated lifecycle |
| Android Wi-Fi handoff | **BLOCKED** | No local SoftAP transport client exists |
| Authenticated credential exchange | **BLOCKED** | Crypto primitives are not connected to network messages |
| Firmware redemption client | **BLOCKED** | No firmware HTTPS redemption implementation |
| Protected operational credential persistence | **NOT VERIFIED** | Encrypted NVS/eFuse provisioning not approved or runtime-tested |
| Device Event after commissioning | **NOT RUN** | Requires redemption and operational credential |
| Notification regression | **PASS — existing backend tests** | Fake/provider boundary retained; no real FCM |
| Hardware E2E | **BLOCKED** | No flash/reset/eFuse or board operation performed |

The next implementation boundary is the actual ESP-IDF SoftAP server and Android
Wi-Fi client. It must consume the verified protocol helpers, enforce identity and
session proof before accepting credentials, and remain fail-closed while the
device identity storage provider is disabled or unverified.

## WP14.12 implementation update

Status: **PARTIALLY COMPLETED — OWNER DEVICE-LINKING/SESSION STEP IMPLEMENTED; SOFTAP, WIFI EXCHANGE, REDEMPTION AND HARDWARE E2E REMAIN BLOCKED**.

### Source changes in this increment

- `apps/android-fcm-test/owner/src/main/java/com/pulselink/owner/MainActivity.java`
  now exposes an Owner action to create a provisioning session for the selected
  Store and enrolled Device. It calls the existing authenticated API, requires a
  session plus `deviceEnrollmentPublicKey`, and fails closed with a safe UI error
  if trust material is missing. It never displays or persists the bootstrap
  secret, challenge, operational credential or Wi-Fi password.
- Existing `ApiClient.createProvisioningSession` and backend session response are
  reused; no new endpoint, schema or migration was added.
- The screen explicitly states that the authenticated SoftAP/Wi-Fi exchange is
  not available, so a session response cannot be mistaken for commissioning or
  online status.

### Commands and observed results

| Command | Result |
| --- | --- |
| `./gradlew.bat :owner:testDebugUnitTest :owner:assembleDebug` | **PASS**, `BUILD SUCCESSFUL`, exit 0; 38 actionable tasks |
| ESP-IDF 5.5.5 single-job `idf.py build` (`NINJAFLAGS=-j1`, target `esp32s3`) | **PASS**, exit 0 |
| `npm test -- --run` | **PASS WITH SKIPS**, previously observed 127 passed / 42 skipped across 32 passed and 2 skipped files |
| `npm run typecheck` / `npm run build` | **PASS**, previously observed after provisioning-session response change |
| Docker C host suite | **PASS — prior run**, no C source changed in this increment |
| `git diff --check` | **PASS**, existing LF/CRLF normalization warnings only |

Firmware size remains `0xf7220` bytes in a `0x100000` app partition, with
`0x8de0` bytes free (approximately 3%). No firmware source was changed in this
increment; no partition layout change was made.

### Software acceptance matrix

| Flow | Result | Evidence / limitation |
| --- | --- | --- |
| Owner selects Store and Device identifiers | **PASS — source/build** | Existing Owner UI fields and API authorization path |
| Owner creates provisioning session | **PASS — source/build** | Existing API method is now wired to an explicit UI action |
| Session requires enrolled public key | **PASS** | Backend fail-closed test and Android response validation |
| Physical confirmation gate | **NOT VERIFIED** | Host state-machine tests only; no board runtime |
| SoftAP discovery and Android network handoff | **BLOCKED** | No production listener/client path exists |
| Authenticated ECDH/AES-GCM credential exchange | **BLOCKED** | Helpers exist and compile/test independently, but are not wired to transport |
| ESP32 Station Wi-Fi configuration | **BLOCKED** | Current firmware uses build-time station configuration |
| Firmware redemption and operational credential persistence | **BLOCKED** | No firmware redemption client; protected NVS not runtime verified |
| Button event from commissioned board | **NOT RUN** | Existing event queue uses operational token configuration, not commissioning output |
| PostgreSQL event and notification intent | **NOT RUN IN THIS INCREMENT** | Existing backend tests cover this path; no new event was generated |
| Android push notification display | **NOT VERIFIED** | Diagnostic FCM app remains separate; real FCM excluded |
| Hardware E2E | **BLOCKED** | No flash/reset/eFuse or board interaction performed |

### Hardware A–Z runbook for operator acceptance

This runbook is preparation only; no hardware operation was executed by this
worktree run.

1. Verify the exact ESP32-S3 board, carrier revision, approved test Wi-Fi and
   serial port. Confirm the board is disposable test hardware.
2. Build the exact source revision with ESP-IDF 5.5.5 and record the firmware
   binary hash/size. Do not flash until the operator confirms the target port.
3. Flash using the reviewed operator command from
   `docs/development/firmware-build.md`; do not erase NVS or write eFuse unless
   separately approved.
4. Start the Owner APK, enter the HTTPS API base, sign in, select the Store and
   register/select the Device. Confirm the Device is enrolled before requesting
   a provisioning session.
5. Press/hold the physical commissioning control according to the verified
   GPIO4 wiring procedure. Expected result: a bounded commissioning window;
   remote API calls alone must not open it.
6. Connect Android to the board SoftAP only after the operator confirms the
   SSID belongs to the target board. SSID/BSSID/IP are not trust evidence.
7. Verify the enrolled public key and proof-of-possession handshake. Expected
   result: wrong key, wrong challenge, replay and expired session are rejected
   before any Wi-Fi password is sent.
8. Enter only approved test Wi-Fi credentials. Expected result: credentials are
   sent only inside the authenticated encrypted channel and never appear in
   Logcat, serial logs or screenshots.
9. Verify Station-mode association, backend redemption and credential storage.
   Expected result: no success is shown before redemption and persistence are
   confirmed.
10. Press the operational button once. Verify the event uses a stable `eventId`,
    reaches the approved test backend and is scoped to the enrolled Device/Store.
11. Retry the same event ID and, if approved, run concurrent retries. Expected
    result: one durable event and no duplicate notification intent.
12. Verify the Owner recipient through the approved fake/test notification sink.
    Real FCM remains out of scope until separately approved.
13. Reboot the board and repeat identity/configuration checks. Expected result:
    a missing or corrupt identity fails closed rather than silently generating a
    replacement identity.
14. Save only redacted evidence: timestamps, build ID, non-secret event ID,
    status codes and sanitized logs. Never share passwords, tokens, private keys,
    session keys, full Authorization headers or database URLs.

### Current blockers

The remaining blockers are implementation/runtime boundaries, not Owner
SignUp/SignIn or Store creation: a real SoftAP server and Android Wi-Fi handoff,
interoperable handshake wiring, firmware redemption, protected identity
persistence, and board validation of GPIO4. No plaintext or shared-secret
fallback was added to bypass them.

## WP14.13 implementation update

Status: **PARTIALLY COMPLETED — OWNER PROVISIONING LIFECYCLE AND EXISTING EVENT/NOTIFICATION REGRESSION PATHS VERIFIED; REAL SOFTAP TRANSPORT AND BOARD COMMISSIONING NOT IMPLEMENTED**.

### Source implementation

- Added `apps/android-fcm-test/owner/src/main/java/com/pulselink/owner/CommissioningLifecycle.java`, a fail-closed Owner-side commissioning lifecycle. It enforces the sequence session-ready → device connection → device authentication → encrypted configuration → device Wi-Fi connection → redemption → online. It rejects direct success, duplicate active sessions, expiry, cancellation and terminal-state reuse.
- Added `CommissioningLifecycleTest.java` covering ordered transitions, direct-online rejection, expiry and terminal cancellation/failure behavior.
- Wired the lifecycle into the existing Owner provisioning-session action in `MainActivity.java`. The action calls the existing backend endpoint, requires the enrolled public key, starts a bounded local lifecycle and reports only “session ready”; it does not report Wi-Fi or online success.
- Reused the existing `commissioning_crypto.*`, `CommissioningCrypto.java`, transcript helpers, backend session/redemption contract and Device Event/notification implementation. No duplicate crypto, event or notification contract was added.

The firmware still has the existing Station-mode event queue and physical button
event path, but it does not yet have a production SoftAP listener, authenticated
local transport, firmware redemption client or protected operational-token
storage. It was intentionally not changed to accept credentials through an
unverified or plaintext path.

### Commands and results

| Command | Result |
| --- | --- |
| `./gradlew.bat :owner:testDebugUnitTest :owner:assembleDebug` | **PASS**, `BUILD SUCCESSFUL`, exit 0; 38 actionable tasks |
| Docker GCC host suite for physical gate, identity, commissioning state and transcript | **PASS**, exit 0; GCC 13.2.0 container, source read-only/network disabled |
| `npm test -- --run` | **PASS WITH SKIPS**, 32 files passed / 2 skipped; 127 tests passed / 42 skipped; exit 0 |
| `npm run typecheck` | **PASS**, exit 0 |
| `npm run build` | **PASS**, Prisma Client 7.10.0 generated and TypeScript build completed; exit 0 |
| `git diff --check` | **PASS**, only existing LF/CRLF normalization warnings |
| PostgreSQL write integration | **NOT RUN** | No new DB write was required by this Android/state-only change; prior dedicated target is `127.0.0.1:5434/pulselink_test` |

Firmware remains `0xf7220` bytes in the `0x100000` app partition with
`0x8de0` bytes free (~3%). The ESP-IDF 5.5.5 single-job build was already
verified in this workstream and no firmware source changed in WP14.13.

### Acceptance matrix

| Requirement | Result | Evidence / blocker |
| --- | --- | --- |
| Owner Store/Device provisioning-session action | **PASS — source/build** | Existing API call, enrolled public-key validation and Android lifecycle wiring |
| Physical confirmation before commissioning | **NOT VERIFIED** | Host state tests only; no board runtime |
| SoftAP startup and Android Wi-Fi handoff | **BLOCKED** | No production listener or Wi-Fi API transport exists |
| Device identity proof before credentials | **BLOCKED** | Crypto helpers exist, but no server/board handshake path is wired |
| Encrypted Wi-Fi credential exchange | **BLOCKED** | No endpoint; no plaintext fallback added |
| Firmware Station configuration from commissioning | **BLOCKED** | Firmware remains build-time Station configuration |
| Firmware redemption and operational credential persistence | **BLOCKED** | Provider disabled in operational config; no firmware redemption client |
| Button event after commissioning | **NOT RUN** | Existing event queue is not connected to a commissioned credential |
| Backend event persistence/idempotency | **PASS — existing regression suite** | Full backend suite passes; no new event was generated here |
| Notification recipient isolation/duplicate handling | **PASS — existing regression suite** | Covered by backend notification/device-event tests; fake provider only |
| Owner notification receive/display | **NOT VERIFIED** | Diagnostic FCM app remains separate; real FCM not enabled |
| Hardware E2E | **BLOCKED** | No flash/reset/eFuse or board runtime action performed |

### Hardware A–Z runbook

1. Confirm the exact ESP32-S3 board/carrier revision, verified GPIO4 wiring,
   approved test Wi-Fi, serial port and disposable test status.
2. Build the exact revision with ESP-IDF 5.5.5; record binary hash and size.
3. Flash only after operator confirms the target port and approved firmware;
   do not erase NVS or write eFuse as part of this report.
4. Open the Owner APK, configure the HTTPS API, sign in, choose the Store and
   select an enrolled Device.
5. Press the verified physical commissioning control. Expected: a bounded
   commissioning window; remote API calls alone must not open it.
6. Connect Android to the board SoftAP. Treat SSID/BSSID/IP as discovery data,
   not trust evidence.
7. Verify enrolled public key, challenge, signature and transcript before any
   credential is sent. Wrong key, replay, expiry and wrong session must fail.
8. Enter approved test Wi-Fi credentials only after the authenticated encrypted
   channel is established. Never capture them in logs or screenshots.
9. Verify Station Wi-Fi, redemption, operational credential persistence and
   online status from backend evidence.
10. Press the operational button; verify one stable event ID reaches the test
    backend and is scoped to the correct Device/Store.
11. Retry the same event ID, including concurrent retries if approved; expect one
    durable event and no duplicate notification intent.
12. Verify notification selection with the approved fake/test sink. Real FCM is
    not part of this run.
13. Reboot and verify identity/configuration recovery. Missing/corrupt identity
    must fail closed rather than generate a replacement identity.
14. Store only redacted timestamps, build ID, event ID and status evidence. Never
    share passwords, tokens, private keys, session keys or full connection data.

### Blockers

The remaining blockers are the real SoftAP lifecycle/server, Android Wi-Fi
handoff, C/Java runtime interoperability harness, firmware redemption and
protected credential persistence. These require implementation and/or approved
hardware evidence; they are not treated as PASS based on compile-only helpers.

## WP14.14 implementation update

Status: **PARTIALLY COMPLETED — SHARED TRANSCRIPT INTEROPERABILITY VERIFIED; SOFTAP TRANSPORT, FIRMWARE REDEMPTION AND HARDWARE FLOW REMAIN BLOCKED**.

### Source changes

- Added the shared deterministic fixture
  `firmware/esp32/tests/fixtures/commissioning_transcript_v1.hex`.
- Updated `firmware/esp32/tests/commissioning_protocol_test.c` to read that
  fixture and compare the complete generated transcript byte-for-byte.
- Updated `CommissioningTranscriptTest.java` to read the same repository fixture
  and compare the complete Java transcript byte-for-byte.
- Added the existing Owner lifecycle integration from WP14.13 to the current
  report state; no plaintext transport, SoftAP listener or insecure credential
  fallback was added.

### Interoperability evidence

The C host test and Android JVM test both use the same fixture and the same
inputs: protocol version 1, domain `pulselink-softap-commissioning-v1`, session,
SPKI bytes, challenge, expiry, context, nonces and ephemeral public-key bytes.
The generated output is 119 bytes and matches the fixture exactly on both sides.

This proves transcript encoding compatibility only. It does **not** yet prove
ECDH shared-secret, HKDF, AES-GCM or ECDSA runtime interoperability because the
C helper has no host-executed private-key fixture harness and neither side is
connected to the SoftAP transport.

### Commands and results

| Command | Result |
| --- | --- |
| Docker C protocol test using shared fixture | **PASS**, exit 0 |
| Docker C host suite: physical, identity, lifecycle and protocol | **PASS**, exit 0 |
| `./gradlew.bat :owner:testDebugUnitTest :owner:assembleDebug` | **PASS**, `BUILD SUCCESSFUL`, exit 0; 38 actionable tasks |
| ESP-IDF 5.5.5 `idf.py build`, `NINJAFLAGS=-j1`, target `esp32s3` | **PASS**, exit 0 |
| Firmware size check | **PASS WITH RISK**, `0xf7220 / 0x100000`, `0x8de0` free (~3%) |
| Backend full suite/typecheck/build | **PASS WITH SKIPS**, previous WP14.13 run: 127 passed, 42 skipped; no backend source changed in WP14.14 |
| PostgreSQL integration | **NOT RUN** | No DB write was required by fixture/test-only changes |
| `git diff --check` | **PASS** | Existing line-ending normalization warnings only |

### WP14.14 acceptance matrix

| Requirement | Result | Evidence / blocker |
| --- | --- | --- |
| C/Java transcript bytes | **PASS** | Same fixture read by C and Java tests; full byte comparison |
| C/Java ECDH shared-secret vector | **NOT RUN** | No shared private-key import/host harness exists yet |
| C/Java HKDF/AES-GCM vector | **NOT RUN** | Helpers are separately unit-tested; no shared cross-runtime vector |
| Signature/public-key interoperability | **NOT RUN** | No board identity signing path connected to Android transport |
| SoftAP lifecycle/server | **BLOCKED** | No ESP-IDF HTTP server wired to commissioning startup |
| Android Wi-Fi handoff | **BLOCKED** | No real local-network client path |
| Encrypted Wi-Fi credentials | **BLOCKED** | No authenticated transport endpoint |
| Firmware redemption | **BLOCKED** | No firmware backend client |
| Protected operational credential persistence | **NOT VERIFIED** | Encrypted NVS/eFuse policy and runtime remain unavailable |
| Device Event from commissioned firmware | **NOT RUN** | No commissioned firmware credential |
| Backend event/notification regression | **PASS — existing tests** | Backend suite passed; fake/provider boundary retained |
| Hardware E2E | **BLOCKED** | No flash/reset/eFuse or board operation performed |

### A–Z hardware runbook alignment

The existing runbook in this report remains valid. Before operator testing, the
missing implementation gates must be closed in this order: (1) authenticated
SoftAP server/client, (2) shared ECDH/HKDF/AES-GCM and signature vectors, (3)
firmware redemption and fail-closed credential storage, and (4) board-only
verification of GPIO4, SoftAP handoff, Wi-Fi join, reboot persistence and Device
Event. The operator must not send Wi-Fi credentials to the current firmware,
because it does not yet expose the required authenticated endpoint.

## WP14.16 implementation update

Status: **PARTIALLY COMPLETED — ESP-IDF SoftAP transport boundary and Android local transport client implemented; redemption, protected credential persistence and board runtime remain blocked.**

### Implemented source

- `firmware/esp32/main/commissioning_transport.h/.c`: real ESP-IDF HTTP server
  boundary with bounded request bodies, protocol/session validation, lifecycle
  checks, P-256 ECDH, device ECDSA proof, HKDF-SHA-256 session derivation,
  AES-128-GCM credential decryption and cleanup on failure. `start_softap`
  uses ESP-IDF Wi-Fi SoftAP APIs and exposes only handshake and encrypted-
  credential endpoints.
- `firmware/esp32/main/main.c`: guarded commissioning startup behind
  `CONFIG_PULSELINK_COMMISSIONING_ENABLED`, physical confirmation and the
  identity provider. The credential callback intentionally rejects the handoff
  because firmware redemption and protected operational-credential persistence
  are not available; no plaintext or replacement-identity fallback was added.
- `firmware/esp32/main/CMakeLists.txt`: includes the transport and
  `esp_http_server` dependency.
- `apps/android-fcm-test/owner/.../CommissioningTransportClient.java`: local
  SoftAP HTTP client that performs the matching handshake, verifies the enrolled
  SPKI device key and DER signature, derives the session key, encrypts Wi-Fi
  credentials with AES-GCM/AAD, bounds responses and clears temporary session
  material. It is not yet wired to Android Wi-Fi handoff UI or redemption status.
- `.../CommissioningTransportClientTest.java`: expiry and unauthenticated
  credential negative tests.

The operational profile still keeps commissioning and the ESP identity NVS
provider disabled. The firmware callback therefore fails closed at the exact
boundary where station configuration, redemption and protected storage would
otherwise be required.

### Commands and observed results

| Command | Result |
| --- | --- |
| ESP-IDF build after transport source | **PASS**, exit 0; ESP-IDF 5.5.5, `esp32s3`, `NINJAFLAGS=-j1`; `0xf7220 / 0x100000`, `0x8de0` free (~3%) |
| `./gradlew.bat :owner:testDebugUnitTest :owner:assembleDebug` | **PASS**, exit 0, `BUILD SUCCESSFUL`; 11 JVM tests, 0 failures; APK `owner/build/outputs/apk/debug/owner-debug.apk`, 906154 bytes |
| Docker C host suite (physical, identity, lifecycle, transcript, crypto) | **PASS**, exit 0; GCC 13.2.0 container, read-only source mount, network disabled |
| `git diff --check` | **PASS**, only existing LF/CRLF normalization warnings |
| `idf.py --version` in final shell | **PASS**, `ESP-IDF v5.5.5` |
| `idf.py build` in final shell | **NOT RUN TO COMPLETION**; shell PATH lacked CMake. A same-source ESP-IDF build after final firmware integration had already completed with exit 0, but this row is not counted as a fresh final rebuild |
| Backend suite/typecheck/build | **NOT RUN in this increment**; backend source was unchanged |
| PostgreSQL integration | **NOT RUN**; no database write was required |
| Board/SoftAP runtime | **NOT RUN**; no flash/reset or hardware action permitted |

The first transport build attempt failed with a missing `<time.h>` declaration
and was corrected before the successful ESP-IDF build. An initial Docker test
invocation used the wrong container working-directory paths; the README command
was then run correctly and passed. These failures were not hidden.

### Acceptance matrix

| Requirement | Result | Evidence / blocker |
| --- | --- | --- |
| ESP-IDF SoftAP server source | **PASS — compile evidence** | Real `esp_http_server`/`esp_wifi` APIs are linked; no board runtime evidence |
| Physical confirmation gate | **PASS — source/host evidence** | Existing host gate tests and guarded firmware integration; GPIO/runtime mapping remains NOT VERIFIED |
| Device proof before credentials | **PASS — source/build evidence** | Handshake checks enrolled device SPKI equality and DER signature before decrypt endpoint |
| Encrypted Wi-Fi credential endpoint | **PASS — source/compile evidence** | AES-GCM with transcript AAD; no plaintext fallback; callback rejects until redemption/storage exists |
| Android transport client | **PASS — JVM/build evidence** | Client source and negative tests; no Android Wi-Fi API handoff runtime |
| Firmware Station configuration | **BLOCKED** | No approved protected credential/redeem path is connected |
| Backend redemption client | **BLOCKED** | Not implemented in firmware; existing backend contract remains unchanged |
| Operational credential persistence | **BLOCKED** | NVS encryption/eFuse and runtime persistence are not verified; fail-closed is retained |
| Device Event from commissioned board | **NOT RUN** | No credential was issued and no board was operated |
| Backend event/notification regression | **PASS — historical evidence** | Existing backend suite/fake provider; not rerun because backend was unchanged |
| Hardware E2E | **BLOCKED** | Requires approved board operation, protected storage and redemption path |

### Security and scope confirmation

No eFuse was written, no Flash Encryption/Secure Boot/NVS security setting was
enabled, no firmware was flashed or erased, no database was reset or written,
and no FCM/email was sent. The local SoftAP uses HTTP only as a transport for
the authenticated application-layer handshake; the device does not accept
credentials before the encrypted session is established. This is not hardware
or mbedTLS runtime proof.

### Next actions

1. Restore a complete ESP-IDF shell with CMake/Ninja on PATH and rerun the
   documented single-job build.
2. Implement the backend redemption HTTPS client and a reviewed, protected
   operational-credential storage adapter; keep the callback fail-closed until
   both are verified.
3. Wire the Android client to Wi-Fi suggestion/local-network APIs only after
   the enrolled-key/trust flow is available in the production UI.
4. Obtain explicit approval for the hardware storage policy and perform board
   runtime validation in a separate approved hardware procedure; do not send
   Wi-Fi credentials to this build before that gate.

## WP14.17 implementation update

Status: **PARTIALLY COMPLETED — firmware redemption/storage boundaries and Android SoftAP handoff abstraction implemented and compiled; protected storage, station runtime and hardware E2E remain blocked.**

### Source implementation

- `firmware/esp32/main/commissioning_redeem.h/.c`: HTTPS redemption client for
  the existing `/v1/devices/:deviceId/provisioning-sessions/:sessionId/redeem`
  route. It builds the existing canonical payload, signs it with the device
  identity, sends `bootstrapSecret`, `challenge` and DER signature, validates
  HTTPS/status/response bounds, classifies errors and only attempts token save
  after a valid response.
- `firmware/esp32/main/commissioning_credential_storage.h/.c`: storage boundary
  with explicit unavailable/invalid/I/O results. Readiness is false unless a
  future protected provider is supplied and both the operational storage gate
  and NVS encryption are enabled. No plaintext NVS fallback exists.
- `firmware/esp32/main/commissioning_transport.*`: authenticated encrypted
  payload now carries the redemption context required by the existing backend
  contract (`deviceId`, backend `deviceKey`, bootstrap value); the callback
  receives it only after AES-GCM verification.
- `firmware/esp32/main/main.c`: callback now calls the redemption boundary only
  when the endpoint and protected storage are available; the default profile
  continues to reject credentials fail-closed.
- `firmware/esp32/main/Kconfig.projbuild`: added a disabled redemption base URL
  and disabled operational-storage gate; defaults do not enable either path.
- `apps/android-fcm-test/owner/.../CommissioningTransportClient.java`: encrypted
  credential payload now accepts redemption context without persisting it.
- `apps/android-fcm-test/owner/.../SoftApConnection.java` and manifest:
  Android 10+ `WifiNetworkSpecifier` handoff abstraction with bounded callback
  lifetime, process-network binding and cleanup. `MainActivity` now exposes a
  minimal session-to-handoff flow and clears the password field/context after
  completion or failure; device/phone runtime remains unverified.

### Verification

| Command | Result |
| --- | --- |
| `./gradlew.bat :owner:testDebugUnitTest :owner:assembleDebug` | **PASS**, exit 0; 11 JVM tests, 0 failures; 38 Gradle tasks up-to-date |
| Docker C host suite | **PASS**, exit 0; five host executables completed |
| ESP-IDF 5.5.5 build with explicit CMake/Ninja PATH and `NINJAFLAGS=-j1` | **PASS**, exit 0; target `esp32s3` |
| Firmware size | **PASS WITH RISK**, `0xf7220` bytes / `0x100000` partition; `0x8de0` free (~3%) |
| `git diff --check` | **PASS**, existing line-ending normalization warnings only |
| Backend tests/typecheck/build | **NOT RUN**; backend source/contract was not changed |
| PostgreSQL integration | **NOT RUN**; no DB write or migration was required |
| Hardware runtime | **NOT RUN**; no flash/reset/eFuse operation permitted |

The ESP-IDF build emitted the known `ESP_ROM_ELF_DIR` warning but completed
successfully. No secrets, tokens, Wi-Fi credentials or full response bodies were
logged or added to the report.

### Acceptance matrix

| Requirement | Result | Evidence / blocker |
| --- | --- | --- |
| Redemption URL/request contract | **PASS — source/build evidence** | Matches existing route and canonical payload contract |
| HTTPS validation and bounded response | **PASS — source/build evidence** | `https://` gate, ESP-IDF CA bundle, bounded body and status classification |
| Protected credential storage | **BLOCKED / FAIL-CLOSED** | Interface exists; no approved protected provider or hardware evidence |
| Station Wi-Fi configuration | **NOT VERIFIED** | Existing build-time station path remains; commissioning callback refuses before unsafe transition |
| Device Event using redeemed credential | **BLOCKED** | Existing event path still uses configured token; no unsafe token substitution added |
| Android SoftAP handoff/UI | **PASS — compile evidence** | `WifiNetworkSpecifier` and MainActivity flow compile; phone runtime not tested |
| Android encrypted redemption context | **PASS — JVM/build evidence** | Payload fields are encrypted under authenticated session; UI runtime not tested |
| Backend redemption | **PASS — contract reuse only** | Existing backend tests/historical evidence; no new DB run in this increment |
| Hardware E2E / reboot persistence | **BLOCKED** | Requires approved storage policy and board runtime |

### Security boundary

The operational profile still has commissioning, identity NVS provider and
operational credential storage disabled. Consequently, a successful local
credential decryption cannot produce an `accepted_for_redeem` success or an
online state in the default build. This is intentional fail-closed behavior.
No eFuse, Flash Encryption, Secure Boot, flash, erase, reset, production/DB
write or real FCM/email action was performed.

### Next actions

1. Review and approve the protected credential storage implementation and
   hardware provisioning/recovery policy; do not enable the Kconfig gate by
   guesswork.
2. Implement the approved storage provider and Station-mode commissioning
   wait/retry state, then connect the existing event sender to the stored token.
3. Test the wired `SoftApConnection`/`CommissioningTransportClient` flow on an
   Android device and verify Android network handoff behavior.
4. Rebuild and perform separately approved board runtime validation before any
   hardware E2E claim.

## WP14.18 implementation update

Status: **PARTIALLY COMPLETED — provider-gated credential handling and
commissioning lifecycle coverage are implemented and verified by host/build
tests; protected persistence, Station Wi-Fi runtime and board E2E remain
blocked.**

### Implemented source changes

- `firmware/esp32/main/commissioning_credential_storage.c/.h` remains the
  explicit storage boundary with `OK`, `UNAVAILABLE`, `INVALID` and `IO_ERROR`
  results. Readiness requires the operational-storage gate, NVS encryption
  configuration and both provider callbacks. The default operational profile
  therefore remains fail-closed; no normal-NVS bearer-token fallback was added.
- `firmware/esp32/main/commissioning_state.h/.c` extends the existing lifecycle
  with `CREDENTIAL_PERSISTING`, `WIFI_CONNECTED` and `RETRY_WAIT`, including
  bounded transitions through persistence, Station connection and retry. This
  extends the existing state machine rather than creating a competing one.
- `firmware/esp32/main/commissioning_transport.c` now rejects an encrypted
  credential request when the transition into `REDEEMING` is invalid.
- `firmware/esp32/main/main.c` uses the credential provider for the
  commissioning-enabled Device Event path and clears the loaded credential on
  all early-return and completion paths. The legacy build-time token path is
  retained only for the non-commissioning compatibility profile; no token is
  printed.
- `firmware/esp32/tests/commissioning_state_test.c` covers the successful
  persistence/Wi-Fi lifecycle and a bounded retry-to-failure path.
- `firmware/esp32/tests/commissioning_credential_storage_test.c` plus the test
  `sdkconfig.h` cover unavailable storage, test-double save/load, invalid input
  and I/O failure. These are provider-contract tests, not encrypted-NVS or
  hardware persistence evidence.

### Fresh verification

| Command | Result |
| --- | --- |
| Docker C host suite: physical, identity, lifecycle, protocol, crypto and storage executables | **PASS**, exit 0; 6/6 passed, 0 failed, 0 skipped |
| `./gradlew.bat :owner:testDebugUnitTest :owner:assembleDebug` | **PASS**, exit 0; 11 JVM tests passed, 0 failed, 0 skipped; APK `owner/build/outputs/apk/debug/owner-debug.apk`, 911433 bytes |
| ESP-IDF v5.5.5 build, target `esp32s3`, explicit CMake/Ninja paths, `NINJAFLAGS=-j1` | **PASS**, exit 0; firmware `0xf7280` / `0x100000`, `0x8d80` bytes free (3%) |
| `git diff --check` | **PASS**; existing LF/CRLF normalization warnings only |
| Backend tests/typecheck/build | **NOT RUN**; backend source/contract was not changed in this increment |
| PostgreSQL integration | **NOT RUN**; no DB write or migration was required |
| Board/SoftAP/Wi-Fi runtime | **NOT RUN**; no hardware operation was performed |

### Acceptance matrix

| Requirement | Result | Evidence / blocker |
| --- | --- | --- |
| Provider readiness and explicit error boundary | **PASS — host contract/build evidence** | Unavailable, invalid, success and I/O-error paths are tested; production provider remains disabled |
| Protected operational credential persistence | **BLOCKED / FAIL-CLOSED** | No approved protected provider, eFuse policy or hardware persistence evidence |
| Commissioning lifecycle persistence/Wi-Fi/retry states | **PASS — host test evidence** | Existing state machine extended and tested; this does not prove RTOS scheduling or Wi-Fi runtime |
| Non-blocking Station Wi-Fi connect/retry implementation | **BLOCKED** | State transitions exist, but actual Station connect/wait/retry controller is not yet wired and verified |
| Commissioning-enabled Device Event credential source | **PASS — source/build boundary evidence** | Reads provider credential and fails closed if unavailable; board submission not run |
| Device Event from commissioned board | **NOT RUN** | Requires protected provider, Station Wi-Fi and approved board runtime |
| Android lifecycle/handoff regression | **PASS — JVM/build evidence** | 11 JVM tests and APK build pass; physical Android Wi-Fi handoff not tested |
| Backend redemption/notification regression | **HISTORICAL EVIDENCE ONLY** | No backend source change or DB test in this increment |
| Hardware E2E, reboot persistence and real notification | **BLOCKED / NOT VERIFIED** | Requires approved storage policy, board access/procedure and approved notification sink |

### Security and scope confirmation

No eFuse was written; no Flash Encryption, Secure Boot or NVS encryption was
enabled; no board was flashed, erased or reset; no production/staging database
was written or migrated; and no FCM/email was sent. Firmware build success and
the provider test double do not establish protected storage, Wi-Fi association,
reboot persistence, Device Event delivery from hardware or real notification
delivery.

### Next actions

1. Approve the protected operational-credential storage and recovery policy,
   then implement and verify only that provider without guessing an eFuse
   block.
2. Add the non-blocking Station Wi-Fi controller behind the tested lifecycle,
   with bounded retry/cancellation and no secret logging.
3. Run Android handoff and board commissioning only after those gates; capture
   physical confirmation, Wi-Fi join, redemption, credential reload and Device
   Event evidence separately from host/build evidence.

## WP14.19 implementation update

Status: **PARTIALLY COMPLETED — non-blocking controller source and host tests
are implemented; protected storage, Station runtime association, backend
reachability and hardware E2E remain NOT VERIFIED/BLOCKED.**

### Implemented

- Added `firmware/esp32/main/commissioning_wifi_controller.h/.c` as the
  controller boundary around the existing `commissioning_context_t`. It owns
  bounded credential buffers, invokes configure/connect callbacks without
  waiting for association, supports timeout, bounded exponential retry,
  cancellation and terminal cleanup, and rejects stale event generations.
- Wired the controller into `main.c` after the existing redemption/storage
  gate, into Wi-Fi event handling, and into a periodic FreeRTOS tick task.
  Commissioning-enabled builds can initialize Station mode without requiring a
  build-time SSID. The controller does not promote `WIFI_CONNECTED` to
  `ONLINE`; a separate backend-reachability confirmation is required.
- Added host coverage for successful association, backend-online gating,
  authentication/connect failure, retry exhaustion, cancellation, credential
  cleanup and stale events.

### Fresh verification

| Command | Result |
| --- | --- |
| Docker C host suite: physical, identity, lifecycle, protocol, crypto, storage and Wi-Fi controller | **PASS**, exit 0; 7/7 executables passed, 0 failed, 0 skipped |
| ESP-IDF v5.5.5 build, target `esp32s3`, `NINJAFLAGS=-j1` | **PASS**, exit 0; firmware `0xf7280` / `0x100000`, `0x8d80` bytes free (3%) |
| `git diff --check` | **PASS**; existing LF/CRLF normalization warnings only |
| Android tests/build | **NOT RUN**; Android source unchanged in this increment; WP14.18 Android result remains historical evidence |
| Backend tests/typecheck/build | **NOT RUN**; backend source/contract unchanged |
| PostgreSQL integration | **NOT RUN**; no DB write or migration required |
| ESP32 Wi-Fi/SoftAP/backend runtime | **NOT VERIFIED**; no board operation performed |

### Acceptance matrix

| Requirement | Result | Evidence / blocker |
| --- | --- | --- |
| Non-blocking Station controller source | **PASS — compile evidence** | ESP-IDF target includes the controller and periodic tick task |
| Bounded retry/backoff/timeout | **PASS — host test evidence** | Retry exhaustion and timeout paths covered; no infinite retry |
| Cancellation and stale-event protection | **PASS — host test evidence** | Generation mismatch ignored; terminal cleanup clears credentials |
| Storage unavailable prevents Station start | **PASS — source boundary evidence** | Controller starts only after existing redemption/storage gate; provider remains disabled |
| Wi-Fi association on ESP32 | **NOT VERIFIED** | Requires board runtime and approved storage/provider configuration |
| Backend reachability and `ONLINE` | **BLOCKED** | No backend health/device-event confirmation is wired to `mark_backend_online` |
| Device Event from commissioned device | **BLOCKED** | Protected operational credential and hardware Wi-Fi path unavailable |
| Hardware E2E/reboot persistence | **BLOCKED** | No flash/reset or board runtime test performed |

### Scope and security confirmation

No eFuse, security provisioning, flash, erase or reset was performed. No
plaintext NVS fallback, hardcoded key, production/staging database write or
real FCM/email was used. Host tests prove controller logic only; they do not
prove ESP-IDF Wi-Fi association, backend reachability, credential persistence,
reboot recovery or Device Event delivery from hardware.

## WP14.21 implementation update

Status: **PARTIALLY COMPLETED — authenticated read-only Device status contract
and ESP-IDF HTTPS probe are implemented and tested/build-verified; protected
storage and board runtime remain NOT VERIFIED.**

### Backend contract

Added `GET /v1/device-status`. It reuses the existing hashed operational-token
authentication and active/enrolled/provisioned Device checks. The response is
minimal and non-secret:

```json
{
  "data": {
    "deviceId": "...",
    "deviceKey": "...",
    "status": "OFFLINE",
    "provisioningState": "PROVISIONED",
    "enrollmentStatus": "ENROLLED"
  },
  "meta": { "requestId": "..." }
}
```

The route has no path/body Device selector, performs no database write, does
not update heartbeat, and creates no Device Event or notification. Health
endpoints are not used as Device authentication.

### Firmware probe

`commissioning_backend_reachability_http.c` adds a bounded FreeRTOS HTTPS task
using ESP-IDF CA-bundle validation. It requests `/v1/device-status`, limits
response size, checks HTTP status, Device ID/key, `PROVISIONED` and `ENROLLED`
fields, classifies authentication/network/server/malformed failures, clears
credential/response buffers and uses the existing generation-guarded completion
path. Only a valid response can call `mark_backend_online`.

### Verification

| Command | Result |
| --- | --- |
| Focused device-status route test | **PASS**, exit 0; 7/7 passed, 0 failed, 0 skipped |
| Full backend `npm test` | **PASS**, exit 0; 134 passed, 42 skipped, 0 failed; 33 files passed, 2 skipped |
| `npm run typecheck` | **PASS**, exit 0 |
| `npm run build` | **PASS**, exit 0; Prisma generation and TypeScript build completed |
| Docker C host suite | **PASS**, exit 0; 8/8 executables passed, 0 failed, 0 skipped |
| ESP-IDF 5.5.5 build, target `esp32s3` | **PASS**, exit 0; `0xf7280 / 0x100000`, `0x8d80` bytes free (3%) |
| `git diff --check` | **PASS**; existing LF/CRLF warnings only |
| Live HTTPS probe/board runtime | **NOT VERIFIED**; no board operation performed |

The first focused route run exposed an incorrect fake database that returned a
Device for any token; the fixture was corrected and the rerun passed. This was
a test-fixture issue, not a production authorization failure.

### Acceptance matrix

| Requirement | Result | Evidence / blocker |
| --- | --- | --- |
| Valid operational credential returns status | **PASS — backend route test** | 7 route tests cover valid response and minimal schema |
| Wrong/missing/revoked/disabled credential rejected | **PASS — backend route test** | Existing verifier reused; no secret in response |
| Device identity cannot be selected by query/body | **PASS — backend route test** | Route derives identity only from authenticated token |
| No event/notification/database mutation | **PASS — source/test evidence** | Read-only service; no transaction/write call |
| ESP-IDF HTTPS probe source and TLS validation | **PASS — target build evidence** | CA bundle, bounded task and schema checks compile |
| Probe errors/stale generation cannot mark `ONLINE` | **PASS — host adapter + source evidence** | Adapter tests and generation-gated completion |
| Live HTTPS runtime on ESP32-S3 | **NOT VERIFIED** | No board runtime evidence |
| Protected credential persistence/reboot | **BLOCKED** | Provider policy and hardware evidence missing |
| Hardware E2E/Device Event/notification | **BLOCKED** | Requires board, protected storage and approved test environment |

No endpoint/schema migration was added. No eFuse, flash/reset/erase,
production/staging write or real FCM/email action was performed. Overall state
remains **PARTIALLY COMPLETED**.

## WP14.22 implementation update

Status: **PARTIALLY COMPLETED — commissioning-enabled Device Event delivery is
now provider- and `ONLINE`-gated with fresh host/build evidence; hardware
credential persistence, Wi-Fi/backend runtime and board event delivery remain
NOT VERIFIED.**

### Audit and implementation

The backend Device Event path already met the required server-side invariants:
it authenticates using the hashed operational credential, derives Device and
Store scope from the authenticated Device, persists the event and notification
intent in one transaction, and handles duplicate `eventId` only after checking
the committed record. No backend source or schema change was needed.

The firmware gap was that commissioning-enabled `send_event()` loaded the
provider token without requiring lifecycle `ONLINE`, while the event task was
triggered by the general Wi-Fi bit. Added:

- `commissioning_event_gate.c/.h`: requires `COMMISSIONING_ONLINE` and maps
  provider unavailable/invalid/I/O failures without fallback.
- `commissioning_event_gate_test.c`: verifies pre-online rejection, valid token
  load and all provider failure categories.
- `main.c`: uses the gate and defers pending event sending until `ONLINE`.
  Stable event IDs and existing queue/retry semantics remain unchanged.

### Fresh verification

| Command | Result |
| --- | --- |
| Docker C host suite including event gate | **PASS**, exit 0; 9/9 executables passed, 0 failed, 0 skipped |
| Full backend `npm test` | **PASS**, exit 0; 134 passed, 42 skipped, 0 failed; 33 files passed, 2 skipped |
| ESP-IDF 5.5.5 build, target `esp32s3` | **PASS**, exit 0; `0xf7280 / 0x100000`, `0x8d80` bytes free (3%) |
| `git diff --check` | **PASS**; existing LF/CRLF warnings only |
| Android tests/build | **NOT RUN**; Android source/contract unchanged |
| PostgreSQL integration | **NOT RUN**; no DB write or schema change required |
| Board Device Event / notification | **NOT VERIFIED**; no hardware operation performed |

### Acceptance matrix

| Requirement | Result | Evidence / blocker |
| --- | --- | --- |
| Provider credential required when commissioning is enabled | **PASS — source/host/build evidence** | Event gate rejects unavailable, invalid and I/O-failure providers |
| Lifecycle must be `ONLINE` before event send | **PASS — source/host evidence** | Wi-Fi-connected/pre-online state cannot load event credential |
| No build-time token fallback in commissioning profile | **PASS — source evidence** | Legacy token remains only under commissioning-disabled compatibility path |
| Stable eventId and queue retry behavior | **PASS — existing source/backend evidence** | No event ID generation or queue semantics changed |
| Backend Device authentication and Store scope | **PASS — backend regression evidence** | Existing `authenticateDevice` path derives scope from credential |
| Commit-before-ACK and notification transaction boundary | **PASS — backend regression evidence** | Existing service transaction retained; full suite passes |
| Device Event from commissioned board | **NOT VERIFIED** | Requires protected storage, status probe and board runtime |
| Hardware Wi-Fi/reboot persistence/notification | **BLOCKED** | No board evidence or real notification permitted |

No migration, eFuse, flash/reset/erase, production/staging write or real
FCM/email action was performed. Overall acceptance remains **PARTIALLY
COMPLETED**.

### Next actions

1. Review Wi-Fi initialization ownership between the existing SoftAP transport
   and Station startup before board validation.
2. Approve and implement the protected operational-credential provider/recovery
   policy without guessing eFuse configuration.
3. Add a real backend-reachability or Device Event confirmation before any
   `ONLINE` transition, then run separately approved board tests.

## WP14.20 implementation update

Status: **PARTIALLY COMPLETED — authenticated reachability adapter and
`ONLINE` gating are implemented/tested at the host level; the backend currently
has no read-only authenticated device-status contract, so runtime confirmation
and hardware E2E remain BLOCKED/NOT VERIFIED.**

### Contract finding

The current backend exposes authenticated Device Event ingestion at
`POST /v1/device-events`, plus health endpoints that are not authenticated as a
Device. Using public health to claim Device `ONLINE` would be incorrect. Using
Device Event as a probe would create an event/notification and alter data. No
new endpoint or schema was invented in this increment; a read-only authenticated
status contract remains an explicit blocker.

### Implemented source

- `firmware/esp32/main/commissioning_backend_reachability.h/.c`: adds a
  bounded adapter boundary that reads the operational credential only through
  the existing provider, passes it only to an injected asynchronous probe
  starter, clears the temporary credential buffer, rejects unavailable/invalid
  storage, ignores stale generations and only calls the existing
  `mark_backend_online` after an explicit successful probe result.
- `firmware/esp32/tests/commissioning_backend_reachability_test.c`: covers
  provider/operation initialization failure, credential handoff, stale result,
  auth failure and successful `ONLINE` transition.
- `firmware/esp32/main/CMakeLists.txt`: includes the adapter in the ESP-IDF
  component. No backend route, migration or notification behavior changed.

### Fresh verification

| Command | Result |
| --- | --- |
| Docker C host suite: physical, identity, lifecycle, protocol, crypto, storage, Wi-Fi controller and reachability adapter | **PASS**, exit 0; 8/8 executables passed, 0 failed, 0 skipped |
| ESP-IDF v5.5.5 build, target `esp32s3`, `NINJAFLAGS=-j1` | **PASS**, exit 0; firmware `0xf7280` / `0x100000`, `0x8d80` bytes free (3%) |
| `git diff --check` | **PASS**; existing LF/CRLF normalization warnings only |
| Android tests/build | **NOT RUN**; Android source unchanged |
| Backend tests/typecheck/build | **NOT RUN**; backend source/contract unchanged |
| PostgreSQL integration | **NOT RUN**; no DB write or migration required |
| Backend probe over HTTPS / board runtime | **NOT VERIFIED**; no approved read-only status endpoint and no board operation |

### Acceptance matrix

| Requirement | Result | Evidence / blocker |
| --- | --- | --- |
| Wi-Fi connected is distinct from `ONLINE` | **PASS — host test evidence** | Adapter/controller requires explicit backend success before online transition |
| Authenticated operational credential required | **PASS — source/host evidence** | Provider readiness/load gate; no request when unavailable or invalid |
| 401/403, timeout, network, 5xx and malformed results cannot mark online | **PASS — adapter contract** | Non-success results leave lifecycle non-online; detailed transport implementation awaits contract |
| Cancellation/stale generation protection | **PASS — host test evidence** | Old generation completion is ignored |
| Real HTTPS backend reachability confirmation | **BLOCKED** | Existing backend has no read-only authenticated Device status endpoint |
| Firmware `ONLINE` runtime state | **NOT VERIFIED** | No board, protected provider or real probe response |
| Hardware E2E / Device Event / notification | **BLOCKED** | Requires approved storage, status contract and board runtime |

### Security confirmation and next action

No health endpoint was treated as Device authentication, no probe event was
created, no endpoint/schema/migration was added, and no credential was logged.
No eFuse, flash, reset, erase, production/staging write or real FCM/email was
performed. The next highest-value decision is approval of a minimal read-only
authenticated Device status contract (or an explicit policy to use a distinct
existing authenticated operation), followed by implementing its HTTPS adapter
and board validation.

## WP14.23 protected credential storage readiness audit

Status: **PARTIALLY COMPLETED**. This increment audited the current source and
ran fresh backend and firmware checks. It did not enable hardware security,
register a protected provider, or perform board runtime work.

### Audit result

| Area | Result | Evidence / limitation |
| --- | --- | --- |
| Credential storage API boundary | **PASS — source evidence** | The interface distinguishes `OK`, `UNAVAILABLE`, `INVALID` and `IO_ERROR`; readiness requires protected-storage Kconfig plus non-null save/load callbacks. |
| Operational provider in application | **BLOCKED** | `main.c` only zero-initializes `s_credential_storage`; no protected save/load provider is registered. Redemption rejects when storage is unavailable. |
| NVS/identity configuration | **NOT VERIFIED / BLOCKED** | Default profile and current sdkconfig leave `NVS_ENCRYPTION`, operational storage, identity NVS provider, Flash Encryption and Secure Boot disabled. eFuse/hardware state was not read. |
| Redemption -> persistence | **BLOCKED at persistence gate** | Redemption source validates HTTPS, identity, session and response, then requires the provider; no protected token persistence is evidenced. |
| Authenticated backend status | **PASS — backend source/tests; firmware compile only** | `/v1/device-status` authenticates the operational credential and derives Device identity server-side without side effects. No board HTTPS runtime evidence. |
| `WIFI_CONNECTED` -> `COMMISSIONING_ONLINE` | **PASS — source/host contract; runtime NOT VERIFIED** | Reachability success is required; stale/error results cannot mark online. No protected credential or board response exists to exercise it. |
| Device Event gate | **PASS — source/historical host evidence; fresh C rerun BLOCKED** | Commissioning event gate requires `ONLINE` and provider-loaded credential; legacy build-time token is outside the commissioning-enabled path. |
| Reboot/persistence recovery | **NOT VERIFIED** | Requires approved protected provider and board reboot test. |
| Hardware E2E | **BLOCKED** | No board operation was performed. |

### Fresh commands and evidence

- Docker C host suite (9 executables): exit 1 before tests because Docker
  Desktop Linux engine access was denied; **BLOCKED**, not a test failure and
  not a PASS claim.
- ESP-IDF v5.5.5 `idf.py build` for `esp32s3`, configured Espressif
  environment and `NINJAFLAGS=-j1`: exit 0 (**PASS**). Binary is `0xf7280`
  bytes in a `0x100000` app partition; `0x8d80` bytes free (3%).
- `npm test` from `server/api`: exit 0 (**PASS**), 33 files passed, 2 skipped;
  134 tests passed, 42 skipped, 0 failed.
- `git diff --check`: exit 0 (**PASS**), with existing LF/CRLF warnings.
- Android tests/build and PostgreSQL integration: **NOT RUN**; no Android or
  backend source change required and no DB write was needed.

No eFuse, flash, reset, erase, security provisioning, production/staging DB
write or real FCM/email action was performed. Overall WP14 status remains
**PARTIALLY COMPLETED** until an approved protected provider and board runtime
evidence demonstrate credential persistence, reboot recovery, authenticated
backend reachability, `ONLINE` and Device Event delivery.

## WP14.24 protected credential storage implementation update

Status: **PARTIALLY COMPLETED**. No approved hardware security/recovery policy
was available, so the production provider remains disabled and fail-closed.
Only safe abstraction hardening was implemented.

### Source changes

- `firmware/esp32/main/commissioning_credential_storage.c`
  - readiness now requires a non-null provider context in addition to the
    protected-storage Kconfig gate and save/load callbacks;
  - `load()` clears the output length before checking readiness or invoking the
    provider, preventing stale length metadata after an error.
- `firmware/esp32/tests/commissioning_credential_storage_test.c`
  - covers missing provider context;
  - verifies output length is cleared after an I/O failure.

No provider was registered in `main.c`. `NVS_ENCRYPTION`, operational storage
and the identity NVS provider remain disabled in the current profile. Therefore
redemption still cannot persist an operational credential, and no transition to
authenticated `ONLINE` or commissioned Device Event is claimed.

### Verification

| Check | Result |
| --- | --- |
| Targeted Docker storage host test | **BLOCKED**, exit 1 before compilation; Docker Desktop Linux engine access denied |
| Fresh ESP-IDF 5.5.5 ESP32-S3 build | **PASS**, exit 0; `0xf7280 / 0x100000`, `0x8d80` bytes free |
| `git diff --check` | **PASS**, exit 0; existing LF/CRLF warnings only |
| Backend/Android/PostgreSQL | **NOT RUN**; no corresponding source/contract change or DB write |
| Protected storage/reboot hardware runtime | **NOT VERIFIED** |

The targeted storage test was blocked before any test executed; historical host
test results are not relabeled as fresh. No NVS encryption, Flash Encryption,
Secure Boot, eFuse operation, flash/reset/erase, production/staging write or
real notification was performed. Remaining blockers are security approval for
key custody/recovery, an approved protected provider implementation, hardware
runtime persistence/reboot evidence and restored Docker access for the fresh C
test.

## WP14.25 storage security design and acceptance contract

Status: **PARTIALLY COMPLETED — DESIGN READY FOR REVIEW**. No security
configuration or hardware provisioning was changed.

### Current implementation boundary

- `commissioning_credential_storage_is_ready()` requires the operational
  storage Kconfig gate, `CONFIG_NVS_ENCRYPTION`, non-null context and save/load
  callbacks.
- `main.c` does not register a production operational-credential provider.
  Redemption therefore cannot report success until persistence is available.
- The event gate requires a provider-loaded credential and
  `COMMISSIONING_ONLINE`; commissioning has no build-time-token fallback.
- `/v1/device-status` authenticates the operational credential and derives the
  Device server-side without creating events or notifications.
- Current sdkconfig uses a single-app partition with a `0x100000` app slot;
  NVS Encryption, Flash Encryption, Secure Boot, commissioning and operational
  storage are disabled. `sdkconfig.identity-provider.defaults` is compile-only
  and is not hardware security evidence.

### Storage options

| Option | Benefits | Required approval / risks | Status |
| --- | --- | --- | --- |
| ESP-IDF encrypted NVS with approved key provisioning | Smallest compatible implementation; preserves NVS API and reboot semantics | Must define encryption-key custody, HMAC/eFuse provisioning, recovery, replacement-board and factory-reset policy; runtime evidence is still required | **PROPOSED — REQUIRES OWNER APPROVAL** |
| Flash Encryption plus Secure Boot, with encrypted NVS | Stronger protection against direct flash extraction and unauthorized firmware | Separate irreversible security lifecycle, signing-key custody, recovery and manufacturing process; does not by itself define operational-token rotation/recovery | **OPEN — REQUIRES SECURITY APPROVAL** |
| External/platform-managed secure element or equivalent provider | Can isolate key operations from normal flash and support device-specific custody | No such component is present in the current repository/board contract; adds hardware, provisioning and firmware integration scope | **NOT AVAILABLE IN CURRENT DESIGN** |

NVS encryption protects NVS data at rest only when its key-management and
hardware provisioning are actually configured. Flash Encryption, Secure Boot and
NVS Encryption are separate properties and must not be conflated. No option is
considered production-approved from Kconfig or compilation alone.

### Decisions requiring owner approval

1. Select the storage option and approve its threat model.
2. Approve key custody, factory provisioning, HMAC/eFuse handling and recovery
   procedure; no eFuse block is selected by this work.
3. Define behavior for lost/corrupt key, factory reset, replacement board,
   credential revocation and operational-token rotation.
4. Define whether recovery is re-enrollment, device replacement or permanent
   quarantine; do not silently generate a replacement identity.
5. Approve the board test procedure for reboot, power interruption, corrupted
   record, missing key and credential revocation.

### Acceptance contract before provider registration

1. `save()` returns success only after durable protected storage commit.
2. `load()` returns complete, validated credential data or a typed failure;
   output length is cleared before failure and partial data is unusable.
3. Missing provider, missing key, invalid record, corruption and I/O errors
   fail closed and never return an older credential as a new successful write.
4. Redemption succeeds only after credential persistence succeeds.
5. `ONLINE` requires a valid credential read and authenticated backend status;
   Wi-Fi association or persistence alone is insufficient.
6. Device Event sending requires `ONLINE` and the provider-loaded credential.
7. Credential material is absent from logs, crash output and error messages.
8. Reboot/power-loss behavior, rotation, revocation and recovery have an
   approved, testable policy.
9. Commissioning never falls back to a build-time token.
10. Test doubles prove only API/state/error semantics, not flash protection or
    hardware durability.

### Verification status

| Evidence | Result |
| --- | --- |
| Source/configuration audit | **PASS — fresh read-only evidence** |
| Design and acceptance contract | **PASS — documented, pending owner approval** |
| `git diff --check` | **PASS**, exit 0; existing LF/CRLF warnings only |
| Source/build/tests in this increment | **NOT RUN**; documentation-only increment |
| Protected storage runtime/reboot/power-loss | **NOT VERIFIED** |
| eFuse/security provisioning | **NOT RUN** |

Overall commissioning remains **PARTIALLY COMPLETED**. The next implementation
step is conditional on approval of one storage/recovery option; until then the
provider must remain disabled and fail-closed.

## WP14.26 implementation update

Status: **PARTIALLY COMPLETED**. Safe software gates were re-audited and the
firmware build was rerun. No unapproved protected-storage provider was enabled.

### Implementation decision

The current application calls ordinary `nvs_flash_init()` and has no encrypted-
NVS key initialization or operational credential save/load callback registration.
Because key custody, eFuse/HMAC provisioning, recovery and factory-reset policy
remain unapproved, registering a provider would not be a valid protected-storage
implementation. The existing storage boundary remains unavailable and fail-
closed. No source/configuration change was made in this increment.

The verified software path remains:

`redeem → storage readiness/persistence gate → Wi-Fi → authenticated status →
ONLINE → provider-loaded Device Event`

Persistence failure cannot produce redemption success; `ONLINE` cannot be
reached from Wi-Fi association alone; and commissioning does not fall back to a
build-time token.

### Verification

| Area | Result | Evidence |
| --- | --- | --- |
| Storage abstraction/error gates | **PASS — source evidence** | Existing typed results, context/callback readiness and output cleanup retained |
| Production protected provider | **BLOCKED** | Secure NVS initialization and approved key/recovery procedure unavailable |
| Targeted C storage test | **BLOCKED**, exit 1 before compilation | Docker Desktop Linux engine access denied |
| ESP-IDF 5.5.5 ESP32-S3 build | **PASS**, exit 0 | `0xf7280 / 0x100000`, `0x8d80` bytes free |
| `git diff --check` | **PASS**, exit 0 | Existing LF/CRLF warnings only |
| Android/backend/PostgreSQL | **NOT RUN** | No related source/contract change or DB write |
| Protected persistence/reboot/power loss | **NOT VERIFIED** | No board operation permitted |
| Full commissioning E2E | **BLOCKED** | Requires approved provider and hardware evidence |

No NVS/Flash Encryption, Secure Boot, eFuse provisioning, flash/reset/erase,
production/staging database write or real notification was performed. Next
action is approval and implementation of secure NVS initialization plus the
provider as one reviewed unit, followed by contract tests and approved board
reboot/corruption validation.

## WP14.27 C host test restoration and storage regression update

Status: **PARTIALLY COMPLETED**.

### Source changes

- `firmware/esp32/main/commissioning_credential_storage.c`: `load()` now
  clears output length before every validation path, including null/undersized
  buffers, preventing stale metadata from surviving an invalid call.
- `firmware/esp32/tests/commissioning_credential_storage_test.c`: added tests
  for missing save callback, missing load callback and insufficient-capacity
  cleanup.

The production provider remains disabled. No encrypted-NVS initialization,
key provisioning or recovery policy was inferred or enabled.

### Verification

| Check | Result |
| --- | --- |
| Docker context/daemon read-only check | **BLOCKED**; `desktop-linux` and `default` pipes both returned access denied |
| Native `cc/gcc/clang/cmake/ninja` | **NOT AVAILABLE** |
| Full C host suite | **BLOCKED**, exit 1 before compilation; no test PASS claimed |
| Fresh ESP-IDF 5.5.5 ESP32-S3 build | **PASS**, exit 0; `0xf7280 / 0x100000`, `0x8d80` bytes free |
| `git diff --check` | **PASS**, exit 0; existing LF/CRLF warnings only |
| Android/backend/PostgreSQL | **NOT RUN**; no corresponding change or DB write |
| Protected storage/reboot/power-loss hardware | **NOT VERIFIED** |

The C suite was not weakened or replaced. Host tests remain blocked by the
execution environment, while the target firmware compilation confirms the
storage source still integrates with ESP-IDF. Overall commissioning remains
**PARTIALLY COMPLETED** pending restored host execution, approved secure key
provisioning/recovery, and hardware persistence/runtime evidence.

## WP14.29 E2E acceptance closure update

Overall status: **PARTIALLY COMPLETED**.

### Fresh software evidence

| Area | Result | Evidence |
| --- | --- | --- |
| Android Owner JVM tests | **PASS — fresh** | 11 passed, 0 failed, 0 skipped |
| Android Owner debug APK | **PASS — fresh** | `apps/android-fcm-test/owner/build/outputs/apk/debug/owner-debug.apk`, 911433 bytes |
| Backend typecheck | **PASS — fresh** | `npm run typecheck`, exit 0 |
| Backend build/Prisma generate | **PASS — fresh** | `npm run build`, exit 0 |
| Backend full suite | **PASS — fresh** | 33 files passed, 2 skipped; 134 passed, 42 skipped, 0 failed |
| ESP-IDF 5.5.5 ESP32-S3 build | **PASS — fresh** | `0xf7280 / 0x100000`, `0x8d80` bytes free |
| C host suite | **BLOCKED — fresh** | Docker pipe access denied before compilation; no PASS claim |
| Android device installation/click-through | **NOT VERIFIED** | `adb` exists but no device/emulator listed |
| Protected storage/reboot/power-loss | **NOT VERIFIED** | Requires approved provider and board |

### Required acceptance flow

| Step | Result | Evidence/blocker |
| --- | --- | --- |
| Owner SignUp/SignIn | **HISTORICAL** | Earlier app/backend evidence; not rerun in this increment |
| Create Store and OWNER membership | **HISTORICAL** | Existing backend contract/tests; no new runtime evidence |
| Register/link Device with Store | **HISTORICAL** | Existing source/tests; no attached Android target |
| Create provisioning session | **HISTORICAL** | Existing backend tests; no new runtime evidence |
| SoftAP discovery and identity verification | **NOT VERIFIED** | No Android device or board |
| Encrypted Wi-Fi credential exchange | **NOT VERIFIED** | No board runtime |
| ESP32 Wi-Fi join | **NOT VERIFIED** | No board runtime |
| Redemption and protected credential persistence | **BLOCKED** | Production provider/security recovery policy not approved |
| Authenticated `/v1/device-status` and `ONLINE` | **NOT VERIFIED** | No operational credential/runtime probe |
| Device Event commit/idempotency | **HISTORICAL SOFTWARE EVIDENCE** | Backend tests exist; no commissioned board event |
| Store/Owner scope verification | **PASS — backend source/tests; runtime NOT VERIFIED** | Server derives authorization from authenticated relations/credential |
| Notification intent/delivery | **PASS — backend test/fake boundary; delivery NOT VERIFIED** | No real FCM/email and no board event |

### Blockers and next actions

1. Restore Docker access to execute all 9 C host binaries, including the new
   storage regression assertions.
2. Approve secure credential key custody, provisioning, recovery, factory reset
   and revocation policy; then implement encrypted-NVS initialization/provider.
3. Attach an approved Android device/emulator and install the fresh APK.
4. Run separately approved board validation for SoftAP, Wi-Fi, redemption,
   reboot persistence, authenticated status, Device Event and notification sink.

No eFuse, security provisioning, flash/reset/erase, production/staging write or
real notification was performed. Build success is not hardware E2E evidence.

## WP14.30 implementation update

Status: **PARTIALLY COMPLETED — HARDWARE E2E NOT VERIFIED**.

### Fresh implementation

Fixed a firmware lifecycle ordering defect in
`firmware/esp32/main/commissioning_transport.c` and `main.c`. The transport now
enters `REDEEMING` before invoking the redemption callback; successful backend
redemption consumes the session once and then transitions through credential
persistence to Wi-Fi connection. Malformed or rejected credential handling now
terminal-fails the commissioning lifecycle. This preserves the existing
protocol, TLS, storage and event gates.

Detailed report: [WP14.30 full commissioning report](wp14-30-full-commissioning-e2e-implementation.md).

### Fresh verification

| Check | Result |
| --- | --- |
| ESP-IDF 5.5.5 ESP32-S3 build | **PASS**, exit 0; `0xf7280 / 0x100000`, `0x8d80` free |
| C host suite | **BLOCKED**, exit 1 before compilation; Docker pipe access denied |
| `git diff --check` | **PASS**, exit 0; existing LF/CRLF warnings only |
| Android/backend tests/build | **HISTORICAL**, WP14-RUN-029; unchanged in this increment |
| Android/ESP32 runtime | **NOT VERIFIED**; no attached Android target or board |

The protected credential provider remains disabled and fail-closed. No NVS/Flash
Encryption, Secure Boot, eFuse, flash/reset/erase, production/staging write or
real FCM/email was performed. Overall status remains **PARTIALLY COMPLETED**.

## WP14.32 enrollment, storage and E2E update

Enrollment is now operator-authorized only. The backend verifies a
domain-separated P-256/SHA-256 proof that binds Device key, canonical SPKI,
key version, 32-byte challenge and a five-minute maximum expiry. Enrollment is
claimed atomically once, and a unique PostgreSQL index prevents reuse of one
enrolled public key across Devices. The Owner self-enrollment route accepting a
client-selected key was removed. The operator/factory still needs an approved
way to obtain proof from the actual board without exporting its private key.

Fresh results: focused provisioning tests 15/15; full backend suite 137 passed,
43 skipped; typecheck, Prisma validation/build passed. The test target
`127.0.0.1:5434/pulselink_test` had no duplicate enrolled keys; only the
additive uniqueness migration was applied there. PostgreSQL integration passed
41/41. C host passed 9/9; Android JVM passed 14/14 and the APK was installed
and launched on a Xiaomi Android 15 device (smoke test only). Default and
commissioning ESP-IDF builds passed at `0xf7280` and `0xf92f0`, respectively;
both retain about 3% partition space.

No production identity/operational storage provider is registered. Key custody,
secure provisioning/recovery, hardware Wi-Fi, reboot persistence and Device
Event runtime remain unverified. An Espressif USB serial interface was visible
as COM4 but was not opened. No flash/reset/eFuse, production DB write or real
notification occurred. Full details and exact classifications are in the
WP14-RUN-032 [closure report](wp14-32-enrollment-storage-e2e-closure-report.md).

## WP14.33–WP14.37 readiness update

Status: **PARTIALLY COMPLETED — TRUSTED ENROLLMENT AND PROTECTED STORAGE GATES BLOCKED; PHYSICAL E2E NOT RUN**.

Added [`Test-CommissioningReadiness.ps1`](../../scripts/Test-CommissioningReadiness.ps1), a repeatable read-only preflight that emits JSON/Markdown and validates tools, firmware profile/trust settings, Owner APK/ADB, serial enumeration without opening a port, an explicitly opted-in development HTTPS liveness probe, and the exact loopback `pulselink_test:5434` target before read-only migration status.

Fresh preflight: exit 2, 14 PASS / 0 FAIL / 4 BLOCKED / 2 SKIPPED. ESP-IDF 5.5.5 tools, Docker daemon, APK/ADB, serial enumeration and test DB migration status were available. Commissioning and operational storage are disabled, the firmware redemption origin is unset, and its configured event origin is not accepted as a local development target; no backend URL was contacted. The public-host probe guard rejected a public URL before making a request. `git diff --check` and PowerShell parser validation passed.

WP14-RUN-032 product suite/build results remain **historical**, not rerun in this increment: backend integration 41/41 on `pulselink_test:5434`, C host 9 runners, Android JVM 14/14/APK 915,134 bytes, ESP-IDF default/commissioning images `0xf7280`/`0xf92f0`. No hardware E2E, credential transfer, COM open, flash/reset/eFuse, production access, DB write or real notification was performed.

Trusted proof acquisition from the actual board and approved key custody/recovery remain unresolved. Full gates, storage options, preflight usage and WP14.38 operator sequence are in the [WP14.33–WP14.37 readiness report](wp14-33-37-commissioning-readiness-report.md). Engineering history is in [`wp14-engineering-log.md`](wp14-engineering-log.md), entry `WP14-RUN-033`.
