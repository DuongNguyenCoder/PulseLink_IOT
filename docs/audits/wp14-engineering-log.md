# WP14 Persistent Engineering Log

This file is append-only. It records implementation evidence and blockers for
the Owner-to-ESP32 commissioning workstream. Secrets, credentials and complete
connection strings are intentionally excluded.

## Baseline reconstructed from repository and prior report

- Firmware target: ESP32-S3, ESP-IDF 5.5.5. Historical fresh build evidence:
  `0xf7220` bytes in a `0x100000` app partition, `0x8de0` bytes free.
- Owner app: `apps/android-fcm-test/owner`, package `com.pulselink.owner`.
- Diagnostic app remains `com.pulink.fcmtest`.
- Existing backend provisioning session/redeem, Owner authorization, Device Event
  idempotency and notification tests are retained.
- Existing host/Android crypto evidence includes shared transcript and primitive
  fixtures. The C crypto harness uses OpenSSL as a host adapter; this is not
  ESP-IDF mbedTLS runtime or board evidence.
- Operational identity provider is fail-closed because encrypted NVS/provider
  configuration is disabled in the operational profile and has not been verified
  on hardware.
- SoftAP server, Android Wi-Fi handoff, firmware redemption client and hardware
  commissioning remain open blockers.

## Open blockers at initialization

1. No verified protected identity/operational credential storage on hardware.
2. No production SoftAP listener and authenticated credential endpoint.
3. No Android Wi-Fi handoff client.
4. No firmware redemption client connected to the existing backend contract.
5. No board runtime evidence for GPIO4, SoftAP, Wi-Fi join or Device Event.
6. Real FCM/email deliberately not enabled.

## Next actions at initialization

1. Add a real ESP-IDF transport boundary only if it remains fail-closed when the
   identity provider is unavailable.
2. Add Android transport abstractions/tests without sending credentials before
   trust verification.
3. Keep shared crypto fixtures and rerun all build/test evidence after changes.
4. Update this log and the WP14 summary report with observed results.

## WP14-RUN-016

- Time: 2026-10-28, Asia/Saigon.
- Git state: dirty working tree with pre-existing WP14 Android, firmware,
  backend-test, generated backend `dist`, fixture and documentation changes;
  no reset or overwrite performed. No commit hash was available.
- Goal: initialize the persistent log and continue WP14.16 source work from the
  current implementation state.
- Read: current WP14 summary report, protocol/ADR references, firmware state,
  identity provider, Kconfig, Android Owner modules, backend provisioning source,
  and existing test layout.
- Changes in this run: created this persistent log. No production source was
  changed yet because the current identity provider is unavailable in the
  operational profile and the transport contract still needs an implementation
  boundary that cannot safely accept credentials before proof-of-possession.
- Commands run: repository/status/source inventory and read-only source inspection.
- Results: PASS — inspection completed, exit 0. No tests/builds were run in this
  initialization step.
- New evidence: none; all baseline results above are historical evidence.
- Security decision: do not enable eFuse/NVS security, flash/reset hardware,
  accept plaintext credentials or create a replacement identity.
- Open blockers: all six initialization blockers above remain open.
- Next actions: implement the smallest fail-closed ESP-IDF transport boundary
  and Android transport abstraction only after validating API dependencies;
  then run host/JVM/build suites and append observed evidence.
- Result: `PARTIALLY COMPLETED`.

## WP14-RUN-023

- Time: 2026-10-28 17:54:04 +07:00 (Asia/Saigon).
- Git state: branch `main`, HEAD `ec76bbafb3022e3dca47de956f8e5b86818b0007`,
  dirty worktree preserved. No reset, overwrite, board operation, eFuse write,
  database reset or production/staging write was performed.
- Goal: audit and close the commissioning-enabled Device Event gate so events
  cannot be sent from Wi-Fi association alone or from a build-time token.
- Read: WP14 log/report, current `main.c`, lifecycle, storage, Wi-Fi controller,
  redemption, reachability and backend Device Event route/service/schema/tests.
- Findings: the backend already authenticates by hashed operational credential,
  derives Device/Store from that credential, persists event plus notification
  intent in one transaction, and handles unique-event retries after commit.
  Firmware provider loading existed, but commissioning-enabled event sending
  did not require lifecycle `ONLINE`; the event task could also attempt a
  pending event when only the global Wi-Fi bit was set.
- Files changed:
  - `firmware/esp32/main/commissioning_event_gate.h/.c`: provider/lifecycle
    gate mapping `NOT_ONLINE`, storage unavailable/invalid/I/O and success.
  - `firmware/esp32/tests/commissioning_event_gate_test.c`: tests pre-online
    rejection, valid provider load and all storage error categories.
  - `firmware/esp32/main/main.c`: commissioning-enabled event sender now loads
    only through the gate and skips pending events until lifecycle `ONLINE`;
    existing event ID and queue retry behavior are preserved.
  - `firmware/esp32/main/CMakeLists.txt`: includes the gate module.
- Commands/results:
  - Docker C host suite (physical, identity, lifecycle, protocol, crypto,
    storage, Wi-Fi controller, reachability and event gate): **PASS**, exit 0;
    9/9 executables passed, 0 failed, 0 skipped.
  - Full backend `npm test`: **PASS**, exit 0; 134 passed, 42 skipped, 0
    failed; 33 files passed, 2 skipped.
  - ESP-IDF v5.5.5 build, target `esp32s3`, explicit CMake/Ninja paths and
    `NINJAFLAGS=-j1`: **PASS**, exit 0; firmware `0xf7280`, partition
    `0x100000`, free `0x8d80` (3%). Known nonfatal `ESP_ROM_ELF_DIR` warning
    remains.
  - `git diff --check`: **PASS**; existing LF/CRLF normalization warnings
    only.
  - Android tests/build: **NOT RUN**; Android source/contract unchanged.
  - PostgreSQL integration: **NOT RUN**; no backend code/schema change and no
    DB write was required.
- New evidence: event gate and commissioning-enabled source compile, and host
  tests verify provider/ONLINE gating. Backend regression suite is fresh. No
  board event, protected storage, HTTPS runtime or notification delivery was
  verified.
- Security decisions: no build-time token fallback is used when commissioning
  is enabled; no event is sent before authenticated backend status has promoted
  the lifecycle to `ONLINE`. Legacy token behavior remains only in the
  non-commissioning compatibility profile. No secrets were logged and no
  hardware/security provisioning or real notification was performed.
- Open blockers:
  1. Protected credential storage and hardware persistence remain unapproved or
     unverified.
  2. Board Wi-Fi/backend reachability and actual `ONLINE` transition remain
     unverified.
  3. Device Event and notification delivery from a real board remain unverified.
- Next actions:
  1. Run the status probe and event path on an approved board/test backend only
     after storage policy approval.
  2. Verify stable eventId retry and notification behavior through PostgreSQL
     test integration if a DB-backed run is authorized and available.
  3. Keep hardware E2E separate from host/build evidence.
- Result: `PARTIALLY COMPLETED`.

## WP14-RUN-022

- Time: 2026-10-28 17:47:51 +07:00 (Asia/Saigon).
- Git state: branch `main`, HEAD `ec76bbafb3022e3dca47de956f8e5b86818b0007`,
  dirty working tree preserved. No reset, overwrite, board operation, eFuse
  write or production/staging database write was performed.
- Goal: implement an authenticated read-only Device status contract and a
  bounded ESP-IDF HTTPS probe that can promote `WIFI_CONNECTED` to `ONLINE`
  only after matching Device identity/state is returned.
- Read: current WP14 log/report, backend API conventions, `authenticateDevice`,
  Device Event route/service/tests, provisioning credential/status rules,
  firmware reachability/controller/storage/redeem modules and Kconfig/CMake.
- Files changed:
  - `server/api/src/modules/device-status/device-status.service.ts`: reuses
    `authenticateDevice`; returns only authenticated Device identity and
    non-secret lifecycle fields.
  - `server/api/src/modules/device-status/device-status.routes.ts` and test:
    adds `GET /v1/device-status`, Bearer-authenticated with no path/body device
    selector; route performs no write, event or notification creation.
  - `server/api/src/app.ts`: registers the route. Build-generated `dist`
    output was produced by the existing build command.
  - `firmware/esp32/main/commissioning_backend_reachability_http.c`: bounded
    FreeRTOS HTTPS task using ESP-IDF CA bundle, `GET /v1/device-status`,
    bounded response, Device ID/key and enrollment/provisioning validation,
    error classification, generation completion and secret cleanup.
  - `firmware/esp32/main/commissioning_backend_reachability.h` and
    `main/CMakeLists.txt`: expose and compile the HTTPS probe.
- Commands/results:
  - Focused backend route test: first run **FAIL**, exit 0 for the combined
    command because the test fake returned a Device for every token; the fake
    was corrected to match the verifier hash. This exposed a test-fixture bug,
    not a production authorization bypass.
  - Focused route test after fix: **PASS**, exit 0; 7/7 tests passed, 0 failed,
    0 skipped.
  - `npm run typecheck`: **PASS**, exit 0.
  - `npm run build`: **PASS**, exit 0; Prisma client generation and TypeScript
    build completed.
  - Full backend `npm test`: **PASS**, exit 0; 134 passed, 42 skipped, 0
    failed; 33 test files passed, 2 skipped.
  - Docker C host suite (physical, identity, lifecycle, protocol, crypto,
    storage, Wi-Fi controller, reachability): **PASS**, exit 0; 8/8 passed,
    0 failed, 0 skipped. The ESP-IDF-specific HTTP source is validated by the
    target build; the host suite does not execute TLS runtime.
  - ESP-IDF v5.5.5 build, target `esp32s3`, explicit CMake/Ninja paths and
    `NINJAFLAGS=-j1`: **PASS**, exit 0; firmware `0xf7280`, partition
    `0x100000`, free `0x8d80` (3%). Known nonfatal `ESP_ROM_ELF_DIR` warning
    remains.
  - `git diff --check`: **PASS**; existing LF/CRLF normalization warnings
    only.
  - Android tests/build: **NOT RUN**; Android source unchanged.
  - PostgreSQL integration: **NOT RUN**; route is read-only and no DB write or
    migration was required.
- New evidence: backend contract and regression tests are fresh; firmware
  HTTPS probe compiles for ESP-IDF. No live HTTPS request, protected storage,
  board Wi-Fi, reboot persistence, `ONLINE` runtime or Device Event evidence
  was created.
- Security decisions: route authenticates solely through the existing hashed
  operational credential verifier and active/enrolled/provisioned checks. It
  returns no credential and has no event/notification side effect. Firmware
  uses CA validation and fails closed on provider/response/generation errors.
  No health-as-authentication, probe event, plaintext fallback, eFuse/security
  change, flash/reset/erase or real notification was used.
- Open blockers:
  1. Protected operational credential storage and board runtime evidence are
     still unavailable.
  2. The HTTPS probe has target-build evidence but has not run on an ESP32-S3.
  3. Wi-Fi association, backend reachability, reboot persistence, Device Event
     and notification remain unverified on hardware.
- Next actions:
  1. Obtain storage policy approval and validate the route/probe on a board
     using a non-production test environment.
  2. Capture response/error evidence without secrets and verify stale/cancel
     behavior during runtime.
  3. Only then mark runtime `ONLINE` and continue hardware E2E acceptance.
- Result: `PARTIALLY COMPLETED`.

### WP14-RUN-020 verification continuation

- After the first controller API adjustment, the focused host command failed
  with exit 1 because one test call had not yet supplied the new `now_ms`
  argument. The test was corrected; the complete 7-executable C host suite was
  rerun and passed with exit 0.
- The ESP-IDF build was rerun after that correction and passed with exit 0;
  firmware remained `0xf7280` bytes with `0x8d80` bytes free in the `0x100000`
  app partition.

## WP14-RUN-020

- Time: 2026-10-28 17:38:13 +07:00 (Asia/Saigon).
- Git state: branch `main`, HEAD `ec76bbafb3022e3dca47de956f8e5b86818b0007`,
  dirty working tree preserved. Existing WP13/WP14 changes were not reset or
  overwritten.
- Goal: implement a non-blocking Station Wi-Fi controller using the existing
  commissioning lifecycle, with bounded retry, cancellation, timeout and
  generation guards; keep protected storage fail-closed.
- Read/decision inheritance: WP14-RUN-019, WP14-9 report, existing Wi-Fi
  event/reconnect code, commissioning transport/redeem/storage modules,
  protocol/ADR documentation and current Kconfig. No backend or Android source
  was changed in this run.
- Files changed:
  - `firmware/esp32/main/commissioning_wifi_controller.h/.c`: added a
    testable controller that owns bounded SSID/password buffers, invokes
    non-blocking configure/connect callbacks, maps ESP event outcomes into the
    existing lifecycle, ignores stale generations, schedules bounded backoff,
    and clears credentials on terminal paths. `ONLINE` requires a separate
    backend-reachability mark; Wi-Fi association alone is not promoted.
  - `firmware/esp32/main/main.c`: wired the controller into redemption success,
    Wi-Fi event reporting and a periodic FreeRTOS tick task; commissioning
    builds can initialize station configuration without a build-time SSID.
  - `firmware/esp32/main/CMakeLists.txt`: includes the controller in the ESP-IDF
    component.
  - `firmware/esp32/tests/commissioning_wifi_controller_test.c`: covers connect
    success, backend-online gating, stale events, retry exhaustion and cancel
    cleanup.
- Commands/results:
  - Docker C host suite with physical, identity, lifecycle, protocol, crypto,
    storage and Wi-Fi-controller executables: **PASS**, exit 0; 7 executables
    passed, 0 failed, 0 skipped.
  - ESP-IDF v5.5.5 build with explicit installed CMake/Ninja paths and
    `NINJAFLAGS=-j1`: **PASS**, exit 0; target `esp32s3`; binary `0xf7280`,
    partition `0x100000`, free `0x8d80` (3%). The existing near-full warning
    remains.
  - `git diff --check`: **PASS**; existing LF/CRLF normalization warnings
    only.
  - Android JVM/build: **NOT RUN**; Android source was not changed in this
    run. WP14-RUN-019 Android evidence remains historical for this increment.
  - Backend tests/typecheck/build and PostgreSQL integration: **NOT RUN**;
    backend source/contract was not changed and no DB write was required.
- New evidence: the controller source compiles into the ESP-IDF target and its
  host abstraction passes success/failure/cancellation/stale-event tests. This
  is controller logic evidence only, not ESP32 Wi-Fi association or backend
  reachability evidence.
- Issues/fixes: no source compile failure remained after the controller was
  added. The build emitted the known nonfatal missing `ESP_ROM_ELF_DIR` warning
  while regenerating gdbinit metadata.
- Security decisions: no provider fallback, plaintext NVS, hardcoded key,
  eFuse/security change, flash/reset/erase, production/staging write or real
  notification was used. The controller is only started after the existing
  redemption/storage gate returns success; the current operational profile
  keeps that gate disabled.
- Open blockers:
  1. Protected operational-credential provider and hardware persistence remain
     unapproved/unverified.
  2. Board runtime has not verified SoftAP-to-Station transition, Wi-Fi join,
     backend reachability or reboot recovery.
  3. The existing SoftAP/Wi-Fi initialization ownership still requires board
     validation before claiming runtime commissioning success.
  4. Device Event from a commissioned board and real notification remain
     unverified.
- Next actions:
  1. Review the Wi-Fi initialization ownership and run the controller on an
     approved board only after storage policy approval.
  2. Add a real backend-reachability/Device-Event confirmation path before
     calling `mark_backend_online`.
  3. Capture separate hardware evidence for association, retry, reboot and
     event delivery; do not promote host/build evidence to runtime PASS.
- Result: `PARTIALLY COMPLETED`.

## WP14-RUN-018

- Time: 2026-10-28 17:27:42 +07:00 (Asia/Saigon).
- Git state: dirty working tree preserved; HEAD `ec76bba`; no reset,
  overwrite, flash, reset, erase or eFuse operation.
- Goal: implement firmware redemption contract, protected storage boundary,
  Android SoftAP handoff abstraction and regression verification.
- Read/decision inheritance: latest RUN-017, WP14-9 report, backend provisioning
  route/service/crypto/schema/tests, firmware transport/identity/event code,
  Android Owner module and the existing protocol/security decisions.
- Files changed: added `commissioning_redeem.h/.c` and
  `commissioning_credential_storage.h/.c`; updated firmware CMake/Kconfig,
  `main.c`, transport callback/payload context; added Android
  `SoftApConnection.java`, manifest permissions and redemption context handling
  in `CommissioningTransportClient.java`. Updated only the WP14-9 report and
  this append-only log for WP14 documentation.
- Contract evidence: backend redemption is
  `POST /v1/devices/:deviceId/provisioning-sessions/:sessionId/redeem` with
  `bootstrapSecret`, `challenge`, and DER signature over the canonical payload;
  response contains `data.operationalToken`. No backend contract was changed.
- Commands/results:
  - `./gradlew.bat :owner:testDebugUnitTest :owner:assembleDebug`: **PASS**,
    exit 0; 11 tests passed, 0 failed; APK build passed.
  - Docker C host suite: **PASS**, exit 0; physical, identity, lifecycle,
    transcript and crypto executables passed.
  - Fresh/incremental ESP-IDF build with explicit CMake/Ninja PATH,
    ESP-IDF v5.5.5, target `esp32s3`, `NINJAFLAGS=-j1`: **PASS**, exit 0.
    Binary `0xf7220`, app partition `0x100000`, free `0x8de0` (~3%).
  - `git diff --check`: **PASS**, existing line-ending warnings only.
  - Backend and PostgreSQL suites: **NOT RUN**; no backend source or DB write
    changed in this run.
- New evidence classification: firmware compile includes the redemption and
  storage boundaries; Android JVM/build evidence covers the transport payload
  path; C tests remain host-only. No evidence was created for protected NVS,
  ESP-IDF TLS runtime, Wi-Fi association, reboot persistence, Device Event from
  a commissioned board or real notifications.
- Issues/fixes: initial sandbox firmware build failed with WinError 5 while
  creating the ninja subprocess; rerun with the installed CMake/Ninja paths and
  required execution permission completed successfully. Known
  `ESP_ROM_ELF_DIR` warning remains nonfatal. The contract audit exposed that
  redemption needs bootstrap/device context, so that context is now carried
  only inside the authenticated encrypted credentials payload.
- Follow-up fix: the first Android UI wiring build failed because the listener
  callback signature used `onLost(Network)` instead of the abstraction's
  `onLost()`. The callback was corrected and the final Android build/tests
  passed; this is fresh evidence for the final source state.
- Security decisions: operational storage gate remains disabled; callback
  refuses redemption unless a protected provider is ready. No normal-NVS
  secret fallback, replacement identity, TLS bypass, eFuse change or real
  notification was used.
- Open blockers:
  1. Approved protected operational-credential provider and hardware/runtime
     persistence evidence.
  2. Station Wi-Fi join/retry/wait integration after encrypted credentials.
  3. Device Event sender must consume the approved stored credential instead of
     the build-time token configuration.
  4. Real-device Wi-Fi handoff validation and Android process-network behavior.
  5. Board runtime and full E2E evidence.
- Next actions: obtain storage-policy approval; implement the approved storage
  provider and station transition; then schedule Android/board-only validation
  without changing security fuses.
- Result: `PARTIALLY COMPLETED`.

## WP14-RUN-019

- Time: 2026-10-28 17:33:15 +07:00 (Asia/Saigon).
- Git state: branch `main`, HEAD `ec76bbafb3022e3dca47de956f8e5b86818b0007`,
  dirty working tree preserved. Existing WP13/WP14 source, generated output,
  fixtures and documentation changes were not reset or overwritten.
- Goal: complete the safe credential-provider boundary, extend the existing
  commissioning lifecycle for persistence/Wi-Fi/retry states, and make the
  commissioning-enabled Device Event path consume a provider credential
  without introducing plaintext fallback.
- Read/decision inheritance: latest engineering-log entry, WP14-9 report,
  current firmware transport/redeem/storage/identity code, Android Owner
  lifecycle/SoftAP code and existing backend redemption contract. No backend
  contract or database source was changed in this run.
- Files changed in this run:
  - `firmware/esp32/main/main.c`: added local sensitive-buffer clearing for
    every early-return path in the commissioning-enabled event sender; the
    sender remains fail-closed when provider storage is unavailable.
  - `firmware/esp32/main/commissioning_state.h/.c`: extended the existing
    lifecycle with credential-persisting, Wi-Fi-connected and bounded retry
    states; no competing state machine was introduced.
  - `firmware/esp32/main/commissioning_transport.c`: rejects credentials when
    the transition into redeeming is invalid instead of ignoring the result.
  - `firmware/esp32/tests/commissioning_state_test.c`: covered the successful
    persistence/Wi-Fi path and bounded retry-to-failure path.
  - `firmware/esp32/tests/commissioning_credential_storage_test.c` and
    `firmware/esp32/tests/sdkconfig.h`: added host contract coverage for
    unavailable, success, invalid and I/O-error storage behavior using a test
    double; this is not protected-NVS evidence.
- Commands/results:
  - Docker C host suite with physical, identity, lifecycle, protocol, crypto
    and credential-storage executables: **PASS**, exit 0; 6 executables passed,
    0 failed, 0 skipped. The container used a read-only repository mount,
    network disabled and no database.
  - `./gradlew.bat :owner:testDebugUnitTest :owner:assembleDebug` from
    `apps/android-fcm-test`: **PASS**, exit 0; 11 JVM tests passed, 0 failed,
    0 skipped; APK size `911433` bytes.
  - ESP-IDF v5.5.5 build with explicit installed CMake/Ninja paths and
    `NINJAFLAGS=-j1`: **PASS**, exit 0; target `esp32s3`; binary
    `0xf7280` bytes in `0x100000` app partition, `0x8d80` bytes free (3%).
    The build reported the existing near-full-partition warning.
  - `git diff --check`: **PASS**; only existing LF/CRLF normalization warnings
    were emitted.
  - Backend tests/typecheck/build and PostgreSQL integration: **NOT RUN**;
    backend source/contract was not changed in this run and no DB write was
    required.
- New evidence: host lifecycle and storage contract tests pass; firmware
  compile includes the updated lifecycle and provider-gated event path; the
  Android artifact/test evidence is fresh. These do not prove protected NVS,
  Station Wi-Fi association, reboot persistence, device event from a board or
  real notification delivery.
- Issues/fixes: the commissioning-enabled event path referenced a helper that
  was local to another translation unit and did not clear the loaded token on
  all early returns. A local `clear_sensitive` helper and cleanup branches were
  added before the successful firmware build.
- Security decisions: provider readiness remains disabled in the operational
  profile because no approved protected implementation/eFuse policy exists.
  No eFuse, flash, erase, reset, TLS bypass, plaintext credential fallback,
  replacement identity, production/staging write or real FCM/email action was
  performed.
- Open blockers:
  1. Protected operational-credential provider and hardware/runtime recovery
     evidence are not available; current provider is intentionally fail-closed.
  2. Station Wi-Fi connect/wait/retry is represented in the lifecycle but is
     not yet implemented as a verified firmware runtime path.
  3. Device Event from a commissioned board cannot be verified until the
     protected provider and Station path are approved and available.
  4. Android Wi-Fi handoff and all board runtime behavior remain unverified.
- Next actions:
  1. Obtain explicit storage/recovery policy approval and implement only the
     approved protected provider; do not enable Kconfig/eFuse by guesswork.
  2. Implement a non-blocking Station Wi-Fi controller behind the lifecycle,
     with bounded retries and status reporting, while retaining fail-closed
     storage behavior.
  3. Re-run Android handoff on an approved Android device and perform board
     validation only under a separately approved hardware procedure.
- Result: `PARTIALLY COMPLETED`.

## WP14-RUN-017

- Time: 2026-10-28 17:19:16 +07:00 (Asia/Saigon).
- Git state: working tree remains dirty with pre-existing WP13/WP14 source,
  generated output, fixtures and documentation changes; HEAD was `ec76bba`.
  No reset, checkout overwrite or hardware operation was performed.
- Goal: implement the smallest real ESP-IDF SoftAP transport and Android local
  transport boundary while preserving fail-closed identity/storage behavior.
- Read: this log, WP14-9 report, SoftAP protocol, ADR-0004, firmware identity,
  lifecycle, protocol and physical-confirmation modules, ESP-IDF build guide,
  Android Owner transport/session code and backend provisioning source.
- Files changed: added `firmware/esp32/main/commissioning_transport.h/.c`,
  added `apps/android-fcm-test/owner/src/main/java/com/pulselink/owner/CommissioningTransportClient.java`
  and its JVM test, wired the firmware source/dependency in `main/CMakeLists.txt`,
  and added guarded commissioning startup in `main.c`. Updated only the
  WP14-9 summary report and this append-only log for WP14 documentation.
- Commands/results:
  - Correct Docker C host suite from the repository test instructions: **PASS**,
    exit 0; physical gate, identity/canonical payload, lifecycle, transcript
    and crypto fixture executables all completed.
  - `./gradlew.bat :owner:testDebugUnitTest :owner:assembleDebug`: **PASS**,
    exit 0, `BUILD SUCCESSFUL`; 11 JVM tests passed, 0 failed; APK artifact was produced.
  - `idf.py --version`: **PASS**, ESP-IDF v5.5.5.
  - Same-source ESP-IDF build after final firmware integration: **PASS**,
    exit 0, target `esp32s3`, single-job; final binary `0xf7220` in a
    `0x100000` app partition with `0x8de0` free. A later attempt to rerun
    `idf.py build` in the current shell could not start because CMake was not
    on PATH; this is an environment limitation, not a pass.
  - `git diff --check`: **PASS**, with existing line-ending normalization
    warnings only.
  - Backend/DB tests: **NOT RUN** in this increment; no backend source or DB
    contract changed and no write test was required.
- New evidence classification: ESP-IDF target compile/build and Android JVM
  build/tests are compile/test evidence; C tests are isolated host evidence;
  no SoftAP, mbedTLS-on-board, NVS persistence, Wi-Fi, redemption, Device Event
  or hardware evidence was created.
- Issue/fix: first transport compile failed on an undeclared `time` function;
  adding `<time.h>` fixed the compile error. An initial container command used
  paths relative to the wrong working directory; the corrected documented
  command passed. The handshake now transitions to
  `COMMISSIONING_RECEIVING_CONFIG` before accepting the encrypted credentials
  endpoint.
- Security decisions: identity provider and commissioning remain disabled in
  the default operational profile; credentials are rejected by the firmware
  callback until redemption and protected storage exist. No eFuse, Flash
  Encryption, Secure Boot, flash, erase, reset, plaintext fallback, shared
  secret or real notification was used.
- Open blockers:
  1. Firmware redemption HTTPS client and backend response handling.
  2. Approved/proven protected operational-credential storage and identity
     persistence on hardware.
  3. Android Wi-Fi handoff/UI wiring and app lifecycle integration.
  4. Board runtime evidence for GPIO, SoftAP, Wi-Fi, reboot and Device Event.
  5. Fresh build shell must expose CMake/Ninja for repeatability.
- Next actions (priority order): implement redemption/storage boundary
  fail-closed; wire the already-tested Android client to approved Wi-Fi APIs;
  restore the ESP-IDF shell and rerun build; then schedule separately approved
  hardware validation.
- Result: `PARTIALLY COMPLETED`.

## WP14-RUN-021

- Time: 2026-10-28 17:43:14 +07:00 (Asia/Saigon).
- Git state: branch `main`, HEAD `ec76bbafb3022e3dca47de956f8e5b86818b0007`,
  dirty working tree preserved; no reset, overwrite, hardware operation or DB
  write was performed.
- Goal: add backend reachability confirmation and safe `ONLINE` gating without
  treating public health or Device Event side effects as device authentication.
- Read: WP14 engineering log/report, current controller/state/redeem/storage/
  transport/main source, backend health and Device Event routes/services/tests.
- Contract finding: backend currently has authenticated `POST /v1/device-events`
  and unauthenticated health/readiness routes, but no read-only authenticated
  Device status endpoint. A health call would not prove Device identity, and a
  probe event would create data/notification. No new route/schema/migration was
  added; real backend confirmation remains blocked pending contract approval.
- Files changed:
  - `firmware/esp32/main/commissioning_backend_reachability.h/.c`: provider-
    gated asynchronous probe boundary, credential buffer cleanup, generation
    guard, result classification boundary and explicit success-only call to the
    existing Wi-Fi controller `mark_backend_online`.
  - `firmware/esp32/tests/commissioning_backend_reachability_test.c`: tests
    unavailable initialization, credential handoff, stale result, auth failure
    and success transition.
  - `firmware/esp32/main/CMakeLists.txt`: includes the adapter.
- Commands/results:
  - Docker C host suite with 8 executables (physical, identity, lifecycle,
    protocol, crypto, storage, Wi-Fi controller, reachability): **PASS**, exit
    0; 8 passed, 0 failed, 0 skipped.
  - ESP-IDF v5.5.5 build, target `esp32s3`, explicit CMake/Ninja paths and
    `NINJAFLAGS=-j1`: **PASS**, exit 0; binary `0xf7280`, partition `0x100000`,
    free `0x8d80` (3%). Known nonfatal `ESP_ROM_ELF_DIR` warning remains.
  - `git diff --check`: **PASS**; existing LF/CRLF normalization warnings only.
  - Android tests/build: **NOT RUN**; Android source unchanged.
  - Backend tests/typecheck/build: **NOT RUN**; backend source/contract
    unchanged.
  - PostgreSQL integration: **NOT RUN**; no DB write or migration required.
  - Board/real HTTPS probe: **NOT VERIFIED**; no board operation and no
    approved read-only status contract.
- New evidence: host adapter and firmware compile evidence only. No claim of
  backend reachability, protected storage, Wi-Fi runtime, `ONLINE`, Device
  Event from hardware or notification delivery was made.
- Security decisions: do not use public health as Device authentication; do not
  create a probe event; keep provider and TLS boundaries fail-closed. No eFuse,
  flash/reset/erase, plaintext fallback, production/staging write or real
  notification was used.
- Open blockers:
  1. Owner approval for a minimal read-only authenticated Device status
     contract, or another existing authenticated operation with no side effect.
  2. Protected operational credential storage and hardware persistence evidence.
  3. Board runtime validation of Wi-Fi association, HTTPS reachability, reboot
     recovery and Device Event.
- Next actions:
  1. Approve the status contract and implement the ESP-IDF HTTPS probe using
     the existing CA validation and credential provider.
  2. Run focused backend tests for that route without production/staging writes.
  3. Perform separately approved board validation and only then claim runtime
     `ONLINE`.
- Result: `PARTIALLY COMPLETED`.

## WP14-RUN-024

- Time: 2026-10-28 17:57:37 +07:00 (Asia/Saigon).
- Git state: branch `main`, HEAD `ec76bbafb3022e3dca47de956f8e5b86818b0007`,
  dirty working tree preserved (61 status entries). No reset, overwrite, board
  operation, eFuse write, database write or real notification was performed.
- Goal: audit protected operational-credential storage readiness and the full
  redemption -> persistence -> authenticated status -> `COMMISSIONING_ONLINE`
  -> Device Event path.
- Findings: `commissioning_credential_storage_is_ready` is fail-closed unless
  both operational-storage Kconfig and `CONFIG_NVS_ENCRYPTION` are enabled and
  save/load callbacks are supplied. The default profile leaves operational
  storage, identity NVS provider, commissioning and NVS encryption disabled.
  `main.c` zero-initializes `s_credential_storage` and registers no protected
  operational-credential provider; redemption therefore rejects before token
  persistence. Commissioning event delivery requires provider-loaded
  credential and `COMMISSIONING_ONLINE`; the build-time token is only a
  separate legacy path when commissioning is disabled. Backend
  `GET /v1/device-status` authenticates from the operational credential and
  derives Device identity server-side without event/notification side effects.
- Files changed: this append-only entry and the WP14 summary report only; no
  source change was required by the audit.
- Commands/results:
  - Docker C host suite (9 executables): **BLOCKED**, exit 1 before tests;
    Docker Desktop Linux engine pipe access was denied. No C test result is
    claimed from this run.
  - Fresh ESP-IDF v5.5.5 build, target `esp32s3`, `NINJAFLAGS=-j1`: **PASS**,
    exit 0; firmware `0xf7280` / app partition `0x100000`, `0x8d80` bytes free
    (3%). Known nonfatal `ESP_ROM_ELF_DIR` warning was present.
  - Backend `npm test`: **PASS**, exit 0; 33 files passed, 2 skipped; 134
    tests passed, 42 skipped, 0 failed.
  - `git diff --check`: **PASS**, exit 0; existing LF/CRLF warnings only.
  - Native C compiler/CMake/Ninja: **NOT AVAILABLE** outside Docker/ESP-IDF.
  - Android tests/build and PostgreSQL integration: **NOT RUN**; no relevant
    source change or DB write was required.
  - Board runtime, reboot/NVS persistence, eFuse and Device Event:
    **NOT VERIFIED**; no board operation was performed.
- Fresh evidence versus historical evidence: backend suite and ESP-IDF build
  above were executed in this run. The prior 9/9 C host result remains
  historical because Docker prevented a fresh rerun.
- Security decisions: retain fail-closed storage and identity gates; do not
  enable encryption, select an eFuse block, generate replacement identity,
  use plaintext/build-time token fallback in commissioning, flash/reset a
  board, or write production/staging data.
- Open blockers: approved protected operational-credential provider and
  recovery policy; board evidence for protected storage/reboot, Wi-Fi,
  authenticated status, `ONLINE` and Device Event; Docker engine access for a
  fresh C rerun.
- Next actions: approve and implement the protected provider without guessing
  eFuse configuration; run it on an approved board; restore Docker access and
  rerun the C suite; then perform separately approved commissioning/runtime
  validation.
- Result: `PARTIALLY COMPLETED`.

## WP14-RUN-025

- Time: 2026-10-28 18:01:01 +07:00 (Asia/Saigon).
- Git state: branch `main`, HEAD `ec76bbafb3022e3dca47de956f8e5b86818b0007`,
  dirty working tree preserved (61 status entries). No reset, overwrite, board
  operation, eFuse/security provisioning, database write or real notification
  was performed.
- Goal: implement only safe protected-credential storage hardening while the
  required security approval, hardware key provisioning and recovery policy
  remain unavailable.
- Read/audited: WP14 log/report, credential storage API/test, redemption,
  event gate, backend reachability, identity provider, `main.c`, Kconfig,
  sdkconfig/defaults and build configuration.
- Files changed:
  - `firmware/esp32/main/commissioning_credential_storage.c`: readiness now
    also requires a non-null provider context; `load` clears output length
    before readiness/callback failure so stale length cannot be consumed.
  - `firmware/esp32/tests/commissioning_credential_storage_test.c`: regression
    coverage for missing context and output-length cleanup after I/O failure.
- Provider decision: no production provider was registered. Current Kconfig
  keeps operational storage and NVS encryption disabled, and `main.c` still
  has no protected save/load callbacks. Commissioning therefore remains
  fail-closed before token persistence; no plaintext or build-time-token
  fallback was added.
- Commands/results:
  - Targeted Docker C storage test: **BLOCKED**, exit 1 before compilation;
    Docker Desktop Linux engine pipe access denied. No test PASS is claimed.
  - Fresh ESP-IDF v5.5.5 `idf.py build`, target `esp32s3`, `NINJAFLAGS=-j1`:
    **PASS**, exit 0; `0xf7280 / 0x100000`, `0x8d80` bytes free (3%).
  - `git diff --check`: **PASS**, exit 0; existing LF/CRLF warnings only.
  - Backend/Android/PostgreSQL: **NOT RUN**; no corresponding source or
    contract change and no DB write was required.
  - Board protected storage/reboot/runtime: **NOT VERIFIED**; no board action.
- Fresh evidence versus historical evidence: firmware build and diff check
  were run after the source change. Storage test result is blocked before test
  execution; prior host results remain historical.
- Errors and handling: Docker engine access failed before test execution; the
  repository was not modified to bypass this environment blocker.
- Security decisions: do not enable NVS/Flash Encryption or Secure Boot, guess
  an eFuse block, create a replacement identity, or register a provider without
  reviewed key custody/recovery and approved hardware procedure.
- Open blockers: approved protected provider and recovery policy; hardware
  runtime evidence for encrypted persistence/reboot; Docker access for fresh
  host-test execution.
- Next actions: obtain security/hardware approval, implement the approved
  provider behind the existing Kconfig gate, run storage/recovery tests in the
  approved environment, then perform separately approved board validation.
- Result: `PARTIALLY COMPLETED`.

## WP14-RUN-026

- Time: 2026-10-28 18:03:24 +07:00 (Asia/Saigon).
- Git state: branch `main`, HEAD `ec76bbafb3022e3dca47de956f8e5b86818b0007`,
  dirty working tree preserved (61 status entries). No reset, overwrite, board
  operation, eFuse/security provisioning, database write or real notification
  was performed.
- Goal: define a reviewable storage-security design and acceptance contract;
  do not enable a provider or hardware security without approval.
- Read/audited: WP14 log/report, storage/redeem/event-gate/reachability/
  identity/main source, Kconfig, sdkconfig/defaults, partition configuration,
  backend authenticated status/Event paths and existing storage tests.
- Current evidence: `commissioning_credential_storage_is_ready` requires
  protected-storage Kconfig, NVS encryption, context and callbacks. The
  application has no production save/load provider. Current sdkconfig uses a
  single-app partition (`0x100000` smallest app partition), leaves NVS
  encryption, Flash Encryption, Secure Boot, commissioning and operational
  storage disabled. `sdkconfig.identity-provider.defaults` is explicitly a
  compile-only profile and is not hardware provisioning evidence.
- Design decisions: proposed encrypted NVS with ESP-IDF-managed key material is
  the smallest compatible option, but remains **PROPOSED — REQUIRES OWNER
  APPROVAL**. Flash Encryption/Secure Boot are separate protections and are not
  substitutes for an approved NVS/key-recovery policy. Any HMAC/eFuse key
  provisioning, factory custody, recovery and replacement-board procedure is
  **OPEN**.
- Files changed: this append-only log entry and the WP14 summary report only;
  no source/configuration security change was made.
- Commands/results:
  - Source/configuration inspection: **PASS**, read-only; no secret output.
  - `git diff --check`: **PASS**, exit 0; existing LF/CRLF warnings only.
  - Build/tests: **NOT RUN**; this increment changed only design/report
    documentation, not source or configuration. Prior results remain historical.
  - Hardware protected-storage/reboot/eFuse: **NOT VERIFIED**.
- Fresh evidence versus historical evidence: current source/config inspection
  and Git state are fresh; prior firmware and host/backend test results are not
  relabeled as fresh.
- Security decisions: keep provider and commissioning fail-closed; do not
  enable NVS/Flash Encryption/Secure Boot, select an eFuse block, generate
  provisioning keys, flash/reset a board or use plaintext fallback.
- Open blockers: owner approval of storage/key custody and recovery policy;
  hardware provisioning procedure; board runtime evidence; fresh C test
  execution remains blocked by Docker engine access.
- Next actions: approve one storage policy and recovery matrix; implement the
  provider behind existing Kconfig gates; run contract tests, build and approved
  board reboot/corruption tests before enabling commissioning.
- Result: `PARTIALLY COMPLETED`.

## WP14-RUN-027

- Time: 2026-10-28 18:10:37 +07:00 (Asia/Saigon).
- Git state: branch `main`, HEAD `ec76bbafb3022e3dca47de956f8e5b86818b0007`,
  dirty working tree preserved (61 status entries). No reset, overwrite, board
  operation, eFuse/security provisioning, database write or real notification
  was performed.
- Goal: close safe software gates for protected credential storage without
  enabling an unapproved production provider.
- Audit result: storage API, redemption, event gate, reachability, `main.c`,
  Kconfig and NVS initialization were rechecked. `main.c` uses ordinary
  `nvs_flash_init()` and does not initialize encrypted-NVS key material or
  register operational save/load callbacks. Registering a provider now would
  falsely imply protected persistence, so production storage remains
  unavailable and commissioning remains fail-closed.
- Files changed: no source/configuration files; only this log entry and the WP14
  summary report were updated.
- Commands/results:
  - Targeted Docker C storage test: **BLOCKED**, exit 1 before compilation;
    Docker Desktop Linux engine pipe access denied. No C test PASS is claimed.
  - Fresh ESP-IDF v5.5.5 build, target `esp32s3`, `NINJAFLAGS=-j1`:
    **PASS**, exit 0; firmware `0xf7280` / app partition `0x100000`,
    `0x8d80` bytes free (3%).
  - `git diff --check`: **PASS**, exit 0; existing LF/CRLF warnings only.
  - Android/backend/PostgreSQL tests: **NOT RUN**; no corresponding source or
    contract change and no database write was required.
  - Protected storage, reboot/power-loss and board runtime: **NOT VERIFIED**.
- Fresh evidence versus historical evidence: source/config audit, firmware
  build and diff check were performed in this run. Prior host/backend results
  are historical; Docker prevented fresh C test execution.
- Security decisions: do not enable NVS/Flash Encryption/Secure Boot, select an
  eFuse block, create hardcoded/shared keys, initialize an unapproved provider,
  or add plaintext/build-time-token fallback.
- Open blockers: owner approval of key custody/provisioning/recovery and
  factory-reset policy; approved secure-NVS initialization; board evidence for
  persistence/reboot and full commissioning; Docker access for host tests.
- Next actions: obtain approvals, implement secure NVS initialization and
  provider together behind the existing gates, then run storage contract tests
  and approved board corruption/reboot validation.
- Result: `PARTIALLY COMPLETED`.

## WP14-RUN-028

- Time: 2026-10-28 18:12:45 +07:00 (Asia/Saigon).
- Git state: branch `main`, HEAD `ec76bbafb3022e3dca47de956f8e5b86818b0007`,
  dirty working tree preserved (61 status entries). No reset, clean, overwrite,
  board operation, eFuse/security provisioning, database write or real
  notification was performed.
- Goal: restore C host test execution if possible and harden storage contract
  regressions.
- Environment audit: Docker contexts `desktop-linux` and `default` were checked
  read-only; both daemon pipes returned access denied. Native `cc`, `gcc`,
  `clang`, `cmake` and `ninja` were not found. No system permissions or global
  installation were changed.
- Files changed:
  - `firmware/esp32/main/commissioning_credential_storage.c`: clear output
    length before all validation paths, including invalid buffer/capacity.
  - `firmware/esp32/tests/commissioning_credential_storage_test.c`: cover
    missing save/load callbacks and insufficient capacity cleanup.
- Commands/results:
  - Docker full C host suite (9 executables): **BLOCKED**, exit 1 before
    compilation; Docker Desktop Linux engine pipe access denied.
  - Fresh ESP-IDF v5.5.5 build, target `esp32s3`, `NINJAFLAGS=-j1`:
    **PASS**, exit 0; `0xf7280 / 0x100000`, `0x8d80` bytes free (3%).
  - `git diff --check`: **PASS**, exit 0; existing LF/CRLF warnings only.
  - Android/backend/PostgreSQL: **NOT RUN**; no related source/contract change
    and no DB write was required.
  - Hardware storage/reboot/power-loss/runtime: **NOT VERIFIED**.
- Fresh evidence versus historical evidence: the storage source change was
  compiled by a fresh ESP-IDF build and diff check ran after the change. No C
  host test executed; prior host results remain historical.
- Security decisions: retain fail-closed provider gates; do not enable NVS,
  Flash Encryption or Secure Boot, select eFuse keys, add plaintext fallback or
  claim host tests prove protected storage.
- Open blockers: Docker/native C execution environment; owner-approved secure
  key provisioning/recovery policy; hardware protected-persistence evidence.
- Next actions: restore approved Docker access and run all 9 host executables;
  then, after security approval, implement secure NVS initialization/provider
  and execute approved board reboot/corruption tests.
- Result: `PARTIALLY COMPLETED`.

## WP14-RUN-029

- Time: 2026-10-28 18:17:34 +07:00 (Asia/Saigon).
- Git state: branch `main`, HEAD `ec76bbafb3022e3dca47de956f8e5b86818b0007`,
  dirty working tree preserved (61 status entries). No reset, clean, overwrite,
  board operation, eFuse/security provisioning, database write or real
  notification was performed.
- Goal: restore C host execution where possible and run the software baseline
  for Owner/backend/firmware acceptance.
- Files changed: no application source change; only this log and the WP14
  summary report were updated. Existing storage regression changes were kept.
- Commands/results:
  - Full Docker C host suite (9 executables): **BLOCKED**, exit 1 before
    compilation; `desktop-linux` Docker pipe access denied.
  - Native compiler alternative: ESP-IDF target GCC exists, but it cannot run
    host executables and was not used to fabricate host-test evidence.
  - Android `:owner:testDebugUnitTest :owner:assembleDebug`: **PASS**, exit 0;
    11 tests passed, 0 failed, 0 skipped; APK
    `apps/android-fcm-test/owner/build/outputs/apk/debug/owner-debug.apk`,
    911433 bytes.
  - Backend `npm run typecheck`: **PASS**, exit 0.
  - Backend `npm run build` (including Prisma generate): **PASS**, exit 0.
  - Backend `npm test`: **PASS**, exit 0; 33 files passed, 2 skipped; 134
    tests passed, 42 skipped, 0 failed.
  - Fresh ESP-IDF v5.5.5 build, target `esp32s3`, `NINJAFLAGS=-j1`:
    **PASS**, exit 0; `0xf7280 / 0x100000`, `0x8d80` bytes free (3%).
  - `adb devices`: **NOT VERIFIED**; ADB exists but no device/emulator was
    listed, so no APK installation or click-through was performed.
  - `git diff --check`: **PASS**, exit 0; existing LF/CRLF warnings only.
- Fresh evidence: Android JVM/build, backend checks, firmware build, ADB
  inventory and diff check were run in this increment. C host and hardware
  runtime remain blocked/not verified; previous host results remain historical.
- Security decisions: keep protected storage and commissioning fail-closed; no
  NVS/Flash Encryption/Secure Boot/eFuse operation, plaintext fallback, board
  flash/reset, production/staging write or real FCM/email.
- Open blockers: Docker/native host-test execution; approved secure credential
  provisioning/recovery policy; Android device/emulator; board storage,
  Wi-Fi, backend reachability, reboot and Device Event evidence.
- Next actions: restore Docker access and run all C executables; obtain the
  approved storage policy; install APK on an attached approved Android target;
  then perform separately approved board commissioning and event acceptance.
- Result: `PARTIALLY COMPLETED`.

## WP14-RUN-030

- Time: 2026-10-28 18:24:43 +07:00 (Asia/Saigon).
- Git state: branch `main`, HEAD `ec76bbafb3022e3dca47de956f8e5b86818b0007`,
  dirty working tree preserved (61 status entries). No reset, clean, overwrite,
  board operation, eFuse/security provisioning, database write or real
  notification was performed.
- Goal: implement the missing firmware commissioning lifecycle transition and
  record the complete software/hardware E2E gap status.
- Gap found: credentials transport invoked the redemption callback while the
  lifecycle was still `RECEIVING_CONFIG`; the callback then attempted the
  `REDEEMING -> CREDENTIAL_PERSISTING` transition, which could reject a valid
  redemption. The session consume-once marker was also not set on the success
  path.
- Files changed:
  - `firmware/esp32/main/commissioning_transport.c`: transition to
    `REDEEMING` before decrypt/callback; terminal-fail malformed or rejected
    credential handling; removed the late duplicate transition.
  - `firmware/esp32/main/main.c`: consume the commissioning session after
    successful redemption and before persistence/Wi-Fi transitions.
  - `docs/audits/wp14-30-full-commissioning-e2e-implementation.md`: detailed
    implementation, evidence and acceptance report.
  - This log and the WP14 summary report.
- Commands/results:
  - Fresh ESP-IDF v5.5.5 build, target `esp32s3`, `NINJAFLAGS=-j1`:
    **PASS**, exit 0; `0xf7280 / 0x100000`, `0x8d80` bytes free (3%).
  - Full Docker C host suite: **BLOCKED**, exit 1 before compilation;
    Docker Desktop Linux engine pipe access denied.
  - `git diff --check`: **PASS**, exit 0; existing LF/CRLF warnings only.
  - Android/backend tests/build: **HISTORICAL from WP14-RUN-029**, not rerun
    because Android/backend source was unchanged in this increment.
  - Android device and ESP32 board runtime: **NOT VERIFIED**; ADB had no
    attached target and no board operation was performed.
- Fresh evidence: firmware source change compiled successfully and partition
  size was measured in this run. Host C, physical Android, SoftAP, protected
  persistence and board E2E remain unverified/blocked.
- Security decisions: no storage provider was enabled; no plaintext fallback,
  build-time token commissioning fallback, TLS bypass, eFuse/security change,
  flash/reset, DB write or real notification was used.
- Open blockers: Docker host-test execution; approved protected credential
  storage/key recovery; attached Android target; approved ESP32 board runtime.
- Next actions: restore Docker and run all 9 C executables; rerun Android tests
  after any client changes; obtain storage approval; then execute the approved
  physical commissioning and Device Event acceptance run.
- Result: `PARTIALLY COMPLETED`.

## WP14-RUN-031

- Time: 2026-10-28 20:19 +07:00 (Asia/Saigon; 2026-10-28 13:19 UTC).
- Git state: branch `main`, HEAD `ec76bbafb3022e3dca47de956f8e5b86818b0007`;
  pre-existing dirty worktree retained. No reset/clean/checkout overwrite,
  board operation, security provisioning, database write or real notification.
- Goal: implement and verify the remaining safe commissioning vertical slice
  from Owner SoftAP setup through authenticated status and first Device Event.
- Initial gaps confirmed from source: firmware's single Wi-Fi owner and AP/STA
  transition needed integration; the runtime path was missing the HTTP reply
  boundary and redemption/status ordering; Android treated local credential
  acceptance too close to completion; Owner-visible Device status was not
  promoted by an authenticated committed event. Production credential storage
  and enrolled identity remain unavailable by design.
- Files changed for this run:
  - `firmware/esp32/main/commissioning_transport.c/.h`: use the existing
    ESP-IDF Wi-Fi/event-loop owner, open bounded SoftAP transport only through
    commissioning lifecycle, then return to station mode without a second
    driver initialization.
  - `firmware/esp32/main/commissioning_state.c` and
    `commissioning_wifi_controller.c/.h`: enforce config -> station join ->
    redemption/persistence -> backend confirmation -> online ordering; terminal
    cleanup and bounded failure handling.
  - `firmware/esp32/main/commissioning_backend_reachability.c` and `main.c`:
    queue credentials off the HTTP handler, redeem after station IP, persist
    before status probe, and allow ONLINE only for authenticated status result
    and current generation. Commissioning event send remains gated on ONLINE.
  - `firmware/esp32/main/Kconfig.projbuild`: select the ESP-IDF HKDF primitive
    only when commissioning is enabled; no storage/security feature is enabled.
  - Firmware host tests for lifecycle, Wi-Fi controller, backend reachability
    and event gate: align assertions with the required redemption-before-join
    sequence and rejection of stale/failed backend results.
  - `apps/android-fcm-test/owner/.../MainActivity.java`, manifest,
    `CommissioningTransportClient.java`, new `CommissioningDeviceStatus.java`
    and its tests: request required nearby-Wi-Fi permission, clear secrets and
    network binding, and wait for Owner API Device status rather than treating
    SoftAP HTTP success as ONLINE.
  - `server/api/src/modules/device-events/device-event.service.ts` and tests:
    atomically update the authenticated Device's ONLINE/last-seen status with
    event commit; reject/rollback if Device authorization changed in the
    transaction. No schema, migration, or route contract added.
  - This append-only log, the WP14 summary, and the detailed WP14.31 report.
- Commands/results (fresh in this run):
  - Isolated Docker C host suite, read-only source mount/network disabled,
    `gcc:13.2.0-bookworm`: **PASS**, exit 0; all 9 executable runners passed:
    physical confirmation, identity, commissioning state, protocol, crypto
    interoperability, credential storage contract, event gate, Wi-Fi
    controller, backend reachability. Host logic only; not ESP runtime.
  - Android `:owner:testDebugUnitTest :owner:assembleDebug`: **PASS**, exit 0;
    XML result count 14 passed, 0 failed, 0 skipped. APK exists at
    `apps/android-fcm-test/owner/build/outputs/apk/debug/owner-debug.apk`,
    914788 bytes.
  - Backend focused `npm test -- --run src/modules/device-events src/modules/device-status src/modules/provisioning`:
    **PASS**, exit 0; 8 files, 38 tests passed, no failures/skips reported.
  - Backend `npm run typecheck`: **PASS**, exit 0.
  - Backend full `npm test`: **PASS**, exit 0; 33 files passed, 2 files
    skipped; 135 passed, 42 skipped, 0 failed. Skips are reported, not counted
    as passes.
  - Backend `npm run build`: **PASS**, exit 0; Prisma client generation and
    TypeScript build completed. No schema/migration changed.
  - Fresh default ESP-IDF v5.5.5 `esp32s3` build with installed CMake/Ninja,
    Xtensa GCC and `NINJAFLAGS=-j1`: **PASS**, exit 0;
    `0xf7280 / 0x100000`, `0x8d80` bytes free (3%). Two setup attempts failed
    before build (idf.py not on PATH; then CMake not on PATH); corrected using
    the documented interpreter and tool paths.
  - Isolated commissioning-enabled ESP-IDF profile build: **PASS**, exit 0;
    `0xf92f0 / 0x100000`, `0x6d10` bytes free (3%). This compile-only profile
    does not enable/register protected operational storage. An initial link
    exposed disabled HKDF symbol; fixed by selecting `MBEDTLS_HKDF_C` when the
    commissioning feature is enabled, then reconfigured and rebuilt.
  - `git diff --check`: **PASS**, exit 0; Git reported existing LF/CRLF
    conversion warnings.
  - PostgreSQL integration: **NOT RUN**; safe environment check found
    `TEST_DATABASE_URL` not configured. No DB was contacted or written.
  - Android physical device and ESP32 hardware tests: **NOT RUN / NOT VERIFIED**;
    no device or board operation was used.
- One initial Android run had 3 failures because local JVM tests called Android
  `org.json` methods implemented as mock stubs. The status mapper was made
  pure-input testable; final suite then passed 14/14. An initial C host
  assertion expected an obsolete lifecycle transition; assertion was corrected
  to the actual fail-closed ordering and all 9 runners passed. No test was
  removed or weakened.
- Fresh evidence: the listed host, Android, backend and both ESP-IDF builds ran
  against current source. Previous WP14-030 results are historical only and
  are not used as this run's passes.
- Security decisions: keep identity and operational storage providers
  unavailable unless their existing protected-storage gates are satisfied;
  no plaintext fallback/build-time token for commissioning. No NVS/Flash
  Encryption, Secure Boot, eFuse, board flash/reset, TLS bypass, production DB
  write or real FCM/email.
- Open blockers: enrolled Device trust bootstrap/key acquisition is not
  available end-to-end from the Owner UI; production identity and operational
  credential storage are disabled/unapproved; hardware association, TLS,
  persistence/reboot and event runtime are unverified; dedicated PostgreSQL
  test target is not configured; notification provider remains fake/test.
- Next actions: approve and provision the protected identity/credential
  lifecycle with recovery policy; provide an enrolled test Device and approved
  test network/backend plus dedicated test DB; install APK on an Android device
  and execute the physical runbook; then collect board reboot and event evidence.
- Result: `PARTIALLY COMPLETED — HARDWARE E2E NOT VERIFIED`.
- Documentation tracking note: `docs/.gitignore` previously ignored the entire
  `/audits/` directory, so the required current log, summary, and WP14.31 report
  were invisible to Git review. Narrow exceptions were added for these three
  WP14 files only; other audit artifacts remain ignored.

## WP14-RUN-032

- Time: 2026-10-28 20:50 +07:00 (Asia/Saigon; 2026-10-28 13:50 UTC).
- Git state: branch `main`, HEAD `ec76bbafb3022e3dca47de956f8e5b86818b0007`;
  dirty working tree retained. No reset, clean, checkout overwrite, flash,
  board reset, eFuse operation, production write or real notification.
- Goal: close the safe software portion of trusted enrollment, add per-device
  key uniqueness, exercise PostgreSQL integration on the dedicated test DB,
  and assess Android/board availability.
- Source findings: Owner self-enrollment accepted a client-supplied public key
  without proving private-key possession; Device public keys had no DB unique
  constraint. Identity and operational-credential providers still require
  encrypted-NVS configuration and provisioning/recovery policy; no secure
  provider is registered in the production runtime.
- Files changed:
  - `server/api/src/modules/provisioning/provisioning-crypto.ts`: add a
    domain-separated enrollment transcript and P-256/SHA-256 DER signature
    verification, canonical base64 checks, 32-byte challenge and five-minute
    expiry bound.
  - `server/api/src/modules/provisioning/provisioning.service.ts`: require
    Device-bound proof; conditionally claim only an un-enrolled/non-revoked
    Device inside a transaction; map concurrent/duplicate claim conflicts.
  - `server/api/src/modules/provisioning/provisioning.routes.ts`: restrict
    enrollment to the existing operator-authorized endpoint and validate the
    signed proof; remove self-service Owner enrollment.
  - `server/api/prisma/schema.prisma` and additive
    `20261028204500_unique_device_enrollment_key/migration.sql`: enforce
    uniqueness of non-null enrolled SPKI keys so a key cannot identify two
    Devices.
  - `provisioning-crypto.test.ts`, `provisioning.service.test.ts`,
    `provisioning.routes.test.ts` and `postgres.integration.test.ts`: cover
    signature/context/expiry mutation, replay, atomic claim/race, removal of
    Owner self-enrollment and database uniqueness.
  - `docs/.gitignore`: expose only the new WP14.32 report in addition to the
    existing required WP14 log/summary/report files.
  - WP14 summary, this append-only log and the new WP14.32 report.
- Commands/results (fresh):
  - `npm test -- --run src/modules/provisioning`: **PASS**, exit 0; 4 files,
    15 tests passed.
  - `npm run typecheck`: **PASS**, exit 0.
  - `npm test`: **PASS**, exit 0; 33 files passed, 2 skipped; 137 passed,
    43 skipped, 0 failed. The PostgreSQL suite is explicitly run separately.
  - `npx prisma validate`: **PASS**, exit 0.
  - `npm run build`: **PASS**, exit 0; Prisma Client generation and TypeScript
    build.
  - Read-only test DB target check: **PASS**; `127.0.0.1:5434/pulselink_test`,
    distinct from `DATABASE_URL`; port 5434 open. Duplicate non-null enrollment
    public-key groups before migration: 0. No connection value printed.
  - `npx prisma migrate status` against the verified test DB: exit 1, reported
    exactly the new unique-key migration pending. `npx prisma migrate deploy`:
    **PASS**, exit 0; applied only
    `20261028204500_unique_device_enrollment_key` to
    `127.0.0.1:5434/pulselink_test`. No reset or migration-history edit.
  - PostgreSQL integration command with `NODE_ENV=test` and
    `PULSELINK_INTEGRATION_TESTS=1`: final **PASS**, exit 0; 1 file, 41 tests
    passed. Earlier run before updating enrollment fixtures failed 2 legacy
    enrollment calls; next run had one existing concurrent tokenless SignIn
    assertion fail; after fixture/migration changes, final full integration
    rerun passed 41/41. Failed attempts are retained as evidence, not passes.
  - Docker isolated C host suite, repository read-only, network disabled:
    **PASS**, exit 0; all 9 executable runners passed (0 failed/skipped).
    Initial sandbox run was blocked by Docker Desktop pipe access; elevated
    read-only run succeeded.
  - Android `:owner:testDebugUnitTest :owner:assembleDebug`: **PASS**, exit 0;
    14 passed, 0 failed/skipped; APK `owner-debug.apk` is 915134 bytes.
  - `adb install -r owner-debug.apk`: **PASS**, exit 0. `adb shell monkey` and
    activity query confirmed `com.pulselink.owner/.MainActivity` resumed on
    model `23021RAAEG`, Android 15. This is app-launch smoke evidence only; no
    sign-in, Wi-Fi configuration or backend request was made.
  - ESP-IDF v5.5.5 default `esp32s3` build: **PASS**, exit 0;
    `0xf7280 / 0x100000`, `0x8d80` free. Isolated commissioning-enabled build:
    **PASS**, exit 0; `0xf92f0 / 0x100000`, `0x6d10` free. No security/storage
    gate was enabled in the operational config.
  - ESP serial enumeration: one `COM4`, USB serial VID:PID `303a:1001` was
    visible; serial port was not opened because opening may change DTR/RTS and
    reset the board. ESP32 runtime therefore remains NOT VERIFIED.
  - `git diff --check`: **PASS**, exit 0; line-ending warnings only.
- Fresh evidence: proof-of-possession enforcement, single-key DB invariant,
  one additive migration on the verified test DB, 41 real PostgreSQL tests,
  Android device app launch, all 9 host C runners, Android/backend builds and
  both ESP-IDF profiles. No hardware commissioning evidence.
- Security decisions: only operator-authorized enrollment is accepted. The
  operator/factory must obtain proof from the actual per-board key through an
  approved secure channel. A signed proof is bound to Device key, SPKI, key
  version, 32-byte challenge and expiry; DB state consumes enrollment once.
  This is not a substitute for manufacturer identity/factory key custody.
  Protected operational storage remains fail-closed. No NVS/Flash Encryption,
  Secure Boot, eFuse, board flash/reset, plaintext fallback, or token logging.
- Open blockers: no in-repository factory/board mechanism currently supplies
  the enrolled key/proof; protected identity and operational credential key
  custody/recovery are not approved or verified; board runtime/Wi-Fi/backend/
  reboot/event E2E and phone SoftAP flow remain unrun. Notification provider
  stays fake/test. The initial isolated integration run exposed a flaky
  tokenless concurrent SignIn assertion; final complete DB integration rerun
  passed, but this concurrency path merits a separate regression audit if it
  recurs.
- Next actions: define/provision per-board identity and recovery policy;
  integrate factory/operator tooling that obtains the proof without exporting
  private keys; approve secure NVS key provisioning before enabling either
  storage provider; then perform approved physical commissioning, reboot and
  Device Event tests on COM4 and the Android device.
- Result: `PARTIALLY COMPLETED — STORAGE AND HARDWARE E2E BLOCKED`.
- Post-run migration verification: read-only `npx prisma migrate status` was
  rerun with `DATABASE_URL` process-local set to the same verified
  `127.0.0.1:5434/pulselink_test` target; **PASS**, exit 0, all 12 migrations
  are applied and schema is up to date.

## WP14-RUN-033

- Time: 2026-10-28 21:18 +07:00 (Asia/Saigon; 2026-10-28 14:18 UTC).
- Git state: branch `main`, HEAD `ec76bbafb3022e3dca47de956f8e5b86818b0007`;
  worktree was already dirty before this increment and remains dirty. Existing
  changes were preserved. No reset, clean, checkout overwrite or unrelated
  generated-file deletion.
- Goal: implement a repeatable development commissioning preflight, evaluate
  enrollment/storage readiness without bypassing trust gates, and prepare an
  operator acceptance sequence for WP14.38.
- Source/docs read: persistent WP14 log through RUN-032, WP14 summary, WP14.31
  and WP14.32 reports, repository and API AGENTS, architecture overview,
  ADR-0001, ADR-0004, provisioning routes/crypto, credential-storage API,
  firmware runtime/Kconfig/sdkconfig, Owner API/SoftAP transport, health routes,
  test Compose configuration and ESP-IDF 5.5.5 NVS encryption sources/docs.
- Findings confirmed against source: backend operator enrollment verifies the
  signed domain-separated Device proof and consumes enrollment once; there is
  no board/factory proof-acquisition channel in this repository. Operational
  credential storage remains disabled/unregistered and ordinary NVS startup is
  not protected-storage evidence. Local firmware sdkconfig has commissioning
  disabled, redemption origin unset, and an event origin outside the allowed
  private development host set. No such external origin was contacted.
- Files changed:
  - `scripts/Test-CommissioningReadiness.ps1`: one read-only preflight entry
    point; toolchain/ESP-IDF/APK/ADB/Docker/PnP inventory, strict development
    HTTPS probe gate, test-DB target validation, bounded read-only Prisma
    status, JSON and Markdown output, and actionable check classifications.
  - `docs/.gitignore`: allow the required WP14.33–WP14.37 readiness report.
  - `docs/audits/wp14-33-37-commissioning-readiness-report.md`: gate matrix,
    storage option assessment, current environment results and WP14.38
    operator sequence.
  - This log and `docs/audits/wp14-9-end-to-end-commissioning-report.md`.
- Fresh commands/results:
  - PowerShell Parser API on `scripts/Test-CommissioningReadiness.ps1`:
    **PASS**, exit 0, no parse errors.
  - `Test-CommissioningReadiness.ps1 -CheckTestDatabase` in approved local
    execution: overall **BLOCKED**, script exit 2; 14 PASS, 0 FAIL, 4 BLOCKED,
    2 SKIPPED. JSON and Markdown written under the process temp directory
    `pulselink-wp1433-preflight-final`.
  - Checks PASS: Git, Node, npm, Python, managed CMake/Ninja, ADB, Docker
    daemon read-only version, ESP-IDF 5.5.5 Python entrypoint, APK existence
    (915134 bytes), one ADB device listed, one PnP serial interface enumerated
    without opening it, certificate bundle config, and test DB migration
    status.
  - Read-only Prisma migration status target was validated as
    `127.0.0.1:5434/pulselink_test`; **PASS**. No migration/write was run.
  - Checks BLOCKED: commissioning sdkconfig disabled, redemption origin
    unset, firmware event origin not accepted as local development HTTPS,
    protected operational credential provider disabled.
  - Checks SKIPPED: Owner runtime API origin and backend HTTPS. No backend
    endpoint was configured and no HTTPS request was made.
  - URL guard test: configured a public hostname with `-ProbeBackend`; the
    preflight rejected it before a request. **PASS**, exit 0.
  - Initial in-sandbox Prisma child process attempt returned `EPERM` before
    status could complete. It was classified BLOCKED; the same read-only
    preflight was rerun in approved elevated execution and migration status
    passed. No database write occurred.
  - Initial preflight iteration exposed a tool-version capture defect and
    unavailable CIM serial enumeration. Version capture was corrected, managed
    ESP-IDF tool paths were recognized, and PnP cmdlet fallback succeeded in
    the final run. Intermediate preflight outputs are not used as final
    evidence.
  - `git diff --check`: **PASS**, exit 0. New readiness report is not ignored
    by Git. HEAD remains unchanged.
- Historical evidence (not rerun): WP14-RUN-032 backend tests/build/typecheck,
  PostgreSQL integration (41/41 on the verified test DB), C host suite (9
  executable runners), Android JVM tests (14/14), APK build (915134 bytes),
  and ESP-IDF default/commissioning builds (`0xf7280` / `0xf92f0` in the
  `0x100000` app partition). Product source in those components was not changed
  by RUN-033; those results remain historical, not fresh RUN-033 passes.
- Security decisions: keep commissioning and protected storage disabled.
  HMAC-backed encrypted NVS is the preferred candidate for policy review, not
  approved; no key ID/eFuse block or provisioning action was selected. Secure
  Boot, Flash Encryption and NVS Encryption were not enabled. No public-host
  HTTPS probe, production/staging access, database write, migration, container
  start, COM open, flash/reset/erase, Wi-Fi credential transfer or real
  notification occurred.
- Open blockers:
  1. No approved board/factory mechanism supplies enrollment SPKI and proof
     from the actual non-exportable per-device key.
  2. Key custody, encrypted-NVS provisioning, recovery, factory reset,
     rotation/revocation and replacement-board policies require approval.
  3. A development HTTPS origin reachable from phone and board is not
     configured; firmware redemption origin is empty and local event origin is
     not an approved development target.
  4. No hardware Wi-Fi, protected persistence, backend ONLINE, event ACK or
     reboot-recovery test was run.
- Next actions:
  1. Approve the exact factory identity and protected-storage/key-recovery
     policy, then integrate the board-side signer/factory station without
     private-key export.
  2. Provide a non-production HTTPS API origin, trusted CA/hostname and test
     router credentials; set only local development configuration.
  3. After those gates, separately authorize board programming/serial access
     and execute the WP14.38 sequence in the readiness report.
- Result: `PARTIALLY COMPLETED — GATES B/C BLOCKED; GATE D PREPARED, NOT
  PHYSICALLY VERIFIED`.

## WP14-RUN-034

- Time: 2026-10-28 22:44 +07:00 (Asia/Saigon; 2026-10-28 15:44 UTC).
- Git state: branch `main`, HEAD `bae594e44532c640d1d4fe5b394095fc1da0f6fd`.
  Worktree was dirty at entry; existing files were preserved. HEAD differs
  from the value recorded in RUN-033, so this run records the repository state
  actually observed. No reset, clean, checkout overwrite or migration-history
  change was performed.
- Goal: prepare the first commissioning safely by adding a shared Device
  enrollment proof codec/vector, an offline operator request builder, a
  reviewable identity/storage decision and an explicit read-only development
  health preflight.
- Source reviewed: RUN-033 and prior engineering log, WP14 summary and
  WP14.31/WP14.32 reports, repository/API instructions, architecture overview,
  ADR-0001/0004, existing enrollment route/crypto contract, firmware identity
  and provisioning payload source, preflight and build docs, ESP-IDF map and
  local configuration. Existing code confirms that no board/factory proof
  channel or approved protected operational-storage provider is registered.
- Files changed and purpose:
  - `firmware/esp32/main/device_provisioning_payload.c/.h`: bounded canonical
    enrollment transcript payload encoder matching the backend contract.
  - `firmware/esp32/tests/device_identity_test.c` and
    `firmware/esp32/tests/fixtures/device_enrollment_v1.hex`: verify C output
    byte-for-byte against a shared public-only vector.
  - `firmware/esp32/tests/README.md`: describes the vector and test boundary.
  - `server/api/src/modules/provisioning/device-enrollment-request.ts`:
    validates proof input and signature/expiry, then builds the existing
    operator enrollment request without sending it.
  - `server/api/src/modules/provisioning/device-enrollment-request.test.ts`:
    fixture interoperability, valid request, wrong key, expired proof and
    path-encoding tests.
  - `server/api/scripts/build-device-enrollment-request.ts` and
    `server/api/package.json`: bounded stdin-only builder CLI, no HTTP or
    operator-token handling.
  - `scripts/Test-CommissioningReadiness.ps1`: exact-host public development
    opt-in for only GET health routes; separately checks live and ready; probe
    timeout is bounded at 20 seconds.
  - `docs/architecture/adr/wp14-device-identity-and-credential-storage.md`:
    proposed alternatives, recommendation, threat boundaries and approvals.
  - `docs/.gitignore`: includes the WP14.38-A report exception.
  - `docs/audits/wp14-9-end-to-end-commissioning-report.md`: current status
    update and link; this log is append-only.
  - `docs/audits/wp14-38a-security-and-first-commissioning-readiness.md`:
    evidence and gate report.
- Fresh commands/results:
  - `npm test -- --run src/modules/provisioning`: first sandbox attempt
    returned `spawn EPERM` before tests started (FAIL to launch, not a test
    assertion). Elevated rerun **PASS**, exit 0: 5 files, 18 tests passed,
    0 failed, 0 skipped.
  - `npm run typecheck`: **PASS**, exit 0.
  - `npm run build`: **PASS**, exit 0; Prisma client generated and TypeScript
    build completed. No schema change. The generated untracked JS build output
    attributable to this run was removed; no user/source file was removed.
  - Docker isolated C host suite, read-only repository mount and networking
    disabled: **PASS**, 9 executable runners, 0 failed/skipped; includes the
    C side of the shared enrollment payload fixture. Host-only evidence.
  - ESP-IDF 5.5.5 default `esp32s3` build: **PASS**, exit 0. Image
    `0xf7280 / 0x100000`; `0x8d80` (36,224) bytes free, about 3.46%.
  - `idf.py size-components`: initial invocation failed because managed CMake
    was not on PATH; retry with CMake/Ninja/toolchain paths hit Windows
    `WinError 5` while spawning Ninja. Elevated retry **PASS**, exit 0; map
    analysis shows major flash archives are `libnet80211`, `libmbedtls`,
    `liblwip`, `libmbedcrypto`, `libc`, and `libesp_app_format`. Platform
    network/crypto dominate; no security check was removed.
  - Read-only HTTPS GET `/health/live` and `/health/ready` to the user-confirmed
    development host, with default TLS validation: both **PASS** and matched
    the documented response schema. No other HTTP route was requested.
  - `Test-CommissioningReadiness.ps1 -ProbeBackend
    -ApprovedPublicDevelopmentHost ...`: first run used the old 8-second
    timeout and recorded 13 PASS / 2 FAIL / 4 BLOCKED / 2 SKIPPED (both
    health requests timed out). After increasing the bounded timeout to 20
    seconds, final summary: 15 PASS / 0 FAIL / 4 BLOCKED / 2 SKIPPED, overall
    BLOCKED. PowerShell process exit observed as 1 even though script summary
    is BLOCKED; this exit mapping is recorded for follow-up. The final run
    queried no DB status. Output is under process temp, not committed.
  - The preflight's four BLOCKED checks are commissioning profile disabled,
    redemption origin unset, event origin not accepted as a development
    endpoint, and operational credential provider unavailable. Two checks
    SKIPPED: runtime Owner API origin and database status.
  - `npm test` first sandbox launch and the initial preflight timeout are
    retained as failures; successful retries are separate evidence.
- Historical evidence (not rerun here): Android Owner JVM/APK results and
  PostgreSQL integration result in RUN-032. No database connection, query,
  write, migration or reset occurred in this run.
- Security decisions: HMAC-backed encrypted NVS is recommended as a candidate,
  not approved or enabled. Secure Boot v2 is treated separately as firmware
  authenticity; Flash Encryption is a separate policy choice. No key ID/block
  was selected. No NVS/Flash Encryption, Secure Boot, eFuse, board flash/reset,
  serial open, Wi-Fi credential transfer, non-health endpoint, production/
  staging access, DB write, FCM or email occurred. The Wi-Fi value supplied
  in the conversation was not written to files or used.
- Errors and handling: Vite's child process was blocked under sandbox policy;
  focused tests were rerun in approved execution. The initial test iteration
  exposed expected fixture/key assertion problems; assertions/fixture were
  corrected and the final 18 tests passed. The first aggregate health probe
  timed out; a longer bounded timeout made both GET health checks pass. Ninja
  size analysis required managed PATH and approved execution. No test was
  skipped or weakened to obtain a pass.
- Open blockers:
  1. Gate B: no verified board-origin signing/proof channel; the builder cannot
     establish physical provenance.
  2. Gate C: owner approval is still required for per-device key custody,
     encrypted-NVS provisioning, recovery/factory reset, rotation/revocation,
     replacement-board policy, and whether Secure Boot/Flash Encryption are
     production requirements. The runtime provider remains unavailable.
  3. Gate D: board revision/schematic and exact serial/reset behavior are not
     verified; Android/board routes to this development host are not tested.
  4. Firmware local commissioning profile and redemption/event origins remain
     unready; app partition has only about 3.46% free.
- Next actions:
  1. Approve and record the storage/key-custody and recovery policy in the ADR;
     select the manufacturing role/station and a per-device HMAC provisioning
     procedure before selecting any eFuse key-purpose/block.
  2. Provide board revision/schematic and approve a specific non-exporting
     factory proof transport. Then implement the hardware-bound adapter and
     verify enrollment/replay on the actual board.
  3. Configure the firmware only for the confirmed development API/CA after
     reviewing profile changes; verify the phone and board network route.
  4. Separately authorize the exact serial/hardware operations and run physical
     commissioning, persistence/reboot, authenticated status and event tests.
- Result: `PARTIALLY COMPLETED — GATE A PARTIAL; GATES B/C BLOCKED; GATE D
  PREPARED, NOT PHYSICALLY VERIFIED`.

## WP14-RUN-035

- Time: 2026-10-29 09:50 +07:00 (Asia/Saigon; 2026-10-29 02:50 UTC).
- Git state: branch `main`, HEAD `bae594e44532c640d1d4fe5b394095fc1da0f6fd`.
  Worktree contains the continuing WP14 changes and was preserved. No reset,
  clean, checkout overwrite, migration-history edit or unrelated deletion.
- Goal: continue WP14.38 acceptance; run current backend, PostgreSQL, C host,
  Android and firmware checks, install/launch the Owner APK, verify the
  development health routes and classify hardware readiness.
- Source and reports reviewed: engineering log through RUN-034, WP14 summary,
  RUN-031/032/033/034 reports, repository/API instructions, architecture
  overview, ADR-0001, proposed WP14 storage ADR, preflight, Android Owner
  `MainActivity`/manifest, firmware Kconfig/sdkconfig/partition and identity/
  storage gates, API integration DB guard and test Compose file.
- Current source/config findings: Owner `onCreate()` restores local session
  only and does not make a request; the runtime form requires interactive
  credentials. The current firmware profile has commissioning disabled,
  redemption origin unset, operational credential storage disabled, and no
  protected provider. Thus no safe firmware image can complete redemption.
  COM4 PnP identity is Espressif USB Serial/JTAG VID/PID `303A:1001`; that does
  not identify module/revision or establish DTR/RTS/reset behavior.
- Files changed in this run:
  - `docs/audits/wp14-9-end-to-end-commissioning-report.md`: appended the
    WP14.38-B+ fresh verification and gate status.
  - This engineering log: appended RUN-035; no prior entry changed.
  Source implementation from RUN-034 was not changed in this run.
- Fresh commands/results:
  - `git rev-parse HEAD`, `git branch --show-current`, `git status`: HEAD
    `bae594e44532c640d1d4fe5b394095fc1da0f6fd`, branch `main`; dirty WP14
    worktree retained.
  - Read-only Windows PnP enumeration (elevated): **PASS**, COM4 reports
    `USB\\VID_303A&PID_1001&MI_00`, status OK. Port was not opened. Android
    `adb devices -l`: one device. Read-only `getprop` identified model
    `23021RAAEG`, Android 15.
  - Android first wrapper launch failed before Gradle with access denied on
    the shared wrapper lock. Elevated non-forced invocation exited 0 but all
    work was `UP-TO-DATE`, so it is not counted as test execution. Forced
    command `gradlew.bat :owner:testDebugUnitTest :owner:assembleDebug
    --rerun-tasks`: **PASS**, exit 0, 38 actionable tasks executed. JVM XML:
    7 files, 14 tests passed, 0 failed/skipped.
  - `adb install -r owner-debug.apk`: **PASS**, exit 0. `adb shell am start
    -W -n com.pulselink.owner/.MainActivity`: **PASS**, Activity started.
    `dumpsys activity activities` confirmed `MainActivity` resumed and
    `pidof` found the app process. APK is 903,106 bytes (SHA-256 recorded
    only as local artifact evidence in the execution output). No app login,
    API call, account creation or Store mutation was performed.
  - `npm test`: **PASS**, exit 0; 34 files passed, 2 skipped; 140 tests
    passed, 43 skipped, 0 failed. Integration is separately enabled below.
  - Dedicated test DB Compose status: initial Docker engine query was
    unavailable; Docker Desktop was started. `docker compose -f
    ../../infrastructure/docker/compose.test.yaml ps postgres-test` then
    showed existing `pulselink-postgres-test` healthy and bound to
    `127.0.0.1:5434`; no volume was reset and no container was stopped.
  - Read-only Prisma status with process-local DATABASE_URL set only after
    parsing and validating the target: **PASS**, exit 0, target
    `127.0.0.1:5434/pulselink_test`, schema up to date. No migration was run.
  - PostgreSQL integration:
    `NODE_ENV=test PULSELINK_INTEGRATION_TESTS=1 npm test -- --run
    src/test-support/postgres.integration.test.ts`: **PASS**, exit 0; 1 file,
    41 tests passed, 0 failed/skipped. Runtime guard validated the dedicated
    test DB; tests wrote their unique fixture rows and completed cleanup.
    No reset, migration or development DB (`5433`) use.
  - `npm run typecheck`: **PASS**, exit 0. `npm run build`: **PASS**, exit 0,
    Prisma client generation and TypeScript compile. `npx prisma validate`:
    **PASS**, exit 0. No schema change. The build emitted an untracked compiled
    JS file for the new request builder; that exact generated file was removed
    after verifying its provenance. No source file was removed.
  - C host suite first failed (exit 1) because the Docker compile command
    omitted `sdkconfig.h`; the next attempt compiled but the storage contract
    runner correctly observed the default disabled storage gate. Final
    read-only/no-network Docker command used a temporary `sdkconfig.h` in
    container `/tmp` defining only test compile gates, with the repository
    mounted read-only. **PASS**, `HOST_RUNNERS_PASS=9`, exit 0; all nine
    runners (physical confirmation, identity/payload fixture, lifecycle,
    transcript, crypto host interop, storage contract, event gate, Wi-Fi
    controller, reachability) passed. This host macro is not firmware
    configuration or evidence of protected storage.
  - ESP-IDF default build first failed before compilation with sandbox
    `WinError 5` spawning Ninja. Elevated ESP-IDF 5.5.5 `idf.py build`:
    **PASS**, exit 0, image `0xf7280 / 0x100000`, `0x8d80` (36,224) bytes
    free. Fresh isolated commissioning compile command
    `idf.py -B build/wp14-31-isolated-build build`: sandbox invocation was
    blocked by `WinError 5`; elevated rerun **PASS**, exit 0, image
    `0xf92f0 / 0x100000`, `0x6d10` (27,920) bytes free. Build emitted the
    known `ESP_ROM_ELF_DIR` gdbinit warning but completed. Commissioning image
    is compile evidence only; operational credential storage/NVS encryption
    stayed disabled. No flash command was run.
  - Final preflight child process: `-ProbeBackend -CheckTestDatabase
    -ApprovedPublicDevelopmentHost <exact confirmed host>`: process exit 2,
    overall BLOCKED, 16 PASS / 0 FAIL / 4 BLOCKED / 1 SKIPPED. Both
    `/health/live` and `/health/ready` GET contracts passed with normal TLS
    validation; read-only Prisma migration status passed for the verified
    test target. Four blockers: commissioning profile disabled, redemption
    origin unset, event origin not accepted as an approved local development
    origin, credential provider unavailable. Owner runtime API origin skipped.
    No other API route was requested.
  - Preflight exit-code follow-up: invoking the script in a PowerShell child
    with `Start-Process -PassThru` captured exit 2 for BLOCKED; this confirms
    the script's documented exit code is correct. The outer command runner
    displayed nonzero PowerShell process codes normalized as 1 in earlier
    command calls; no script fix was needed.
  - `git diff --check`: run after final document edits; **PASS**, exit 0,
    with Git LF-to-CRLF advisory warnings only. PowerShell Parser API on the
    preflight after timeout changes: **PASS**, exit 0.
- Historical evidence: RUN-034's focused provisioning 18/18, map breakdown,
  enrollment fixture and prior health probe were not replaced by this run's
  fresh results. RUN-035 adds full suite, dedicated DB integration, Android
  install/launch and both firmware build-profile evidence.
- Errors and handling: Gradle cache permission, Docker engine startup, Docker
  host compile setup, disabled production storage test gate, and sandbox
  process restrictions were recorded above. Each retried check either passed
  under the approved local execution context or remains explicitly blocked;
  no assertions were weakened.
- Security and side effects: Docker Desktop was started to enable the local
  test service. The already existing dedicated PostgreSQL test container was
  healthy; only guarded test rows were written/cleaned by the integration
  suite. No development DB write, production/staging request, migration,
  reset, real FCM/email, Wi-Fi credential transfer, COM open, flash/reset/
  erase, eFuse operation, NVS/Flash Encryption or Secure Boot change occurred.
  User-supplied Wi-Fi details were not persisted, logged or used.
- Open blockers:
  1. Trusted enrollment: no approved board-side factory/signing proof channel;
     USB identifier alone cannot prove the physical module or identity key.
  2. Protected storage: key custody, encrypted-NVS provisioning and recovery
     policy remain proposed/unapproved; production provider is unavailable.
  3. Hardware: board revision/schematic and COM4 DTR/RTS/reset behavior are
     unverified; firmware profile/origins are not commissioning-ready.
  4. Owner account/access and device workflow were not exercised; the app was
     installed/launched only. No app credentials or approved mailbox/test
     identity were supplied.
  5. Full phone-to-board Wi-Fi/backend status, Device Event, reboot recovery
     and notification delivery remain NOT VERIFIED.
- Next actions:
  1. Record approved per-device key custody, encrypted-NVS key provisioning,
     factory reset, revocation, rotation/replacement and recovery policy.
  2. Provide board revision/schematic; approve an actual non-exporting proof
     channel and verify reset/DTR behavior before any COM open.
  3. Build the reviewed firmware profile only after trusted identity/storage
     gates and development redemption/event origins are configured; then
     separately authorize exact board programming and test-router use.
  4. Supply a controlled test Owner identity/mailbox or approved test account
     if interactive sign-up must be exercised; no email was sent here.
  5. Run approved physical enrollment, provisioning, authenticated status,
     event commit/ACK/idempotency and reboot acceptance.
- Result: `PARTIALLY COMPLETED — SOFTWARE TESTS/BUILDS PASS; GATES B/C
  BLOCKED; HARDWARE E2E NOT VERIFIED`.

## WP14-RUN-036

- Time: 2026-10-29 10:00 Asia/Saigon (03:00 UTC).
- Git: HEAD `bae594e44532c640d1d4fe5b394095fc1da0f6fd`, branch `main`.
  Worktree was already dirty from RUN-035/WP14.38-A; those files were retained.
  This run additionally changed the Android Owner scanner, parser/tests and
  the WP14 summary/log only. No pre-existing changes were reverted.
- Goal: implement QR Device identity scanning for MVP without treating QR as
  enrollment, proof of possession or Store authorization.
- Inspected: current Android Owner activity/API/session/SoftAP transport;
  backend Device creation/list and operator enrollment route; Device CUID
  schema; firmware commissioning physical gate and Kconfig; ADR and prior
  WP14.32/WP14.33–37/WP14.38-A reports; latest summary and RUN-035.
- Contract finding: Owner `POST /v1/stores/:storeId/devices` creates an
  UNENROLLED Device already scoped to that Store. Backend trusted enrollment
  is the operator-only `/v1/operator/devices/:deviceId/enrollment`. No route
  links an already factory-enrolled, unassigned board by QR. Existing Owner
  list operation is therefore used only to confirm that the scanned ID is
  already in the selected Store and ENROLLED; no API was added to bypass this.
- Files changed:
  - `apps/android-fcm-test/owner/build.gradle.kts`: add Google Code Scanner
    dependency 16.1.0.
  - `apps/android-fcm-test/owner/src/main/AndroidManifest.xml`: declare the
    optional barcode UI module for Google Play services.
  - `apps/android-fcm-test/owner/src/main/java/com/pulselink/owner/MainActivity.java`:
    scan QR, parse identity, verify the ID through the authenticated selected-
    Store device list and require ENROLLED before enabling existing flow.
  - `apps/android-fcm-test/owner/src/main/java/com/pulselink/owner/DeviceQrIdentity.java`:
    accept raw Device ID or `pulselink://device/v1/{id}`; reject non-identity
    URI/query/fragment and invalid ID characters. QR conveys no secret.
  - `apps/android-fcm-test/owner/src/test/java/com/pulselink/owner/DeviceQrIdentityTest.java`:
    test valid formats and malformed/secret-bearing values.
  - `docs/audits/wp14-9-end-to-end-commissioning-report.md`: append current
    summary.
- Commands and fresh results:
  - `./gradlew.bat :owner:testDebugUnitTest :owner:assembleDebug` first attempt:
    **FAIL**, exit 1 before Gradle startup due access denied on the existing
    Gradle wrapper cache lock.
  - Same Gradle command with local elevated execution: initial compile
    **FAIL**, exit 1 because scanner imports used the wrong package. Imports
    corrected to the official `com.google.mlkit.vision.codescanner` package.
  - `.\gradlew.bat :owner:dependencies --configuration debugCompileClasspath`:
    **PASS**, exit 0; scanner artifact and transitive dependencies resolve.
  - `.\gradlew.bat :owner:testDebugUnitTest :owner:assembleDebug` after
    correction: **PASS**, exit 0; 8 JVM test suites, 16 tests passed, 0
    failed, 0 skipped. APK exists at
    `apps/android-fcm-test/owner/build/outputs/apk/debug/owner-debug.apk`,
    size 2,963,733 bytes.
  - `adb devices -l`: one Android 15 phone reported connected.
  - `adb install -r apps/android-fcm-test/owner/build/outputs/apk/debug/owner-debug.apk`:
    **PASS**, exit 0. `adb shell monkey -p com.pulselink.owner 1`: **PASS**,
    one launch event;
    activity history showed `com.pulselink.owner/.MainActivity`. No QR camera
    invocation, account sign-in, Store write or backend mutation was made.
  - `git diff --check`: **PASS**, exit 0; Git emitted LF-to-CRLF advisory
    warnings for the existing dirty tree and changed Java/manifest/Gradle files.
- Evidence classification: Android unit/build/install/launch results above
  are fresh. RUN-035 backend, PostgreSQL, C host and ESP-IDF evidence remains
  historical and was not rerun because this run changed Android only. No
  backend contract or firmware source changed.
- Security decisions: QR conveys identity only. Acceptance additionally
  requires authenticated backend visibility in the selected Store and
  ENROLLED state. Google Code Scanner delegates camera permission to Play
  services; scan runtime/model availability was not exercised. No secret was
  added to QR fixtures. User Wi-Fi credentials were not used or recorded.
- Errors: Gradle cache lock denied in sandbox; elevated local execution ran.
  Initial scanner compile failed from incorrect Java package import; checked
  official Google Code Scanner package and corrected it; final build passed.
- Open blockers:
  1. No backend contract exists to attach a factory-enrolled physical Device
     to a Store; current Owner Device create does not bind its generated ID to
     the board identity. Keep scans that are absent/not ENROLLED rejected.
  2. Device-origin factory enrollment proof channel is not implemented or
     verified; do not accept Owner-supplied keys or SoftAP identity as trust.
  3. Protected operational credential provider/key provisioning/recovery is
     still disabled/unapproved.
  4. Commissioning/button GPIO and reset semantics are unverified; no reset
     control was added or hardware button operated.
  5. SoftAP, test Wi-Fi, redemption, backend ONLINE, event, reboot and camera
     scanning remain NOT VERIFIED on hardware.
- Next actions:
  1. Define the manufacturing/store-linking contract: whether a device is
     precreated and operator-enrolled against a Store, or factory-enrolled
     globally and linked by an Owner through a proof-backed claim operation.
     Do not let QR ID alone authorize either path.
  2. Establish board-origin proof transport and approve storage/key recovery.
  3. After the contract and board gates are ready, exercise camera scan,
     Store confirmation, SoftAP, backend commissioning and recovery on board.
- Result: `PARTIALLY COMPLETED — QR SCANNING SOURCE AND ANDROID BUILD PASS;
  DEVICE LINKING/TRUST/STORAGE/HARDWARE E2E BLOCKED`.

## WP14-RUN-037

- Time: 2026-10-29 10:08 Asia/Saigon (03:08 UTC).
- Git: HEAD `bae594e44532c640d1d4fe5b394095fc1da0f6fd`, branch `main`.
  Existing RUN-036 and earlier WP14 dirty files were preserved. This run
  changed only this append-only entry and the WP14 summary section; no source,
  schema or migration was changed. The backend build emitted one untracked
  compiled JS artifact for the existing enrollment request builder and rewrote
  tracked `server/api/dist` outputs; after confirming those outputs were clean
  at run start, the exact untracked artifact was removed and the generated
  directory restored to its original tracked state.
- Goal: determine and implement a safe Store-linking contract for QR-identified
  factory-enrolled Devices.
- Fresh source findings:
  - `Device.storeId` is non-nullable and `Device.store` is a required relation.
    `@@unique([id, storeId])` supports a composite foreign key.
  - `ProvisioningSession` requires both `deviceId` and `storeId` and references
    that composite key plus Store.
  - Owner device create makes a Store-scoped `UNENROLLED` row; it does not
    bind a physical board identity.
  - Factory enrollment is operator-only. Its authorizer reads the Device's
    Store and requires an active Store-scoped `DEVICES_WRITE` grant.
  - No global factory principal, unassigned Device record, or Owner link API
    exists. Current contracts cannot produce the requested pre-enrolled,
    unassigned Device state.
- Decision: did not add a nominal link route, nullable Store migration, or
  owner-supplied key path. A compare-and-set claim could provide race safety
  only after a trusted path can create and enroll an unassigned record and an
  authorized factory principal is defined. Changing only the database
  nullability would not solve that authorization gap and would broaden the
  Device/Event/ProvisioningSession Store-scope model.
- Files changed: `docs/audits/wp14-9-end-to-end-commissioning-report.md`
  (WP14.40 findings/status) and this engineering log entry. All Android,
  firmware, backend and earlier documentation changes in the dirty worktree
  were retained unchanged.
- Commands and fresh results:
  - `npm test`: **PASS**, exit 0; 34 files passed, 2 skipped; 140 tests
    passed, 43 skipped, 0 failed.
  - `npm run typecheck`: **PASS**, exit 0.
  - `npm run build`: **PASS**, exit 0; Prisma client generation and TS build.
    It emitted `server/api/dist/modules/provisioning/device-enrollment-request.js`
    for the already-existing source and rewrote tracked `server/api/dist`
    outputs. The untracked file was removed and only the previously clean
    generated directory was restored; source was not changed.
  - `npx prisma validate`: **PASS**, exit 0; no schema change.
  - `.\gradlew.bat :owner:testDebugUnitTest :owner:assembleDebug`:
    executed with Gradle tasks UP-TO-DATE, exit 0; treated as regression build
    only, not fresh test execution.
  - `.\gradlew.bat :owner:testDebugUnitTest :owner:assembleDebug --rerun-tasks`:
    **PASS**, exit 0; 38 tasks executed. Android reports 16 tests passed,
    0 failed, 0 skipped.
  - `git diff --check`: **PASS**, exit 0; line-ending advisory warnings for
    the dirty worktree only.
- Database: no connection string or credentials inspected/printed, no
  PostgreSQL integration command run, no DB write, no migration and no reset.
  A link-specific PostgreSQL test cannot exercise a contract that does not
  exist.
- Evidence classification: all commands above are fresh. RUN-035/RUN-036
  C host, ESP-IDF and hardware evidence remains historical and was not rerun
  because firmware source was unchanged. Hardware remains NOT VERIFIED.
- Security decisions: preserve operator-only enrollment and active Owner
  authorization; QR ID remains non-secret and non-authoritative. No endpoint
  allows Store takeover or client-selected key registration. No credential,
  Wi-Fi data, production/staging request, FCM/email, serial open,
  flash/reset/erase, eFuse/security change or database write occurred.
- Blockers:
  1. Define an authenticated factory principal/process that can create and
     enroll an unassigned Device using proof originating from that board.
  2. Define the unassigned Device lifecycle and Store claim semantics; then
     implement nullable/staging representation and atomic claim if approved.
  3. Protected operational storage/key provisioning/recovery remains disabled
     and unapproved.
  4. Board-origin proof channel, verified reset GPIO/button mapping and
     physical SoftAP/Wi-Fi/redeem/ONLINE/Event/reboot evidence are absent.
- Next actions:
  1. Approve/specify the factory authority independent of Owner Store
     membership. Recommended: manufacturing station with narrowly scoped,
     auditable factory credentials; it submits only board-signed challenge
     proof and never exports private key material.
  2. After the contract exists, add an OWNER-only atomic claim for enrolled,
     unassigned Devices with a conflict on competing Store claim.
  3. Add PostgreSQL tests for Owner denial, un-enrolled, nonexistent, already
     claimed and concurrent Store claims on verified `pulselink_test:5434`.
  4. Resolve protected storage and board proof gates before physical pairing.
- Result: `PARTIALLY COMPLETED — BACKEND AND ANDROID REGRESSION PASS; STORE
  LINKING BLOCKED BY MISSING FACTORY AUTHORITY/DATA STATE; HARDWARE E2E NOT VERIFIED`.

## WP14-RUN-038

- Time: 2026-10-29 10:51 Asia/Saigon (UTC+07:00; 03:51 UTC).
- Git: HEAD `bae594e44532c640d1d4fe5b394095fc1da0f6fd`, branch `main`.
  Worktree was already dirty on entry with WP14.38–WP14.40 work. Those files
  were preserved. No reset/clean, database write, migration, device serial
  access, flash, reset, eFuse or security-fuse action occurred.
- Goal: replace the nonexistent factory prerequisite with first-claim
  proof-of-possession for a locally initialized ESP32 identity, an Owner-only
  atomic Store claim, and QR-to-SoftAP Android wiring.
- Fresh source decisions:
  - Device ID is `pl-` plus lowercase hex of the ESP32 STA base MAC. It is
    stable/public identification, not authentication and can be cloned.
  - Owner first requests a five-minute Store/account/Device-bound claim
    challenge. During the physical commissioning window, ESP32 verifies the
    requested ID against its own STA MAC and signs a domain-separated P-256
    claim transcript. Backend verifies P-256 SPKI, canonical DER signature,
    challenge, expiry, active Owner membership and binding before inserting a
    Store-scoped `ENROLLED` Device. The Device primary key and public-key
    unique constraint, transactional consume-once update and generic conflict
    prevent cross-Store takeover/racing claims. Repeating a claim on the same
    Store returns the already-linked Device; replayed completion still needs
    valid signed proof.
  - This is self-asserted first-claim/TOFU, not genuine ESP32 attestation. A
    rogue first claimant or key/MAC clone remains possible without a hardware
    root of trust. The opt-in identity provider stores private DER in ordinary
    NVS for this MVP profile; raw flash extraction can clone it. Kconfig warns
    about this, default remains disabled, and no protected-at-rest claim is
    made. Operational credential storage remains gated/unregistered; the
    commissioning path therefore remains fail-closed before redemption can
    become an ONLINE state.
- Files changed for this increment (in addition to pre-existing WP14.38–40
  dirty files):
  - Backend: `server/api/prisma/schema.prisma`, new append-only migration
    `server/api/prisma/migrations/20261029110000_device_claim_sessions/`;
    new `device-claim.service.ts` and test; claim transcript verifier/tests;
    protected claim routes and route auth regression; package script change
    already present in the dirty worktree is retained.
  - Firmware: `commissioning_transport.c` adds bounded
    `/v1/commissioning/enrollment-proof` handler gated by the active physical
    commissioning state; `device_provisioning_payload.c/.h` adds canonical
    claim transcript and MAC-derived ID codec; identity-provider Kconfig and
    startup allow first-boot generation only when the explicit NVS provider
    option is enabled; host identity test and shared fixture updated.
  - Android: claim API calls, canonical claim transcript, proof request and
    signature/context verification, same-Store idempotent-claim UI, QR-derived
    SoftAP SSID handoff, and shared fixture/QR tests.
  - WP14 summary updated. No new report was created.
- Fresh commands/results:
  - Backend focused `npm test -- --run src/modules/provisioning/device-claim.service.test.ts src/modules/provisioning/provisioning.routes.test.ts src/modules/provisioning/provisioning-crypto.test.ts`: **PASS**, exit 0; 3 files, 13 tests, 0 failed/skipped. Includes Owner gate, invalid/expired/context-bound proof, valid completion, idempotent same-Store claim and same-session retry rejection for tampered proof, plus shared transcript fixture.
  - Backend full `npm test`: **PASS**, exit 0; 35 files passed, 2 skipped; 145 passed, 43 skipped, 0 failed.
  - `npm run typecheck`: **PASS**, exit 0.
  - `npm run build`: **PASS**, exit 0; Prisma client generation and TypeScript compile. It rewrote tracked `server/api/dist` and emitted three generated JS files. Because `server/api/dist` was clean at run entry, those generated changes were restored; only the exact three newly generated files were removed. Source changes were retained.
  - `npx prisma validate`: **PASS**, exit 0; schema valid.
  - Android `:owner:testDebugUnitTest :owner:assembleDebug --rerun-tasks`: **PASS**, exit 0; 18 passed, 0 failed/skipped. APK: `apps/android-fcm-test/owner/build/outputs/apk/debug/owner-debug.apk`, 2,370,658 bytes. First attempt failed on Java API incompatibility (`Files.readString`); replaced with `readAllBytes`, reran successfully. Earlier sandbox attempt hit Gradle cache access denied; elevated rerun executed tasks.
  - Docker C host suite, isolated `gcc:13.2.0-bookworm`, source mount read-only/network disabled: **PASS**, exit 0; 9/9 executable runners, 0 failed/skipped. Includes updated identity/claim transcript fixture in C. Two initial harness attempts failed: first omitted test include path for `sdkconfig.h`, second omitted link dependencies for event-gate/reachability; corrected full suite then passed.
  - Native C compiler unavailable (`cc` not found). ESP Clang host attempt failed because installed compiler lacks a compatible Windows host target/standard headers; this is not counted as a test pass. Docker GCC suite is the host evidence.
  - ESP-IDF 5.5.5 default `esp32s3` `idf.py build`: **PASS**, exit 0; `0xf7280 / 0x100000`, `0x8d80` bytes free (~3%). One sandbox build attempt was blocked before compile by Windows `WinError 5` subprocess pipe; elevated build completed.
  - Separate commissioning + NVS identity-provider compile profile, generated from a temporary non-secret defaults file and separate build directory: **PASS**, exit 0; `0xfa8f0 / 0x100000`, `0x5710` bytes free (~2%). This only verifies build integration; it does not enable storage in the default build or prove NVS confidentiality/durability. Temporary defaults and the known run-created profile build directory were removed after recording size. No flash command was run.
  - `git diff --check`: **PASS**, exit 0; line-ending advisory warnings only.
  - Read-only target check: `TEST_DATABASE_URL=UNSET`. PostgreSQL integration, migration deployment and DB writes were **NOT RUN**; no other database was substituted.
- Fresh vs historical: all commands above are fresh for RUN-038. RUN-037 and earlier DB/device/hardware evidence remains historical; this run did not validate PostgreSQL claim races or any physical behavior.
- Runtime and trust boundary: Android proof verification checks context and signature before sending proof to authenticated backend. SoftAP HTTP response alone does not complete claim; app waits for backend claim response. Device is not marked ONLINE from claim or Wi-Fi send. Factory-independent first key creation is enabled only when identity NVS provider is explicitly configured; existing corrupt records fail closed. Ordinary NVS does not protect identity key against flash extraction. Operational token provider is still absent and commissioning event gate remains fail-closed.
- Blockers:
  1. `TEST_DATABASE_URL` is not configured; must provide a local connection targeting only `pulselink_test` on port 5434, then review and apply the new migration without reset and run real concurrent claim tests.
  2. Operational credential storage is unavailable/unregistered; provisioning redemption cannot persist the issued token and cannot proceed to authenticated status/ONLINE/Event.
  3. First-claim TOFU lacks manufacturer/hardware root; prototype is cloneable from MAC/raw NVS and is not suitable as a high-assurance product trust identity.
  4. No COM4/board/QR/camera/SoftAP/Wi-Fi/backend runtime or reboot recovery was exercised. Button wiring and actual board revision remain unverified; commissioning profile is compile-only.
  5. Commissioning profile has 2% flash headroom; no production feature additions should be made without size review.
- Next actions:
  1. Configure and verify only `pulselink_test:5434`, deploy the reviewed claim-session migration, and add/run PostgreSQL concurrency, rollback, same-Store repeat and cross-Store isolation tests.
  2. Resolve approved operational-token storage semantics or explicitly keep the production commissioning gate closed; provide persistence/readback/revocation provider before enabling redemption.
  3. Treat the key/MAC-based first-claim as a prototype trust level; if deployed beyond controlled MVP, add physical-possession confirmation with an authenticated owner channel or protected key source, while documenting clone threat.
  4. After DB/storage readiness, verify actual board identity and GPIO/SoftAP behavior; only then authorize serial/flash and perform physical E2E plus reboot test.
- Result: `PARTIALLY COMPLETED — CLAIM SOFTWARE AND BUILD/TEST EVIDENCE PASS; DATABASE MIGRATION, OPERATIONAL STORAGE AND HARDWARE E2E NOT VERIFIED`.

## WP14-RUN-039

- Time: 2026-10-29 11:33 Asia/Saigon (UTC+07:00; 04:33 UTC).
- Git: HEAD `bae594e44532c640d1d4fe5b394095fc1da0f6fd`, branch `main`.
  Worktree was dirty on entry with WP14.38–WP14.41 changes; all were
  preserved. No reset/clean or overwrite was performed.
- Goal: complete the RUN-038 implementation path for operational-token
  persistence and post-reboot authenticated ONLINE recovery, without claiming
  protected-at-rest storage or physical E2E.
- Source findings and changes made in this run:
  - `firmware/esp32/main/esp_device_credential_storage.c/.h`,
    `commissioning_credential_storage.c/.h`, `main.c`, Kconfig and the
    commissioning MVP profile now wire an opt-in NVS operational credential
    adapter into firmware startup. Save commits and reads back a versioned,
    format-checked token record; load errors clear caller output. The profile
    uses ordinary NVS. This gives persistence plumbing only; flash extraction
    can disclose both token and identity key. No encryption or protected
    storage claim is made.
  - `firmware/esp32/main/esp_device_identity_provider.c` now writes a durable
    initialization marker in the same NVS transaction as a newly generated
    identity. If the key record is missing while the marker remains, load
    reports corruption so the boot path does not silently regenerate the key.
    Temporary DER, hash and public-key encoding buffers are cleared after use.
  - `commissioning_state.c/.h`, `commissioning_wifi_controller.c/.h`,
    `commissioning_backend_reachability.c`,
    `commissioning_backend_reachability_http.c` and `main.c` implement bounded
    boot recovery: station configuration is read back from ESP-IDF Wi-Fi
    storage, the operational token is loaded from its provider, and an
    authenticated HTTPS `/v1/device-status` probe is retried after transient
    network/server failures. A station disconnect during recovery keeps the
    recovery lifecycle active for the runtime reconnect task. Generation
    checks prevent stale results. The optional expected Device key is now
    represented explicitly; the reboot path validates the authenticated
    Device ID and the returned enrollment/provisioning state without formatting
    a null key pointer or comparing against an empty string. Only an accepted
    status response can set ONLINE.
  - `commissioning_state_test.c`, `commissioning_wifi_controller_test.c`,
    `commissioning_backend_reachability_test.c` and
    `device_identity_test.c` cover bounded recovery expiry, recovery through a
    disconnect/transient backend error, authenticated-success gating, auth
    failure and no key regeneration on corrupt identity. Host tests exercise
    pure logic and NVS shim behavior only.
  - Backend changes from this increment include
    `server/api/src/modules/provisioning/device-claim.service.ts` and its test
    (hash the same single token that is returned), PostgreSQL claim/race tests
    and the reviewed append-only migration
    `server/api/prisma/migrations/20261029110000_device_claim_sessions/`.
    `docs/development/firmware-build.md` documents the ordinary-NVS limit.
    The summary report at `docs/audits/wp14-9-end-to-end-commissioning-report.md`
    was updated; this log entry is appended.
- Fresh command results for this run:
  - Backend focused provisioning tests: **PASS**, exit 0; 3 files / 11 tests.
  - Backend full `npm test`: **PASS**, exit 0; 35 files passed, 2 skipped;
    145 passed, 43 skipped, 0 failed.
  - `npm run typecheck`: **PASS**, exit 0.
  - `npm run build`: **PASS**, exit 0; generated Prisma client and TypeScript
    build. Generated `dist` outputs were restored because `dist` was clean at
    entry; source was retained.
  - `npx prisma validate`: **PASS**, exit 0.
  - PostgreSQL target was verified read-only as loopback host port `5434`,
    database `pulselink_test`; the local Docker mapping reaches PostgreSQL's
    container port. Before migration: 12 migrations applied, 0 pending. The
    first deploy attempt used a process without loaded test environment and
    the Prisma schema engine failed to spawn with `EPERM` before connection or
    write. A later reviewed deploy used a process-local URL validated to the
    test target only: migration `20261029110000_device_claim_sessions` applied
    successfully. PostgreSQL integration suite: **PASS**, exit 0; 1 file / 43
    tests passed, 0 failed/skipped. The suite cleaned up its own fixture rows.
    No reset, development database write, production/staging access or
    migration-history edit occurred.
  - Docker C host suite: **PASS**, exit 0; 10/10 executable runners, 0 failed
    or skipped; assertion-level count is not emitted. One sandbox invocation
    was denied by Docker Desktop pipe access. The first elevated harness had a
    quoting error; a subsequent harness run exposed a missing event-gate link
    dependency and its non-fail-fast wrapper was discarded. A later strict
    `set -eu` run caught an incorrect state-test assertion; after correction,
    another strict run caught a signedness warning; after correcting the test
    variable type, the complete 10-runner suite passed. None of those failed
    invocations is counted as passing evidence.
  - ESP-IDF `v5.5.5`, target `esp32s3`, default profile: **PASS**, exit 0;
    app image `0xf72d0 / 0x100000`, free `0x8d30` (3%). The sandbox build was
    blocked before compilation by `WinError 5` creating Ninja subprocess
    pipes; elevated single-job build completed.
  - ESP-IDF commissioning MVP profile (`build/commissioning-mvp`, ordinary
    NVS provider enabled, NVS Encryption disabled): **PASS**, exit 0 after
    fixing a missing `device_provisioning_payload.h` include found by the
    first profile compile. Final image `0xfb560 / 0x100000`, free `0x4aa0`
    (2%); ESP-IDF reports the app partition nearly full. This is build
    evidence only; profile must not be treated as approval to flash.
  - `git diff --check`: **PASS**, exit 0 after report/log edits. Git emitted
    line-ending advisories (LF will be converted to CRLF); these are not
    whitespace errors.
  - Android `:owner:testDebugUnitTest :owner:assembleDebug --rerun-tasks`:
    **PASS**, exit 0; 38 tasks executed; 18 JVM tests passed, 0 failed,
    0 skipped. Debug APK `apps/android-fcm-test/owner/build/outputs/apk/debug/owner-debug.apk`:
    2,370,658 bytes. The first sandbox run failed before Gradle execution on
    wrapper-cache lock access (`Access is denied`); the elevated rerun passed.
- Fresh versus historical: RUN-039 backend, PostgreSQL, host C, Android and
  both firmware profile results above are new. Physical board, phone,
  actual SoftAP/Wi-Fi association, TLS runtime, operational-token reboot
  persistence and Device Event delivery are **NOT VERIFIED** in this run.
- Security decisions: no TLS verification bypass, build-time operational
  token fallback, hardcoded key, eFuse write, Secure Boot, Flash Encryption,
  NVS Encryption, board flash/reset/erase, serial port open, real FCM/email or
  production/staging database operation occurred. Ordinary NVS remains
  readable from raw flash; TOFU identity is clonable and the operational
  token is not protected at rest. The provider opt-in does not change that
  threat boundary.
- Blockers:
  1. Verify identity marker behavior, NVS commit/recovery and stable identity
     on the actual ESP32-S3 through an approved board test; host tests/build
     cannot prove reboot or power-loss durability.
  2. Ordinary NVS exposes identity private key and operational token to raw
     flash extraction. This is accepted only as an explicitly limited MVP
     persistence profile, not secure-at-rest storage.
  3. No physical proof for target board revision/button mapping, SoftAP,
     phone handoff, station join, TLS/backend status, ONLINE, Event ACK or
     reboot recovery. Commissioning image has 2% partition headroom.
- Next actions:
  1. On an authorized ESP32-S3 unit, verify first-boot identity creation,
     repeated reboot stability, missing/corrupt identity fail-closed, token
     save/read-back and token recovery after reboot; capture only redacted
     status evidence.
  2. Perform the approved Owner → Store → QR claim → SoftAP → Wi-Fi → redeem
     → authenticated status → Device Event test, including stable event retry
     and database verification on a test/development target explicitly
     approved for writes.
  3. Revisit partition budget before adding firmware features; commissioning
     profile has only `0x4aa0` bytes free.
- Result: `PARTIALLY COMPLETED — BACKEND/POSTGRES, C HOST AND FIRMWARE BUILDS
  PASS; NVS SECURITY ASSUMPTIONS AND PHYSICAL E2E NOT VERIFIED`.

## WP14-RUN-040 — Staging firmware profile and Owner push-notification wiring

- Time: 2026-10-29 12:33:51 +07:00 (Asia/Saigon).
- Git: HEAD `b624d191dcf90cf99fcbd4ad660a550cb1eb9503`, branch `main`.
  Worktree was clean at entry; this run changed the files listed below.
- Goal: prepare a buildable ESP32-S3 staging image, connect the Owner app to
  the existing FCM installation contract, and verify the available software
  path toward button-event notifications without writing staging business data.
- Source/configuration findings: Owner's local Google Services configuration
  includes `com.pulselink.owner`, but Owner previously had no Firebase
  Messaging dependency, authenticated installation registration, receiver or
  notification permission. FCM code existed in the separate diagnostic app.
  Backend already exposes authenticated `POST /v1/installations/` and
  `DELETE /v1/installations/:installationId`; the event worker emits `eventId`
  and `eventType` data. Repository default `NOTIFICATION_RECIPIENT_MODE` is
  `legacy`, so staging must explicitly use `account` for Owner installations.
  Firmware's checked-in defaults left both endpoints and event GPIO unset;
  commissioning already used GPIO4 active-low with pull-up. Provider is
  ordinary NVS and does not protect identity/token against raw-flash extraction.
- Files changed:
  - `firmware/esp32/sdkconfig.staging.defaults` (new): staging HTTPS origins,
    commissioning and event GPIO4, certificate bundle, ordinary-NVS profile,
    size optimization; no credentials or Wi-Fi configuration.
  - `firmware/esp32/main/Kconfig.projbuild`: align GPIO4 help with the approved
    MVP decision while retaining the requirement to verify wiring before flash.
  - `docs/development/firmware-build.md`: isolated staging build command and
    security/notification-mode caveats.
  - `apps/android-fcm-test/owner/build.gradle.kts`, `AndroidManifest.xml`:
    Firebase Messaging, conditional Google Services plugin, notification
    permission and non-exported FCM service.
  - Owner `ApiClient.java`, `InstallationRegistration.java` (new),
    `OwnerPushRegistration.java` (new), `SecureSession.java`, `MainActivity.java`,
    `OwnerMessagingService.java` (new): authenticated token registration,
    access-token refresh on 401, encrypted local token/session storage,
    revocation on sign-out, token refresh handling and safe event notification.
  - `apps/android-fcm-test/owner/src/test/.../ApiClientTest.java`: registration
    payload/validation coverage using a JVM-testable value object.
  - `scripts/Test-CommissioningReadiness.ps1`: selectable sdkconfig path,
    approved public development host passed to firmware endpoint checks, and
    accurate ordinary-NVS blocker detail.
  - `firmware/esp32/tests/run_host_tests.sh` (new), tests README: reproducible
    read-only 10-runner C host harness.
  - This log and `docs/audits/wp14-9-end-to-end-commissioning-report.md`.
- Fresh commands/results:
  - `git status --short`, `git rev-parse HEAD`, `git branch --show-current`:
    PASS; clean entry, HEAD/branch as above.
  - `.\gradlew.bat :owner:testDebugUnitTest :owner:assembleDebug --rerun-tasks`:
    first run FAIL (exit 1), 20 tests/1 failure because Android's JVM stub
    `org.json.JSONObject.getString()` did not provide runtime JSON behavior.
    Replaced the test seam with a plain registration value object; rerun PASS
    (exit 0), 20 passed, 0 failed, 0 skipped. APK:
    `apps/android-fcm-test/owner/build/outputs/apk/debug/owner-debug.apk`,
    3,966,318 bytes. Gradle required elevated access to its existing user cache.
  - ESP-IDF first invocation FAIL (exit 1): CMake absent from PATH. Second
    invocation FAIL before compile: Xtensa compiler absent from PATH. Third
    compile used the installed toolchain but debug optimization produced
    `0x102080`, exceeding the unchanged `0x100000` app partition by `0x2080`.
    Added size optimization to staging only, then ran isolated
    `idf.py ... fullclean set-target esp32s3 build` and final
    `idf.py ... build` with ESP-IDF 5.5.5, CMake 3.30.2, Ninja 1.12.1,
    installed Xtensa/RISC-V toolchain and `NINJAFLAGS=-j1`: PASS (exit 0).
    Final `build/staging/pulselink_firmware.bin`: `0xebc80` bytes;
    `0x14380` bytes free in `0x100000`. ESP-IDF printed a missing
    `ESP_ROM_ELF_DIR` gdbinit warning, but compilation/link/partition check
    completed successfully. No partition or security setting was weakened.
  - `docker run --rm --network none --read-only --tmpfs
    /tmp:rw,exec,nosuid,size=128m --mount type=bind,src=D:/project-PulseLink,
    dst=/src,readonly --workdir /src/firmware/esp32 gcc:13.2.0-bookworm
    sh tests/run_host_tests.sh`: PASS (exit 0), 10 runners passed, 0 failed,
    0 skipped. Docker required elevated access to its engine pipe.
  - Staging preflight with `-ProbeBackend`, the explicitly approved host,
    `-FirmwareSdkconfigPath firmware/esp32/build/staging/sdkconfig`, and
    `-CheckTestDatabase` omitted: final **18 PASS, 0 FAIL, 1 BLOCKED,
    2 SKIPPED**, exit 1 by design. `/health/live` and `/health/ready` each
    passed HTTPS certificate/hostname validation; only GET requests were sent.
    The BLOCKED item is extractable ordinary-NVS identity/operational token;
    SKIPPED items are database target and API origin runtime probing. An early
    sandbox attempt had two health probe failures; an elevated retry passed
    `/health/ready` but timed out on `/health/live`; final rerun passed both.
    Fixed preflight initially rejected the explicitly approved firmware host;
    after passing `ApprovedPublicDevelopmentHost` into that check, both staging
    endpoint checks passed. No DB URL was loaded or database queried.
  - `adb devices -l`, `adb shell getprop`, package lookup: one authorized
    Android API 35 handset; Owner was initially absent. `adb install
    apps/android-fcm-test/owner/build/outputs/apk/debug/owner-debug.apk`:
    PASS (`Success`). `adb shell monkey -p com.pulselink.owner 1`: PASS,
    activity launched and process observed. No account credentials were
    entered. A Windows `Win32_SerialPort` query returned no rows; preflight
    enumerated one serial interface without opening it, but did not prove that
    it is COM4 or identify the ESP32 board/revision.
  - `git diff --check`: PASS (exit 0); Git reported LF-to-CRLF advisories.
  - `git status --short` / final artifact size checks: PASS; generated staging
    image and APK exist at paths above. Build output remains under ignored
    `firmware/esp32/build/staging`.
- Fresh vs historical evidence: all results listed above are fresh for
  RUN-040. RUN-039 backend/DB tests, migration and earlier firmware profiles
  remain historical; backend source was unchanged and its suites were not
  rerun. The user reports staging migration/deployment; this run only confirmed
  the read-only readiness endpoint, not migration version or business APIs.
- Errors and resolution: JVM JSON-stub assertion replaced by a pure DTO test;
  missing CMake/toolchain PATH corrected using already-installed ESP-IDF tools;
  stale isolated sdkconfig was regenerated in the run-created staging build
  directory so size optimization took effect; firmware fit the existing
  partition. Preflight host allow-list propagation was corrected and rerun.
- Security decisions: no credential or Wi-Fi password entered into command,
  source or report; no staging sign-up/store/device writes; no FCM/email send;
  no DB operation; no COM port open, board reset/flash/erase or eFuse/security
  provisioning. TLS validation remains enabled. MVP staging image intentionally
  uses ordinary NVS; its key/token material is not confidential at rest.
- Open blockers:
  1. Actual Owner push requires deployed staging `NOTIFICATION_RECIPIENT_MODE`
     set to `account`, valid server-side FCM sender configuration and an active
     notification worker. The repository default remains `legacy`; remote
     runtime configuration was not inspected or changed.
  2. No account sign-up/email verification, Store creation, Device claim,
     provisioning, Wi-Fi transfer, redemption, ONLINE status, event or push was
     executed. No user credentials were available/entered and staging writes
     were intentionally avoided.
  3. COM4/board model/revision and a recovery path are unverified. No serial
     port was opened and no firmware was flashed.
  4. Ordinary NVS allows raw-flash extraction of identity private key and
     operational credential; this is not protected-at-rest evidence.
  5. No actual button press, backend Event commit/ACK, reboot recovery or FCM
     receipt has been verified on hardware.
- Next actions:
  1. Confirm staging backend uses account recipients and its FCM sender/worker
     is healthy; then complete account verification and link a test Store/board.
  2. Identify COM4's USB VID/PID and visually confirm the ESP32-S3 board and
     recovery procedure before any serial or flash operation.
  3. Flash only after board/recovery confirmation; use the staging binary and
     test Wi-Fi entered interactively in Owner app; verify enrollment, redemption,
     authenticated status, event ACK and push end-to-end.
  4. Reboot and confirm identity/token recovery; document the accepted ordinary
     NVS exposure or adopt an approved protected-storage policy before wider use.
- Result: `PARTIALLY COMPLETED — STAGING BUILD AND OWNER APP READY; PHYSICAL
  COMMISSIONING AND PUSH DELIVERY NOT VERIFIED`.

### WP14-RUN-040 append-only verification addendum

- After the RUN-040 entry was appended, `OwnerPushRegistration` gained a
  session equality guard so a delayed access-token refresh cannot restore an
  Owner session after sign-out. Android tests/build were rerun against that
  final source: **PASS**, exit 0; 20 passed, 0 failed, 0 skipped. Final APK
  remains 3,966,318 bytes.
- The previously built APK had installed and launched on the API 35 phone.
  An update install of the final rebuilt APK was attempted with
  `adb install -r .../owner-debug.apk`, but Android returned
  `INSTALL_FAILED_USER_RESTRICTED: Install canceled by user`; therefore the
  final APK is built but **not confirmed installed**. The previously installed
  app process remained running. No attempt was made to bypass the phone's
  installation restriction.
- Final preflight was rerun against the final APK and staging sdkconfig with
  only the approved health GETs: **18 PASS, 0 FAIL, 1 BLOCKED, 2 SKIPPED**,
  exit 1 by design. `/health/live` and `/health/ready` both passed. The single
  blocker remains ordinary-NVS extractability; database and runtime API-origin
  checks remain skipped.
- No account/API writes, database access, real FCM send, serial open or board
  operation occurred after the original RUN-040 entry. This addendum corrects
  the install-state detail without changing prior run history.

### WP14-RUN-040 append-only staging flash verification addendum

- Time: 2026-10-29 12:48 +07:00 (Asia/Saigon). HEAD at continuation:
  `02aed7aa9427086e5a42242ae58745ce6f31cea4`, branch `main`; the pre-existing
  worktree contained only the staging flash-size configuration and build-doc
  changes. No reset/clean/checkout was performed.
- Goal: verify and, within the earlier hardware authorization, deploy the
  staging image to the attached ESP32-S3 while preserving NVS and eFuses.
- Fresh board evidence: read-only `esptool flash_id` identified ESP32-S3
  QFN56 rev 0.2, 8 MiB PSRAM, and 16 MiB flash. The output's hardware address
  is intentionally omitted. Because the profile was configured for a 2 MiB
  flash header, updated `firmware/esp32/sdkconfig.staging.defaults` to select
  the 16 MiB flash header and updated `docs/development/firmware-build.md`.
  No partition offsets/layout or security settings were changed.
- Fresh firmware build: isolated ESP-IDF 5.5.5 staging `fullclean set-target
  esp32s3 build` completed with exit 0 (single Ninja job). Image is
  `firmware/esp32/build/staging/pulselink_firmware.bin`, 965,760 bytes
  (`0xebc80`); app partition remains `0x100000`, leaving `0x14380` bytes
  (about 8%). The flash argument now specifies 16 MiB.
- Flash command outcome: the elevated `idf.py flash` launch completed, but its
  large output was not retained by the tool result, so its own exit code is
  unavailable. Fresh read-back verification provides direct evidence instead:
  `python -m esptool --chip esp32s3 --port COM4 --baud 115200 --before
  default_reset --after hard_reset verify_flash 0x0
  build/staging/bootloader/bootloader.bin 0x8000
  build/staging/partition_table/partition-table.bin 0x10000
  build/staging/pulselink_firmware.bin` exited 0; bootloader (0x5160 bytes),
  partition table (0xc00 bytes), and app (0xebc80 bytes) each reported
  `verify OK (digest matched)`. This confirms those artifacts are on flash.
  The esptool hard-reset the board via RTS after verification.
- An attempted `idf.py ... verify-flash` exited 1 because ESP-IDF 5.5.5 has no
  such idf.py/Ninja target; it did not access the serial port or write flash.
  Replaced it with the documented esptool `verify_flash` command above.
- Physical scope: no full-chip erase, NVS write/erase, eFuse write, flash
  security change, account/store/device API write, database operation or FCM/
  email send occurred. Flash verification does **not** prove boot/runtime,
  SoftAP, Wi-Fi association, redemption, ONLINE, Device Event, push receipt or
  reboot persistence. Ordinary NVS still exposes identity and token material
  to raw-flash extraction.
- `NOTIFICATION_RECIPIENT_MODE=account` is reported by the Owner as configured
  on staging; this run did not inspect remote runtime configuration or send a
  push. Server-side FCM credentials and worker delivery remain unverified.
- Final status: `PARTIALLY COMPLETED — STAGING IMAGE READ-BACK VERIFIED;
  COMMISSIONING/NOTIFICATION E2E NOT VERIFIED`. Next: confirm/install the final
  Owner APK on the phone (the user's prior install-update prompt was canceled),
  sign in with a verified test account, claim the board in a test Store,
  perform the physical-button SoftAP flow with test Wi-Fi, then verify ONLINE,
  a GPIO4 event commit/ACK and push receipt. Reboot recovery and NVS exposure
  remain explicit acceptance checks/limitations.

## WP14-RUN-041 — Owner claim usability and SoftAP commissioning window

- Time: 2026-10-29 13:13 +07:00 (Asia/Saigon).
- Git: HEAD `02aed7aa9427086e5a42242ae58745ce6f31cea4`, branch `main`.
  At start, worktree contained the two RUN-040 staging-profile changes. Those
  were preserved; no reset/clean/checkout was run.
- Goal: resolve the Owner-to-board linking/setup friction reported during real
  app use, verify the relevant implementation, and deploy the fix to the same
  previously identified COM4 ESP32-S3.
- Source finding: the app's Claim button previously required a Device ID
  obtained only by QR scan, although the board had no confirmed printed QR.
  Firmware also used the physical-confirmation 30-second timeout as the whole
  commissioning lifecycle deadline, so the SoftAP could close while the app
  was creating the claim session, accepting Android's Wi-Fi prompt and fetching
  board proof.
- Files changed:
  - `firmware/esp32/main/commissioning_state.h`: named bounded five-minute
    pairing lifecycle window.
  - `firmware/esp32/main/main.c`: keep GPIO4 physical confirmation bounded by
    its existing 30-second gate, but let the opened SoftAP/lifecycle remain
    available for up to five minutes from commissioning start.
  - `firmware/esp32/tests/commissioning_state_test.c`: regression coverage for
    SoftAP surviving the first 30 seconds but expiring at the five-minute cap.
  - Owner `DeviceQrIdentity.java`, `MainActivity.java`, and
    `DeviceQrIdentityTest.java`: allow typing a public Device ID when there is
    no QR label; retain QR parsing, Store authorization and live board
    signature proof. Added visible button/SoftAP timing instructions.
  - `docs/development/firmware-build.md`: document the physical gate, pairing
    window and Owner claim/configuration steps.
  - This log and `docs/audits/wp14-9-end-to-end-commissioning-report.md`.
- Fresh commands/results:
  - Docker host suite:
    `docker run --rm --network none --read-only --tmpfs
    /tmp:rw,exec,nosuid,size=128m --mount type=bind,src=D:/project-PulseLink,
    dst=/src,readonly --workdir /src/firmware/esp32 gcc:13.2.0-bookworm sh
    tests/run_host_tests.sh`: **PASS**, exit 0; 10 runners passed, 0 failed,
    0 skipped.
  - Android initial sandbox invocation failed before Gradle due access denied
    on the existing wrapper lock; elevated rerun
    `.\gradlew.bat :owner:testDebugUnitTest :owner:assembleDebug --rerun-tasks`
    **PASS**, exit 0; 21 tests, 0 failures/errors, 0 skipped. APK:
    `apps/android-fcm-test/owner/build/outputs/apk/debug/owner-debug.apk`,
    3,966,318 bytes.
  - ESP-IDF initial sandbox invocation failed before compilation with
    `WinError 5` when creating Ninja pipes; elevated ESP-IDF 5.5.5 single-job
    staging build **PASS**, exit 0. App image `0xebc90` bytes; partition
    `0x100000`; free `0x14370` bytes (~8%).
  - `esptool write_flash` to COM4, restricted to bootloader at `0x0`, partition
    table at `0x8000`, and app at `0x10000`: **PASS**, exit 0; each region's
    write hash verified. NVS region was not included; no whole-chip erase.
  - `esptool verify_flash` for those same three artifacts: **PASS**, exit 0;
    all three reported digest match. esptool reset the board through RTS.
  - `adb install -r .../owner-debug.apk`: **PASS**, `Success`.
    `adb shell monkey -p com.pulselink.owner 1`: **PASS**, one launch event
    injected; `pm path` confirmed the package installed.
  - `git diff --check`: **PASS**, exit 0; Git emitted only LF/CRLF advisories.
- Fresh vs historical: build, host tests, Android tests/APK, physical flash
  write/read-back and APK install/launch above are fresh RUN-041 evidence.
  The user reports SignUp, SignIn and Store creation already work in actual
  app use; that is user-reported runtime evidence, not independently observed
  in this run. No Device claim/proof, SoftAP association, Wi-Fi credential
  transfer, station IP, redemption, authenticated ONLINE, Device Event, ACK,
  push receipt or reboot recovery was exercised.
- Failures and resolution: the non-elevated Gradle and Ninja subprocess
  launches were denied by Windows before running tests/compilation; elevated
  reruns succeeded. No tests were skipped or weakened.
- Security/side effects: the entered Device ID is public identity only; Store
  authorization and board PoP remain mandatory. The five-minute timer bounds
  an already physically opened pairing window; GPIO4 still must be held for
  1.5 seconds within 30 seconds after boot. No staging business API, DB,
  notification, email, eFuse, security-fuse or NVS operation was performed.
  Flash wrote only the verified bootloader/partition/app ranges. Ordinary NVS
  identity/token data remains extractable at rest.
- Open blockers/next actions:
  1. Use the installed Owner APK, staging API origin, and target Store ID.
     Enter the board's public Device ID (or scan a QR with that same value).
  2. Power-cycle the board; within the first 30 seconds hold GPIO4 for at
     least 1.5 seconds, then release. Confirm the `PulseLink-XXXX` SoftAP and
     accept Android's connection prompt while the five-minute window is open.
  3. Tap Claim Device; backend must confirm proof before it is Store-linked.
     If it is already linked to this Store, tap Create provisioning session.
     If linked elsewhere, a transfer is not supported by this claim flow.
  4. Enter the test 2.4-GHz Wi-Fi in app and send the encrypted configuration;
     verify backend ONLINE, press GPIO4 for an Event and confirm commit/ACK and
     FCM delivery. Remote FCM worker/sender configuration remains unverified.
- Result: `PARTIALLY COMPLETED — CLAIM/PAIRING FIX BUILT AND DEPLOYED;
  STORE LINK, WI-FI AND EVENT/PUSH E2E NOT YET VERIFIED`.

### WP14-RUN-041 side-effect accounting correction

- On review, launching `MainActivity` calls `restoreSession()`, which may
  asynchronously register the saved FCM installation token through the
  existing authenticated `POST /v1/installations/` contract when a session is
  present. The network response was not captured, so this run cannot assert
  that no staging write occurred. No sign-up, Store creation, Device claim,
  provisioning, button Event or FCM message send was intentionally triggered.
  This supersedes the broad “no staging business API” wording above; no source
  or test result is affected.

## WP14-RUN-042 — Independent RUN-041 GPIO4 and E2E readiness audit

- Time: 2026-10-29 13:38 +07:00 (Asia/Saigon).
- Git: HEAD `02aed7aa9427086e5a42242ae58745ce6f31cea4`, branch `main`.
  Worktree was dirty at start with RUN-040/041 source, config and docs edits;
  all were preserved. RUN-042 changed the WP14.9 summary, this log, the new
  independent audit report and `docs/.gitignore` to unignore that report (new
  files in this directory are otherwise excluded by default).
- Goal: independently verify RUN-041 claims, especially whether the GPIO4
  long-press commissioning instruction conflicts with ordinary button Events;
  do not perform physical commissioning or staging writes.
- Source review: `main.c`, `physical_confirmation.c/.h`,
  `commissioning_state.h`, Kconfig/staging defaults, Owner `MainActivity`,
  `ApiClient`, `SoftApConnection`, backend claim/status/event services/routes,
  relevant tests and RUN-041 report/log.
- Finding (high confidence from source/config): staging sets both
  `CONFIG_PULSELINK_COMMISSIONING_BUTTON_GPIO=4` and
  `CONFIG_PULSELINK_BUTTON_GPIO=4`. Both are input/pull-up configurations;
  source interprets low as pressed. Ordinary `button_task()` enqueues and
  persists a Device Event after 50 ms stable press, without checking
  commissioning state. The sender waits until `COMMISSIONING_ONLINE`, but
  does not remove the pending Event. Physical confirmation accepts only after
  debounced release following a hold of at least 1.5 seconds. Therefore the
  recommended commissioning gesture can enqueue a normal Event which may be
  delivered after ONLINE. No arbitration or suppression exists. The physical
  board wiring is not independently proven; a source comment says button to
  GND is verified, but this audit found no schematic/runtime evidence.
- Timing: physical-confirmation and five-minute pairing deadlines both begin
  when `commissioning_gate_task()` starts after `wifi_start()`. The five-minute
  lifecycle deadline is not restarted on button press; the press window is
  30 seconds from gate-task start. Exact timing from physical boot is not
  runtime verified.
- Fresh commands/results:
  - Read-only source/config/status/diff review and artifact hash calculations:
    completed; no hardware port was opened.
  - Docker C host suite:
    `docker run --rm --network none --read-only --tmpfs
    /tmp:rw,exec,nosuid,size=128m --mount type=bind,src=D:/project-PulseLink,
    dst=/src,readonly --workdir /src/firmware/esp32
    gcc:13.2.0-bookworm sh tests/run_host_tests.sh` — **PASS**, exit 0;
    10 runners passed, 0 failed, 0 skipped.
  - Android:
    `./gradlew.bat :owner:testDebugUnitTest :owner:assembleDebug
    --rerun-tasks` — **PASS**, exit 0; 21 tests, 0 failures/errors/skipped;
    41 actionable Gradle tasks; APK 3,966,318 bytes.
  - ESP-IDF 5.5.5 ESP32-S3 staging profile, single-job build — **PASS**,
    exit 0; app image `0xebc90` (965,776 bytes), app partition `0x100000`,
    free `0x14370` (82,800 bytes, ~7.9%). Current local app SHA-256 is
    `B02CD0146058D00F974DF9C177D6AB00F28ADF5BD0AB1793DAB71A6FF77F68F4`.
  - Focused backend:
    `npm test -- --run src/modules/provisioning src/modules/device-status
    src/modules/device-events` — initial sandbox attempt failed before test
    load (`spawn EPERM`); elevated retry **PASS**, exit 0; 10 files, 48 tests
    passed. No PostgreSQL/staging API request.
  - `git diff --check` — **PASS**, exit 0; only LF/CRLF advisories.
- Artifact/flash evidence: current local bootloader, partition and app hashes
  were computed and recorded in the independent report. Historical RUN-041 log
  reports successful `write_flash` and `verify_flash` with digest match for
  bootloader, partition and app at offsets 0x0/0x8000/0x10000. RUN-042 did not
  flash or read the board; no separate retained readback image/hash allows an
  independent board-to-current-artifact comparison. Thus RUN-041 tool-reported
  flash/readback remains historical, not fresh runtime evidence.
- Android/backend contract review: public Device ID/QR is not proof;
  authenticated OWNER claim plus board proof is required. Same-Store claimed
  device may continue through separate provisioning-session action; cross-Store
  transfer is rejected. Android uses Android 10+ `WifiNetworkSpecifier` and
  expected `PulseLink-XXXX` SSID as discovery only. Backend status is
  bearer-authenticated and read-only; authenticated Event transaction updates
  backend ONLINE/last-seen and creates notification intent before ACK. No
  contract request was sent in RUN-042.
- Failures: backend test sandbox launch was blocked with `spawn EPERM`; elevated
  retry ran successfully. `git diff --check` emitted expected line-ending
  advisories, with exit 0. No tests were weakened.
- Security/side effects: no COM4/serial access, flash/reset/erase, eFuse or
  security configuration change, claim, Wi-Fi transfer, provisioning session,
  Device Event, API call, database write, notification, FCM or email. Ordinary
  NVS is configured and `CONFIG_NVS_ENCRYPTION=n`; no at-rest protection is
  claimed. Secrets were not recorded.
- Open blockers/next actions:
  1. Do not use GPIO4 for commissioning until an approved/verified separate
     input is available or reviewed software arbitration suppresses the press
     Event at enqueue time. Sender-only gating is insufficient.
  2. Verify carrier-board GPIO4 wiring from schematic/revision evidence.
  3. Add host tests for short press, commissioning long press, release,
     cancellation/expiry, boot-held input, debounce and queue contents when
     the behavior change is approved; rerun host suite/build.
  4. Separately authorize a safe board identification/readback procedure before
     physical E2E; current RUN-041 flash report is historical.
  5. Then verify actual Owner claim, SoftAP, Wi-Fi, redemption, authenticated
     status, Event commit/ACK, notification and reboot recovery without logging
     credentials.
- Files changed in RUN-042: `docs/audits/wp14-10-run-041-independent-audit.md`
  (new audit); `docs/audits/wp14-9-end-to-end-commissioning-report.md`
  (current summary supersession); `docs/audits/wp14-engineering-log.md`
  (this append-only entry); `docs/.gitignore` (allowlist only this requested
  audit report).
- Result: `PARTIALLY COMPLETED`; GPIO4 physical commissioning action is
  `BLOCKED`; physical E2E is `NOT VERIFIED`.

## WP14-RUN-043 — GPIO4/GPIO5 button separation and commissioning validation

- Time: 2026-10-29 14:04 +07:00 (Asia/Saigon).
- Git: HEAD `02aed7aa9427086e5a42242ae58745ce6f31cea4`, branch `main`.
  Worktree was already dirty with prior RUN-040/041/042 changes. All were
  preserved. No staging DB/API action or board write was performed.
- Goal: remove Event/commissioning button conflict using approved GPIO4 Event
  and GPIO5 commissioning mapping; add deterministic regression tests; validate
  software/build and assess safe physical E2E readiness.
- Files changed:
  - `firmware/esp32/main/event_button.c/.h`: isolated Event-button debounce
    state and GPIO assignment validation.
  - `firmware/esp32/main/physical_confirmation.c/.h`: initialize from current
    input level and document active-low as an assumption, not proven wiring.
  - `firmware/esp32/main/main.c`: use distinct inputs, add compile/runtime
    duplicate guards and prevent held-at-gate-start input from confirming.
  - `firmware/esp32/main/CMakeLists.txt`, `Kconfig.projbuild`,
    `firmware/esp32/sdkconfig.staging.defaults`: register module and assign
    Event=GPIO4, Commissioning=GPIO5.
  - `firmware/esp32/tests/event_button_test.c`, `tests/run_host_tests.sh`:
    add 11 deterministic assertions/cases and runner; update total runners 10→11.
  - Owner `MainActivity.java`: distinguish physical buttons in commissioning
    prompt.
  - `docs/development/firmware-build.md`: correct button/deadline guidance and
    state physical wiring caveat.
  - `docs/.gitignore`: allowlist requested RUN-043 report.
  - WP14.9 summary, this append-only log and
    `wp14-11-gpio-arbitration-and-e2e-report.md`.
- GPIO/source review: repository search found no existing GPIO5 peripheral
  mapping in firmware or a board schematic. Effective isolated staging
  sdkconfig confirms Event GPIO4 and Commissioning GPIO5. Both are configured
  active-low inputs with pull-up by firmware. No source-level fixed SPI/UART/
  I2C/JTAG/LED use of GPIO5 was found. Carrier schematic, GPIO exposure and
  actual wiring remain unverified. COM4 enumerated, but no serial device was
  opened and no VID/PID/board identity was established.
- Fresh commands/results:
  - Initial sandbox Docker host invocation: **FAIL/BLOCKED**, exit 1 before
    suite start, Docker Desktop engine pipe access denied.
  - First elevated host suite: reached tests; **FAIL**, exit 1 at expiry test
    assertion because the harness had not invoked the separate lifecycle
    expiry transition. Test harness was corrected to mirror production.
  - Second elevated host suite: all 11 runners printed PASS, then **FAIL**,
    exit 1 because runner total still expected 10. Count corrected to 11.
  - Final Docker host suite command:
    `docker run --rm --network none --read-only --tmpfs
    /tmp:rw,exec,nosuid,size=128m --mount type=bind,src=D:/project-PulseLink,
    dst=/src,readonly --workdir /src/firmware/esp32
    gcc:13.2.0-bookworm sh tests/run_host_tests.sh` — **PASS**, exit 0;
    11 runners passed, 0 failed, 0 skipped.
  - Initial ESP-IDF invocation failed before CMake because CMake was absent from
    PATH. Retry with CMake/Ninja discovered locally failed before compilation
    because Windows subprocess pipe access was denied; elevated run used the
    old persisted staging sdkconfig and the new compile guard correctly failed
    because that generated config still assigned both functions to GPIO4.
    Existing build/sdkconfig was preserved.
  - First isolated staging build failed because the installed Xtensa toolchain
    was not in PATH. Corrected ESP-IDF 5.5.5 command used the installed IDF
    Python environment, CMake 3.30.2, Ninja 1.12.1, Xtensa GCC 14.2.0, one
    Ninja job, build dir `build/staging-run043`, and explicit defaults
    `sdkconfig.defaults;sdkconfig.commissioning-mvp.defaults;sdkconfig.staging.defaults`:
    **PASS**, exit 0, target `esp32s3`. Non-fatal `ESP_ROM_ELF_DIR` gdbinit
    warning observed. Image `0xebdd0` / 966,096 bytes; partition `0x100000`,
    free `0x14230` / 82,480 bytes (~7.9%). Firmware SHA-256
    `992E372B00811E4A1165F8E8E61485AFE5776CCF1CD351673D222531A2359E31`.
  - Android initial Gradle call failed before tests due wrapper-lock access
    denied. Elevated `.\gradlew.bat :owner:testDebugUnitTest
    :owner:assembleDebug --rerun-tasks` — **PASS**, exit 0; 41 tasks executed,
    21 tests passed, 0 failed/errors/skipped. APK
    `apps/android-fcm-test/owner/build/outputs/apk/debug/owner-debug.apk`,
    3,966,318 bytes, SHA-256
    `5F77B5D6B2429508DF8ADB178F1C43485A7CBF63A7ACD82B80391AD5F935D6C7`.
  - Backend sandbox test invocation failed before startup with `spawn EPERM`.
    Elevated `npm test -- --run src/modules/provisioning src/modules/device-status
    src/modules/device-events` — **PASS**, exit 0; 10 files, 48 tests passed.
    Backend source unchanged; no typecheck/build/full suite or PostgreSQL
    integration rerun.
  - COM enumeration `[System.IO.Ports.SerialPort]::GetPortNames()` returned
    `COM4`; follow-up PnP query yielded no board identity and exit 1. No port
    open/serial I/O occurred.
  - Final `git diff --check`: **PASS**, exit 0; only LF/CRLF advisories.
- Behavioral checks: Event button presses enqueue from GPIO4 state machine;
  commissioning button is read only by physical-confirmation flow on GPIO5.
  A GPIO5 held at gate startup is initialized as already pressed with no
  eligible hold, and requires release/fresh press. Confirmation is accepted
  on release after the existing 1.5-second threshold; confirmation window is
  30 seconds from `commissioning_gate_task` startup. Five-minute lifecycle
  deadline starts at that same task startup and is not restarted by button
  press. Existing pending Event queue entries are never cleared.
- Evidence boundaries: host tests cover deterministic logic, not real FreeRTOS
  task scheduling/electrical bounce. Build verifies source/profile only. No
  backend contract was changed. COM4 is listed but board revision/wiring are
  not confirmed, so no flash or physical commissioning was safe to attempt.
- Security/side effects: no production/staging DB writes, migrations, API
  calls, claim/provisioning, Wi-Fi credential entry, Event, FCM/email, serial
  open, flash/erase/reset, eFuse or security-mode change. Staging config keeps
  ordinary NVS and `CONFIG_NVS_ENCRYPTION` disabled; identity/credential
  extractability remains.
- Open blockers/next actions:
  1. Obtain board revision and schematic/pinout; verify GPIO5 is available and
     physically connected as intended while GPIO4 remains the Event button.
  2. Independently identify COM4 board and confirm recovery procedure before
     any authorized flash/readback.
  3. After physical pin evidence, install/launch the APK and run controlled
     claim → SoftAP → Wi-Fi → redemption → authenticated ONLINE → GPIO4 Event/
     ACK → notification/reboot recovery. Do not mark any physical gate PASS
     based on this software run.
  4. Protected-at-rest credential storage remains an explicit MVP limitation;
     do not claim ordinary NVS is encrypted.
- Files changed are listed in the RUN-043 report. Result:
  `PARTIALLY_COMPLETED`; source/host/build/app/backend-focused checks pass,
  GPIO5 electrical mapping and physical E2E are `NOT VERIFIED`.

## WP14-RUN-044 — Staging firmware flash and Owner-to-Device test guide

- Time: 2026-10-29 14:36 Asia/Saigon (UTC+07:00).
- Git: HEAD `02aed7aa9427086e5a42242ae58745ce6f31cea4`, branch `main`.
  Worktree was already dirty from RUN-043 and other pre-existing changes; no
  reset/clean/checkout was performed. RUN-044 edits only the Kconfig help text,
  this log, the WP14 summary, and the new operator guide.
- Goal: build and flash the staging GPIO split to the identified ESP32-S3,
  verify written regions, rerun host regression, and give the Owner a usable
  Store/Device/Wi-Fi/Event test sequence.
- Fresh target evidence: `pnputil /enum-devices /class Ports` identified COM4
  as an Espressif USB VID `303A` / PID `1001` interface. `python -m esptool
  --chip auto --port COM4 chip_id` exited 0 and identified ESP32-S3 QFN56 rev
  v0.2, 8 MB PSRAM. This is chip identity evidence, not carrier-board revision
  or GPIO wiring evidence. The read-only command reset the chip through RTS.
- Fresh build: ESP-IDF 5.5.5, isolated `build/staging-run043`, target
  `esp32s3`, defaults `sdkconfig.defaults;sdkconfig.staging.defaults`, using
  CMake 3.30.2/Ninja 1.12.1/Xtensa GCC 14.2.0. A subsequent incremental build
  after the Kconfig help correction exited 0. App `0xebdd0` / 966,096 bytes;
  partition `0x100000`, free `0x14230` / 82,480 bytes (~7.9%). App SHA-256
  `992E372B00811E4A1165F8E8E61485AFE5776CCF1CD351673D222531A2359E31`.
- Flash command: `python -m esptool --chip esp32s3 --port COM4 --baud 460800
  write_flash --flash_mode dio --flash_size 16MB --flash_freq 80m 0x0
  build/staging-run043/bootloader/bootloader.bin 0x8000
  build/staging-run043/partition_table/partition-table.bin 0x10000
  build/staging-run043/pulselink_firmware.bin` exited 0. Esptool reported
  digest verification success for all three writes. It erased only sectors
  covered by those regions; no full-flash erase or NVS region write was run.
  A separate `verify_flash` of all three offsets exited 0 and reported
  `verify OK (digest matched)` for bootloader, partition table and app. Board
  was hard-reset by RTS after flash and readback.
- Fresh C host suite: sandbox Docker attempt exited 1 before suite startup
  (`dockerDesktopLinuxEngine` access denied); elevated identical read-only,
  network-disabled Docker invocation exited 0: 11 runners passed, 0 failed,
  0 skipped (`physical`, `event-buttons`, `identity`, `lifecycle`,
  `transcript`, `crypto-interoperability`, `credential-storage`,
  `wifi-controller`, `backend-reachability`, `event-gate`,
  `nvs-credential-provider`).
- Android: fresh `adb devices -l` exited 0 but listed no device. Existing debug
  APK was found at `apps/android-fcm-test/owner/build/outputs/apk/debug/owner-debug.apk`,
  size 3,966,318 bytes, SHA-256
  `5F77B5D6B2429508DF8ADB178F1C43485A7CBF63A7ACD82B80391AD5F935D6C7`.
  APK was not rebuilt or installed in RUN-044; its test/build evidence remains
  historical RUN-043 evidence.
- E2E: no GPIO was pressed; no Wi-Fi configuration was sent; no claim or
  provisioning session was created; no staging API, database, Device Event,
  FCM/email delivery or notification was exercised. No serial monitor was
  opened. App install/launch, Wi-Fi association, redemption, authenticated
  ONLINE, Event ACK, notification and reboot recovery remain `NOT RUN`.
- Security: GPIO4 remains Event, GPIO5 remains commissioning in the verified
  staging build. Kconfig's stale “not yet implemented” label was corrected to
  describe the implemented button-gated SoftAP path. This does not verify
  carrier-board pads/wiring. Identity and operational credential remain in
  ordinary NVS and extractable; no at-rest protection is claimed. No eFuse,
  security mode, migration, production/staging DB write, or whole-flash erase.
- Errors: initial `idf.py chip_id` used an unsupported action (exit 1); use
  `esptool chip_id` instead (exit 0). First esptool attempt used unsupported
  hyphenated spelling `chip-id` (exit 1), corrected to `chip_id`. Initial
  PowerShell build command split semicolon-delimited defaults (exit 1); after
  quoting it, sandbox Windows subprocess creation returned `WinError 5`; the
  approved elevated build succeeded. Docker sandbox engine access was denied;
  elevated read-only test run passed. These failures are retained here.
- Files changed in RUN-044: `firmware/esp32/main/Kconfig.projbuild` (accurate
  feature description), `docs/firmware/store-device-wifi-commissioning.md`
  (operator procedure), `docs/audits/wp14-9-end-to-end-commissioning-report.md`
  (current evidence), and this append-only log. Existing RUN-043 files were
  preserved.
- Next actions: install the APK after a phone appears in `adb devices`; sign
  in, select the Store and use the public Device ID in the guide; commission
  via GPIO5; send Wi-Fi; wait for the app's authenticated backend status; press
  GPIO4 once when prompted for the first authenticated Event; verify the
  notification and Device status; then perform an approved reboot/recovery
  check. Confirm external GPIO4/GPIO5-to-GND wiring against the carrier board
  before physical button use. The guide records the exact statuses and retry
  guidance.
- Result: `PARTIALLY COMPLETED`. Board chip identity, staging build, flash and
  readback, and host logic are freshly verified; Owner-to-Device physical E2E
  and notification delivery are not verified because no phone was attached
  and no button/Wi-Fi/API test was performed.
- Runtime branch clarification from source review: the commissioning gate task
  starts only when startup does not take the retained station-config plus
  operational-credential backend-recovery path. Since RUN-044 preserved NVS
  and did not inspect runtime state, SoftAP availability on this board remains
  unknown. If SoftAP is absent, GPIO5 cannot reopen it in the recovery path;
  do not erase NVS. A non-destructive reconfiguration action is a remaining
  firmware gap for an already commissioned board.

## WP14-RUN-045 — Claim failure investigation and Wi-Fi mode arbitration

- Time: 2026-11-03 13:31 Asia/Saigon (UTC+07:00), logged at 06:31 UTC.
- Git: HEAD `02aed7aa9427086e5a42242ae58745ce6f31cea4`, branch `main`.
  Worktree was already dirty before this run. No reset, clean, checkout or
  deletion was performed; pre-existing WP14 files and build artifacts remain.
- Goal: trace the Android claim failure, backend claim semantics and ESP32
  SoftAP/STA lifecycle; fix Wi-Fi mode races and timer origin, improve safe
  claim diagnostics, run tests/builds and prepare the physical test procedure.
- Root cause evidence: source showed `wifi_reconnect_task()` could call
  `esp_wifi_connect()` after the commissioning transition to SoftAP, explaining
  the observed `ESP_ERR_WIFI_MODE`; this worker did not stop the AP. The
  five-minute timer was started at commissioning gate task entry, before AP
  startup. The log excerpt (AP around tick 8.45s, STA return around tick
  300.7s) is consistent with expiry but does not prove the exact timer start.
  Backend source confirms `DeviceClaimSession` is a challenge record; Device
  Store linking occurs only after proof verification in the `/complete` path.
  `APP_INSTALLATION_UPDATED` is unrelated to Device claim. Android's generic
  catch spans challenge API/response parsing and synchronous SoftAP request
  setup; async unavailable/lost callbacks have distinct messages. No Android
  stack trace or claim response was available, so the exact exception for the
  reported incident remains unverified.
- Implementation files: `firmware/esp32/main/main.c` serializes Wi-Fi mode
  changes, checks current mode and commissioning ownership before station
  reconnect, records deliberate SoftAP timeout, and starts the five-minute
  window after SoftAP/server startup; new
  `commissioning_wifi_mode_policy.c/.h` and `CMakeLists.txt` encode the
  reconnect gate; `commissioning_state.c/.h` and
  `commissioning_state_test.c` reset the bounded lifecycle deadline at AP
  startup; host runner and new `commissioning_wifi_mode_policy_test.c` cover
  the policy. Owner `MainActivity.java` now labels claim stage and validates
  challenge response; new `ClaimStartFailure.java` and its unit tests map
  safe failure categories. `docs/development/firmware-build.md` and
  `docs/firmware/store-device-wifi-commissioning.md` clarify timer origin and
  retry steps. Detailed evidence is in
  `docs/audits/wp14-11-device-claim-root-cause-and-e2e-report.md`.
- Commands/results:
  - C host command in Docker `gcc:13.2.0-bookworm`, network disabled and
    read-only source mount: exit 0; 12 runners PASS, 0 FAIL, 0 SKIP.
  - ESP-IDF 5.5.5 default ESP32-S3 build, `build/wp14-claim-fix-default`:
    exit 0; image `0x33810`, 80% app partition free.
  - ESP-IDF 5.5.5 staging ESP32-S3 build, `build/staging-run045`:
    exit 0; image `0xec1d0` / 967,120 bytes, `0x13e30` / 81,456 bytes free
    from the `0x100000` app partition (~8%). SHA-256
    `0519CACD53E9DB94169220CB620599BF055739F8F5DF6451BBCC7AC0CC24C360`.
    Non-fatal environment warning: `ESP_ROM_ELF_DIR` unset.
  - Backend focused command
    `npm test -- --run src/modules/provisioning/device-claim.service.test.ts src/modules/provisioning/provisioning.routes.test.ts`:
    fresh elevated retry exit 0; 2 files, 7 passed. Initial sandbox run
    failed before tests (`spawn EPERM`). No backend code changed.
  - Owner command
    `gradlew.bat :owner:testDebugUnitTest :owner:assembleDebug --rerun-tasks`:
    exit 0; 24 passed, 0 failed, 0 errors, 0 skipped. APK
    `apps/android-fcm-test/owner/build/outputs/apk/debug/owner-debug.apk`,
    3,966,318 bytes, SHA-256
    `26D04E0D24D0ECFC78CA71DB2293077447E95A843FF58299F87F09ED6A064808`.
  - `adb install -r .../owner-debug.apk`: exit 0, install success;
    `adb shell monkey -p com.pulselink.owner 1`: exit 0, launch intent
    delivered. This did not sign in or call commissioning APIs.
  - Default ESP-IDF build first attempted in sandbox: exit 1 before compiler
    due Windows `WinError 5` creating Ninja subprocess; same build outside
    sandbox exit 0.
  - Docker suite sandbox access was denied; approved read-only Docker retry
    passed as recorded above.
  - Fresh `pnputil /enum-devices /class Ports`: COM4 is USB VID `303A`, PID
    `1001`; COM3 is disconnected PID `4001`. `esptool --chip auto --port COM4
    chip_id` was attempted both sandboxed and elevated; both failed with access
    denied/busy (exit 1). No flash command was issued. RUN-045 staging image
    therefore remains build-only; RUN-044 image is the last reported flash and
    readback verification.
  - `git diff --check`: PASS, exit 0 after report/log edits; only existing
    LF/CRLF advisory warnings. Final `git status`/diff review confirmed no
    generated secrets or unrelated tracked changes were introduced by this
    increment.
- Fresh evidence: current builds, C host suite, 7 focused backend tests, 24
  Android JVM tests, APK install/launch, COM4 USB enumeration and busy-port
  result. Historical only: RUN-044 board chip/revision, firmware flash and
  readback. The RUN-044 flash is not evidence for RUN-045 image contents.
- Security/data decisions: no TLS bypass, auth relaxation, token/credential
  logging, Wi-Fi credential transfer, DB write/migration, claim, provisioning
  session, Device Event, FCM/email, NVS erase, flash write, eFuse write or
  security-mode change. Identity and operational credential remain in
  ordinary NVS; no at-rest confidentiality is claimed. GPIO4 remains Event;
  GPIO5 remains Commissioning in source/profile; carrier wiring is unverified.
- Blockers/next actions: COM4 is busy; identify and close its owning process,
  re-run `chip_id`, then flash only the verified staging image without NVS
  erase and verify the written regions. Confirm actual carrier GPIO4/GPIO5
  wiring. Run a supervised Owner claim, encrypted Wi-Fi transfer, redemption,
  authenticated ONLINE, GPIO4 Event/ACK, notification and reboot recovery.
  Exact Android incident exception and live claim response require fresh
  redacted app/backend correlation evidence.
- Overall: `PARTIALLY COMPLETED`. Software changes and builds/tests pass;
  current firmware was not flashed and physical commissioning was not run.

## WP14-RUN-046 — Startup recovery diagnostics and Device 401 handling

- Time: 2026-11-03 14:03 Asia/Saigon (UTC+07:00).
- Git: HEAD `02aed7aa9427086e5a42242ae58745ce6f31cea4`, branch `main`.
  Worktree contained pre-existing WP14 changes; preserved without reset/clean.
- Goal: identify why GPIO5 did not open SoftAP, trace Device Event 401 and
  smoke request behavior, add safe diagnostics, fix response classification,
  test and build without clearing NVS or modifying backend data.
- Startup path verified in source: staging `wifi_start()` reads station
  configuration from NVS because compile-time SSID is intentionally ignored.
  Existing station configuration plus valid operational credential selects
  backend recovery and does not create the GPIO5 confirmation task. GPIO5
  input is configured, but sampled only by `commissioning_gate_task()` on the
  commissioning path. With an invalid/I/O-failed credential, RUN-046 now
  records a storage fault and blocks both recovery and automatic commissioning
  fallback. Actual board NVS contents and branch remain unverified; COM4 was
  not opened/read in RUN-046.
- Event authentication source audit: commissioning staging builds load the
  Event bearer value from operational credential provider `opcred` NVS and
  call `esp_http_client_set_header("Authorization", ...)`; build-time token
  is compiled only for non-commissioning profiles. Backend hashes the bearer
  token and requires a matching non-disabled `ENROLLED`/`PROVISIONED` Device.
  Logs do not reveal which predicate failed. ESP-IDF 5.5.5 source at
  `components/esp_http_client/esp_http_client.c` emits the observed warning
  while parsing a response `WWW-Authenticate` challenge it cannot handle and
  returns `ESP_ERR_NOT_SUPPORTED`; it is not evidence that the request lacked
  its Bearer header. Response headers/remote DB were not inspected, so the
  challenge source and exact token/device mismatch remain unverified.
- Root cause/software defects fixed: Event sender previously only classified
  400/401/403/409 as permanent when `esp_http_client_perform()` returned
  `ESP_OK`; a received 401 paired with `ESP_ERR_NOT_SUPPORTED` entered the
  retry loop. It now persists the Event as blocked, never ACKs it and does not
  retry indefinitely. Status probe and redemption now classify a received
  nonzero HTTP status even if the HTTP client returns an error, so auth failure
  cannot become a false network retry/ONLINE path. HTTP smoke remains optional
  unauthenticated GET; current staging profile has empty `BACKEND_URL`, so it
  is disabled. Safe diagnostics distinguish DNS, TCP, TLS, HTTP auth/server
  and other transport failures, without logging response body or credentials.
- Files changed in RUN-046: firmware `main.c`, `commissioning_redeem.c`,
  `commissioning_backend_reachability_http.c`, `CMakeLists.txt`, new
  `commissioning_startup_policy.c/.h`, `commissioning_http_response_policy.c/.h`,
  `device_event_http_policy.c/.h`; host tests and `run_host_tests.sh`;
  operator guide; new detailed report
  `docs/audits/wp14-12-run-046-startup-recovery-and-device-auth-report.md`,
  this log and WP14 summary. Backend and Android source were not changed.
- Commands and actual results:
  - `docker run --rm --network none --read-only --tmpfs /tmp:rw,exec,nosuid,size=128m --mount type=bind,src=D:/project-PulseLink,dst=/src,readonly --workdir /src/firmware/esp32 gcc:13.2.0-bookworm sh tests/run_host_tests.sh` — exit 0; 15 runners PASS, 0 FAIL, 0 SKIP (`physical`, `event-buttons`, `identity`, `lifecycle`, `wifi-mode-policy`, `startup-policy`, `http-response-policy`, `event-http-policy`, `transcript`, `crypto-interoperability`, `credential-storage`, `wifi-controller`, `backend-reachability`, `event-gate`, `nvs-credential-provider`).
  - `npm test -- --run src/modules/device-events/device-event.service.test.ts src/modules/device-events/device-event.routes.test.ts src/modules/device-status/device-status.routes.test.ts src/modules/provisioning/provisioning.service.test.ts` in `server/api` — exit 0; 4 files, 20 tests PASS. No PostgreSQL integration or DB access.
  - ESP-IDF 5.5.5 staging: `idf.py -B build/staging-run046 -D 'SDKCONFIG=build/staging-run046/sdkconfig' -D 'SDKCONFIG_DEFAULTS=sdkconfig.defaults;sdkconfig.staging.defaults' build` — exit 0 after final incremental build; ESP32-S3 app `0xecae0` / 969,440 bytes, partition `0x100000`, free `0x13520` / 78,880 bytes (~7.5%). SHA-256 `21541FE1E23B0A440F9D99E5490DA36D7BF8EC56055BC22334C75CFF599028C0`.
  - ESP-IDF 5.5.5 default: `idf.py -B build/default-run046 -D 'SDKCONFIG=build/default-run046/sdkconfig' -D 'SDKCONFIG_DEFAULTS=sdkconfig.defaults' build` — exit 0; app `0x33860`, partition free `0xcc7a0` (~80%).
  - Both builds emitted non-fatal `ESP_ROM_ELF_DIR` unset warning; final compilation/image checks passed.
  - Profile inspection: commissioning enabled, operational storage enabled, HTTPS Event/redemption origins; optional smoke URL empty.
  - `git diff --check` run after final docs/log edits; exact exit recorded after this append.
- Fresh vs historical evidence: host suite, 20 backend tests, two current source builds and profile values are fresh RUN-046. COM4/board identity and RUN-044 flashed-image evidence remain historical only. RUN-046 image has not been flashed or read back.
- Physical/data status: no NVS erase/read, no flash/reset, no button press, Wi-Fi provisioning, staging API request, claim/session, Event, DB write, FCM/email, eFuse or security-mode operation. NVS state and operational-token validity on board: `NOT VERIFIED`. COM4 was busy in RUN-045; no claim is made that the port state was rechecked in RUN-046.
- Blockers and next steps: obtain safe boot metadata (station config yes/no, operational credential result, identity present and selected startup path) through an approved read-only diagnostic/available serial session. Do not dump raw NVS. If recovery path is active, GPIO5 is ignored by policy; authorized backend operator must verify Device hash/state using redacted metadata and apply an approved credential recovery contract. If reconfiguration is needed, design an explicit non-destructive GPIO5 recovery path separately. Current Event 401 becomes BLOCKED and needs an explicit operator-approved credential recovery/requeue process; no auto credential fallback exists.
- Overall: `PARTIALLY COMPLETED`. Source, host tests, backend focused tests and default/staging builds pass. Physical startup path, credential validity, SoftAP, authenticated ONLINE and Event/ACK are not verified.

### WP14-RUN-046 verification addendum

- Fresh read-only `pnputil /enum-devices /class Ports` — exit 0; COM4 is
  `USB Serial Device`, VID/PID `303A:1001`, status Started; COM3 is
  disconnected. This does not establish board revision or running firmware.
  No serial port was opened and no board operation was performed.
- Final `git diff --check` after report/log edits — exit 0; LF-to-CRLF
  advisories only.

### WP14-RUN-047 — MVP E2E review and non-destructive recovery commissioning

- Timestamp: 2026-11-03 14:32:36 +07:00.
- Git HEAD: `02aed7aa9427086e5a42242ae58745ce6f31cea4`; branch `main`.
  The worktree was dirty before this run with existing Android, firmware,
  docs, reports, and generated `server/api/dist` changes. No reset, clean, or
  checkout was performed. Backend build refreshed tracked generated output;
  prior per-file dirty contents were not snapshotted, so generated output was
  not reverted.
- Goal: review and implement one MVP commissioning/recovery path across Owner
  app, backend contracts, ESP32 and Device Event, while diagnosing RUN-046
  missing SoftAP and HTTP 401 evidence.
- Findings: source selected backend recovery for station config plus a valid
  operational credential, but did not start/sample a GPIO5 gate in that path.
  Board NVS was not inspected; whether the physical unit selected that path is
  unknown. Firmware source sends Event/status with the operational NVS Bearer
  credential; the observed 401 plus `ESP_ERR_NOT_SUPPORTED` does not establish
  why backend rejected it. Exact credential/Device state remains unknown.
- Implemented: recovery-path GPIO5 physical confirmation in a 30-second
  startup window; on accepted hold/release, cancel recovery, own Wi-Fi mode,
  start the existing SoftAP and bounded five-minute lifecycle, and return to
  recovery on timeout without deleting persistent data. Added a separate
  invalid-record repair startup path while keeping storage I/O faults
  fail-closed. Added pure policy tests and updated Android wording and operator
  guide. GPIO4, Event contract, Store authorization, provisioning protocol,
  backend routes/schema and notification policy were not changed.
- Files touched by this increment: `firmware/esp32/main/main.c`, new
  `commissioning_startup_policy.c/.h`, new
  `firmware/esp32/tests/commissioning_startup_policy_test.c`,
  `apps/android-fcm-test/owner/src/main/java/com/pulselink/owner/MainActivity.java`,
  `docs/firmware/store-device-wifi-commissioning.md`, this log, WP14.9 summary,
  and `docs/audits/wp14-13-run-047-mvp-end-to-end-review-and-implementation.md`.
  No database schema/migration or dependency changed.
- Commands/results:
  - `docker run --rm --network none --read-only --tmpfs /tmp:rw,exec,nosuid,size=128m --mount type=bind,src=D:/project-PulseLink,dst=/src,readonly --workdir /src/firmware/esp32 gcc:13.2.0-bookworm sh tests/run_host_tests.sh` — exit 0; 15 runners PASS, 0 FAIL, 0 SKIP. Earlier sandbox Docker access was denied; approved elevated rerun executed. One initial startup-window assertion failed at the exclusive deadline; corrected test checks the last instant inside the window, then all tests passed.
  - ESP-IDF 5.5.5 staging build `idf.py -B build/staging-run047 -D 'SDKCONFIG=build/staging-run047/sdkconfig' -D 'SDKCONFIG_DEFAULTS=sdkconfig.defaults;sdkconfig.staging.defaults' build` — exit 0; app `0xed340` / 971,584 bytes, partition `0x100000`, free `0x12cc0` / 76,992 bytes (~7.3%); SHA-256 `338B4CFACE6CADD0DB1DFB350221CA8320A42A42C67E3F71F39F9BF1C1E1A118`.
  - ESP-IDF 5.5.5 default build `idf.py -B build/default-run046 -D 'SDKCONFIG=build/default-run046/sdkconfig' -D 'SDKCONFIG_DEFAULTS=sdkconfig.defaults' build` — exit 0; app `0x33860` / 211,040 bytes, free `0xcc7a0` / 837,536 bytes (~80%); SHA-256 `170E13BD1A6A81EDB40CEA9D63E7266C148E6285C34433B4BE7D718B3614A018`. Non-fatal default-profile unused `s_event_button` warning observed because that profile disables the event button.
  - `./gradlew :owner:testDebugUnitTest :owner:assembleDebug` in `apps/android-fcm-test` — exit 0; 24 JVM tests PASS; APK `owner/build/outputs/apk/debug/owner-debug.apk`, 4,007,671 bytes, SHA-256 `7A647A0B7C9D812CB2001DFC777CCB484E570A444D1C0BD0C8B79F619CB257DD`. Not installed/launched. Initial Gradle cache access was sandbox-blocked; elevated rerun passed.
  - Backend focused `npm test -- --run src/modules/provisioning/device-claim.service.test.ts src/modules/provisioning/provisioning.service.test.ts src/modules/provisioning/provisioning.routes.test.ts src/modules/device-events/device-event.service.test.ts src/modules/device-events/device-event.routes.test.ts src/modules/device-status/device-status.routes.test.ts src/modules/notifications/notification-worker.test.ts` — exit 0; 7 files, 35 tests PASS. Initial subprocess spawn was sandbox-blocked; elevated rerun passed.
  - `npm run typecheck` (`server/api`) — exit 0. `npm run build` — exit 0; generated Prisma client and TypeScript output, no DB connection/write. Initial ESP-IDF environment/subprocess attempts failed before build; used installed ESP-IDF 5.5.5 Python 3.11 environment and approved elevated run.
  - `git diff --check` — exit 0; Git emitted LF-to-CRLF advisories only.
- Fresh evidence: host suite, both firmware builds, APK/JVM tests, backend focused tests/typecheck/build and diff check above. Historical only: RUN-044 physical board/image evidence and user-reported app sign-up/store behavior.
- Not run: DB integration (no DB logic/schema change and no test DB operation needed); Android device install/runtime; staging API requests; board/serial/NVS inspection; flash/reset; GPIO press; SoftAP/Wi-Fi; redemption; authenticated ONLINE; Device Event/ACK; reboot recovery; FCM/email. No production/staging/database writes and no security fuse/configuration operations.
- Security decision: retain existing auth, claim, proof, TLS, Event idempotency and commit-before-ACK. Reconfiguration uses the existing Owner session and encrypted provisioning handshake; no new endpoint, unauthenticated bypass, plaintext fallback, NVS erase, or secret logging. Ordinary NVS remains extractable; TOFU limitation unchanged.
- Blockers/next actions: exact remote reason for the 401 and actual board startup/NVS state require authorized redacted runtime diagnostics. Verify correct staging image/board, then exercise GPIO5 within the boot window, Owner-created fresh provisioning session, Wi-Fi, redemption, status and Event/ACK on hardware; reboot recovery and push delivery require separate evidence. Existing BLOCKED Event remains blocked and is not automatically replayed.
- Final status: `PARTIALLY COMPLETED` — software tests/builds pass; physical commissioning and remote credential recovery are not verified.

#### WP14-RUN-047 final verification addendum

- Final review found that backend recovery can reach `ONLINE` before the user
  completes GPIO5 within the 30-second window. Added a pure policy permitting
  reconfiguration when recovery is active (cancel it) or has reached terminal
  `ONLINE`/`FAILED`; unrelated in-progress states remain rejected. Host tests
  now cover these cases. This corrects timing independence without changing the
  commissioning protocol.
- Re-ran the complete Docker host suite after this final change — exit 0;
  15 runners PASS, 0 FAIL, 0 SKIP.
- Rebuilt both firmware profiles after the final change. Final staging image:
  `0xed370` / 971,632 bytes; 76,944 bytes free in the 1 MiB app partition;
  SHA-256 `F9B4C3BCBAF5F3C98CCBA3D0124BC417F61BAE5174661CA985FC889F5DE4B50A`.
  Final default image: `0x33860` / 211,040 bytes; 837,536 bytes free;
  SHA-256 `A402D726B6A959BB508D7CE6AB061AD71E6177283B7A7C8D8BF11C1F3E6CE493`.
  Both builds exit 0. The earlier image values in the RUN-047 entry were from
  the successful pre-review build and are superseded by these final artifacts.
- `git diff --check` after final report/log changes — exit 0; line-ending
  advisories only.
- After correcting the Android instruction to state the confirmation window
  begins after Wi-Fi initialization, reran `./gradlew :owner:testDebugUnitTest
  :owner:assembleDebug` — exit 0; 24 tests pass. Final APK is 4,007,699 bytes,
  SHA-256 `19B4F07887F2893622AE1770E4BC0775B27D79834888915D8379B28E8A366814`.
- Final `git diff --check` after all report/source edits — exit 0; line-ending
  conversion advisories only.
- Report clarification: firmware authenticated-recovery/Event gate state is
  distinct from the persisted backend Device `ONLINE`/last-seen state, which
  follows the existing first authenticated Event acceptance behavior; push
  delivery remains asynchronous and separate from ACK. Final `git diff --check`
  after this clarification — exit 0.

## WP14-RUN-048 — GPIO5 commissioning diagnosis and STA→AP diagnostics

- **Timestamp:** 2026-11-03 15:15 Asia/Saigon (UTC+07:00).
- **Git:** branch `main`; HEAD `b40cb893d008b66520c1653563e6854254ec90e4` (`b40cb89`). Worktree was clean at run start. RUN-048 changes are limited to `firmware/esp32/main/main.c`, `commissioning_transport.c/.h`, `sdkconfig.defaults`, `tests/physical_confirmation_test.c`, the commissioning guide, this log, WP14.9 summary and the detailed RUN-048 report. Build outputs are generated under `firmware/esp32/build/run048-*` and were retained.
- **Objective:** independently diagnose why the reported board did not open GPIO5 SoftAP and identify the source/build/physical evidence boundary, without accessing or changing the board.
- **Source findings:** `app_main()` initializes NVS/providers, GPIO inputs and Wi-Fi before startup selection. With station config + valid operational credential + runtime readiness, startup selects backend recovery and creates `commissioning_backend_recovery_task` plus `commissioning_recovery_button_task`; the initial `commissioning_gate_task` is not created on that branch. Commissioning-disabled or runtime-init/Wi-Fi-start failure also prevents the recovery gate. GPIO5 is active-low input with pull-up, separate from GPIO4; 50 ms debounce, 1,500 ms minimum hold, release required, and a 30 s window started when the gate task runs. A GPIO5 LOW at task start does not count as a press; release then a new press/release is required. This is a deterministic source finding, not proof of what the physical pin did.
- **Profile/flash finding:** reported app version prefix matches HEAD but cannot identify sdkconfig or board binary. The fresh staging profile has commissioning enabled, GPIO4 Event/GPIO5 commissioning, and 16 MB image header. The default profile has commissioning disabled and GPIO4 unset; before RUN-048 its generated sdkconfig used a 2 MB header. The reported board 2 MB header therefore suggests a non-staging/custom profile, but the actual image remains unverified. RUN-048 sets `CONFIG_ESPTOOLPY_FLASHSIZE_16MB=y` in `sdkconfig.defaults` for the supported N16R8 target; no partition layout was changed. The 16 MB chip/header discrepancy alone does not establish a partition fault.
- **Implementation:** added safe GPIO5 gate start/initial/sample/debounce/press/release/duration/expiry and recovery cancellation diagnostics. SoftAP setup now logs AP-netif creation, prior Wi-Fi mode, STA disconnect result, mode switch, AP config, HTTP start/route-registration/stop, restoration to STA, and AP netif cleanup. Added a deterministic host regression for GPIO5 held LOW at gate start: release alone is ignored, fresh valid gesture accepts. Event GPIO4 logic and Event contract were not changed.
- **Fresh commands/results:**
  - `docker run --rm --network none --read-only --tmpfs /tmp:rw,exec,nosuid,size=128m --mount type=bind,src=D:/project-PulseLink,dst=/src,readonly --workdir /src/firmware/esp32 gcc:13.2.0-bookworm sh tests/run_host_tests.sh` — exit 0; 15 runners PASS, 0 FAIL, 0 SKIP.
  - ESP-IDF 5.5.5 staging build: `idf.py -B build/run048-staging -D 'SDKCONFIG=build/run048-staging/sdkconfig' -D 'SDKCONFIG_DEFAULTS=sdkconfig.defaults;sdkconfig.staging.defaults' build` — exit 0; app `0xee0b0` / 975,024 bytes; `0x11f50` / 73,552 bytes free of 1 MiB (~7.0%); SHA-256 `D342881CD454F6E53A455536DA9D621AFF11F9F1B76D866B11A67BA7F109BA5A`.
  - ESP-IDF 5.5.5 default build with `SDKCONFIG_DEFAULTS=sdkconfig.defaults` — final confirmation exit 0; app `0x338f0` / 211,184 bytes; `0xcc710` / 837,392 bytes free (~80%); SHA-256 `0F6485C5253842404E94CB49333CD0876001493A97BE065F91A52672EAAD8A71`. Commissioning is intentionally compiled out in this profile. A non-fatal unused Event-button variable warning remains in this profile.
  - Partition decode with ESP-IDF `gen_esp32part.py` — exit 0: NVS at `0x9000`/24 KiB, PHY data at `0xf000`/4 KiB, factory app at `0x10000`/1 MiB; no OTA slot. Partition table SHA-256 `7F00B6C042A89B15B0CAC534F82ED988CAF29278FF5700B0C511EB1B5BB7C820`.
  - `esptool.py --chip esp32s3 image-info ...` — exit 2 (incorrect subcommand); corrected to `image_info` — exit 0, verifies local image metadata/checksum only, not the board.
  - `git diff --check` — exit 0 before report/log finalization; rerun after all documentation edits below.
- **Counts:** C host 15 pass / 0 fail / 0 skipped. Staging build pass; default build pass. Android/backend/DB tests not run because no related code changed. Hardware tests not run.
- **Fresh vs historical:** all host/build/partition results listed above are fresh RUN-048. Historical build profiles under `build/default-run046` and `build/staging-run047`, RUN-044 flash logs and user-supplied physical observations are historical; they do not identify the current board image. No image readback/hash or runtime log was collected in RUN-048.
- **Physical/root-cause status:** `UNVERIFIED`. Plausible causes include commissioning-disabled/custom profile and a held-at-gate-start gesture; neither can be assigned as the actual cause without board startup diagnostics and profile/image evidence. Board wiring/electrical behavior and STA→AP runtime are also unverified.
- **Safety/actions not performed:** no serial port opened; no NVS read/erase; no flash/reset; no GPIO input; no Wi-Fi config transfer; no claim/provisioning request; no API/DB write; no Event, push or email; no eFuse/security configuration change.
- **Next action:** with separate authorization for board observation/flash, identify the running image/profile without erasing NVS, boot with GPIO5 released, confirm `GPIO5 recovery gate task started`, then perform a fresh GPIO5 press/hold/release within 30 seconds and use the new per-step logs to classify any AP failure. Do not proceed to claim or Wi-Fi transfer until the board/profile and SoftAP startup are confirmed.
- **Status:** `PARTIALLY COMPLETED` — software diagnostics/tests/builds complete; physical startup path, GPIO5 behavior and commissioning remain unverified. Detailed report: `docs/audits/wp14-13-run-048-gpio5-commissioning-diagnosis.md`.

## WP14-RUN-049 — Correct Kconfig commissioning baseline and rebuild profiles

- **Timestamp:** 2026-11-03 15:24 Asia/Saigon (UTC+07:00).
- **Git:** branch `main`; HEAD `b40cb893d008b66520c1653563e6854254ec90e4`. RUN-048 worktree changes were present at start and preserved. No tracked generated `firmware/esp32/sdkconfig` exists; the tracked `sdkconfig.staging` was not edited. New configs/artifacts were generated in separate ignored build directories.
- **Root cause:** checked-in Kconfig had commissioning, identity NVS and operational credential storage defaults `n`; baseline `sdkconfig.defaults` set Event GPIO to `-1`. Staging defaults already had commissioning on, GPIO4/5 and both providers. The exact config excerpt supplied by the operator cannot be tied to one repository file or flashed image from available evidence. This mismatch means a default-profile build could compile out commissioning/GPIO4 and provider registration.
- **Implementation:** Kconfig and baseline defaults now align to GPIO4 Event/GPIO5 Commissioning, commissioning enabled, identity and operational NVS providers enabled, ESP32-S3 N16R8 16 MB image header, and IDF size optimization. The provider code is implemented and registered conditionally in `main.c`; it uses ordinary NVS, so the option is MVP functionality/persistence only and does not protect data at rest. Kconfig help now states the TOFU/extractable-key/token limitation. URLs, Wi-Fi values and device token remain empty in baseline. Existing staging defaults retain the already configured non-secret HTTPS redemption/Event endpoints, empty device token, NVS encryption off and size optimization. `docs/.gitignore` now explicitly allows the RUN-048 and RUN-049 reports, previously excluded by the audits ignore rule. No partition/security mode change.
- **Effective fresh configurations:** both build-dir `sdkconfig` files confirm ESP32-S3, `CONFIG_ESPTOOLPY_FLASHSIZE_16MB=y`, single-app partition, `CONFIG_PULSELINK_BUTTON_GPIO=4`, commissioning on, commissioning GPIO5, both NVS providers on, and size optimization. Baseline endpoint/token values are empty; staging has the existing redemption and Event HTTPS URLs and empty token. `flash_args` for both say `--flash_size 16MB`.
- **Fresh commands/results:**
  - C host suite Docker first attempt — exit 1 before test execution because access to `dockerDesktopLinuxEngine` pipe was denied. Rerun outside sandbox: `docker run --rm --network none --read-only --tmpfs /tmp:rw,exec,nosuid,size=128m --mount type=bind,src=D:/project-PulseLink,dst=/src,readonly --workdir /src/firmware/esp32 gcc:13.2.0-bookworm sh tests/run_host_tests.sh` — exit 0; **15 PASS, 0 FAIL, 0 SKIP**.
  - Fresh staging `idf.py reconfigure` + `idf.py build` with `SDKCONFIG=build/run049-staging-fresh/sdkconfig`, defaults `sdkconfig.defaults;sdkconfig.staging.defaults` — exit 0; image `0xee0b0` / 975,024 bytes, 73,552 bytes free (~7.0%) in app partition `0x100000`; SHA-256 `16B1A790816830E65C7B9C07B2E698AD61E574751A4B18CE06710E6247DA65B6`.
  - Fresh baseline `idf.py reconfigure` + `idf.py build` before adding size optimization — exit 1 at partition check; image `0x1042f0`, exceeded factory app partition by `0x42f0`.
  - After adding `CONFIG_COMPILER_OPTIMIZATION_SIZE=y`, a separate fresh baseline reconfigure/build in `build/run049-default-sized` — exit 0; image `0xed8b0` / 972,976 bytes, 75,600 bytes free (~7.2%); SHA-256 `334A4E0FAEFB02558A9A8B014B9545765E89A38EFE6C3844E60A30D54DACDFD0`.
  - System Python 3.14 `python -m esptool ... image_info` — exit 1 (`No module named esptool`); corrected to IDF Python 3.11, both local images image-info/checksum validation — exit 0.
  - `gen_esp32part.py` on staging generated partition table — exit 0; NVS 24 KiB at `0x9000`, PHY 4 KiB at `0xf000`, factory app 1 MiB at `0x10000`; no OTA slot.
  - `git diff --check` — final rerun after source, reports (including operator flash guidance), allowlist and log edits: exit 0 (line-ending advisories only).
- **Artifacts:** baseline app image `firmware/esp32/build/run049-default-sized/pulselink_firmware.bin`; staging app image `firmware/esp32/build/run049-staging-fresh/pulselink_firmware.bin`. Both artifacts are local build evidence only and were not flashed.
- **Not run:** Android/backend tests, PostgreSQL, physical GPIO, serial, flash/readback, NVS, staging API, claim/provisioning, Event, FCM/email. No production/staging writes, migration, NVS erase or eFuse/security changes.
- **Blockers/next actions:** ~7% partition headroom remains. Baseline endpoints are intentionally blank; use dedicated staging defaults to make a staging image. Verify correct board/image and separately authorize any flash before physical GPIO5 test. Ordinary NVS remains extractable. The current board image/profile is not identified by this build.
- **Status:** `PARTIALLY COMPLETED` — Kconfig, host suite and baseline/staging builds verified; board image and physical commissioning not verified. Detailed report: `docs/audits/wp14-13-run-049-kconfig-commissioning-build-fix.md`.

## WP14-RUN-050 — Verify and isolate ESP-IDF build profiles

- **Timestamp:** 2026-11-03 15:44 Asia/Saigon (UTC+07:00).
- **Git:** branch `main`; HEAD `b40cb893d008b66520c1653563e6854254ec90e4`. Dirty RUN-048/RUN-049 worktree preserved; no reset/clean.
- **Objective:** prove effective default/staging configuration selection and prevent profile-less builds/flash commands from silently using a stale or mismatched config.
- **Audit:** RUN-049 staging used `build/run049-staging-fresh/sdkconfig` plus defaults `sdkconfig.defaults;sdkconfig.staging.defaults` (per historical RUN-049 log). Existing `Invoke-FirmwareBuild.ps1` used plain `idf.py build`; ignored root `firmware/esp32/sdkconfig` currently has a 2 MB header, GPIO4 assigned to both buttons, commissioning disabled and providers disabled. This is a local wrong-profile risk, not proof of the board image. New profiles use independent `build/profiles/default` and `build/profiles/staging` directories and absolute config paths. Project CMake rejects sdkconfig paths outside these named profile directories.
- **Implementation:** new profile builder and confirmation-gated flash script; legacy build wrapper now requires `-Profile`. IDF target is explicit `esp32s3`; effective config and CMake cache are validated. Build metadata prints a non-secret allowlisted configuration fingerprint/profile and relevant runtime config. Operational firmware guides now use the scripts. No partition layout/security mode change.
- **Fresh build evidence:** default ESP-IDF 5.5.5 build PASS; `build/profiles/default/sdkconfig`, defaults `sdkconfig.defaults`; app `0xed8b0` / 973,360 bytes, 75,216 bytes free in 1 MiB partition; SHA-256 `5CFB41B358E9FF6ED0C1A9DF8B923683768A7C1F0879CCA6CE261C6F82D27535`. Staging build PASS; `build/profiles/staging/sdkconfig`, defaults `sdkconfig.defaults;sdkconfig.staging.defaults`; app `0xee240` / 975,424 bytes, 73,152 bytes free; SHA-256 `E9942D39FBEE2C1089FCC9994C966855940F79DAC9BF134039658AFA434C828E`. Both have ESP32-S3/16 MB image header, GPIO4 Event/GPIO5 Commissioning, commissioning and both NVS providers enabled, size optimization, and the same existing 1 MiB single-app partition (NVS 24 KiB at `0x9000`, PHY 4 KiB at `0xf000`, factory app `0x10000`/1 MiB). Profile-specific compile commands contain different labels and config fingerprints.
- **Commands/results:** `Build-FirmwareProfile.ps1 -Profile default` — PASS; `Build-FirmwareProfile.ps1 -Profile staging` — PASS. ESP-IDF `esptool.py image_info` on both images — exit 0. `gen_esp32part.py` on both partition binaries — exit 0. `Flash-FirmwareProfile.ps1 -Profile default -DryRun` and `... -Profile staging -DryRun` — both completed, printed correct config/artifact/hash/offsets, did not open serial or flash. Profile-less `idf.py -B build/profiles/guard-probe reconfigure` displayed the intended CMake fatal rejection; ESP-IDF wrapper returned exit 0 despite CMake reporting configure failure, so recorded as guard rejection evidence, not a normal nonzero test result. Docker C host suite first sandbox attempt exit 1 (engine pipe denied); rerun outside sandbox exit 0, 15 PASS / 0 FAIL / 0 SKIP. PowerShell parser for three scripts PASS. `git diff --check` after final docs/report changes — exit 0; line-ending advisories only.
- **Initial issues encountered:** config validator regex initially failed on CRLF sdkconfig lines, then token-empty check did the same; both were fixed with CRLF-aware patterns and the fresh profile builds passed. Sandbox blocked Docker's engine pipe; the identical isolated read-only suite ran outside sandbox.
- **Files changed in RUN-050:** `firmware/esp32/CMakeLists.txt`, `firmware/esp32/main/CMakeLists.txt`, `firmware/esp32/main/Kconfig.projbuild`, `firmware/esp32/main/main.c`, `firmware/esp32/sdkconfig.defaults`, `firmware/esp32/sdkconfig.staging.defaults`, `scripts/Build-FirmwareProfile.ps1`, `scripts/Flash-FirmwareProfile.ps1`, `scripts/Invoke-FirmwareBuild.ps1`, firmware getting-started/Wi-Fi/LAN/commissioning guides, docs ignore allowlist, WP14.9 summary and this log. Earlier dirty files remain combined in the worktree; no claim that all are authored by RUN-050.
- **Not run / not done:** no board, COM port or serial monitor; no flash/reset/erase/NVS read; no API, DB, claim, provisioning, Event, FCM/email or production/staging writes. No proof identifies the firmware currently running on hardware. Ordinary NVS remains extractable. Images are local build artifacts only.
- **Status:** `PARTIALLY COMPLETED` — isolated software profiles/builds verified; physical board firmware remains `UNVERIFIED`. Detailed report: `docs/audits/wp14-13-run-050-build-profile-verification.md`.

## WP14-RUN-051 — Diagnose Device claim response mismatch

- **Timestamp:** 2026-11-03 18:22 Asia/Saigon (UTC+07:00).
- **Git:** branch `main`; HEAD `b40cb893d008b66520c1653563e6854254ec90e4`; existing dirty worktree retained.
- **Objective:** trace why Owner claim appears to start but no Device is visible in the selected Store; align client/backend response validation and state transitions.
- **Root cause:** the API endpoint is a two-phase claim start. It creates only a five-minute `DeviceClaimSession`; no Device record or Store relationship exists until Android connects SoftAP, obtains the board-signed proof, and POSTs `/device-claims/:claimSessionId/complete`. The supplied app text is emitted before the app starts SoftAP connection, when the parsed 2xx response is missing/mismatched with the expected `data.session` and 43-character challenge contract. The current backend source returns that contract and new route test passes. User-provided backend evidence has only the incoming request log, without HTTP response status/body/request ID or completion request; exact mismatch in deployed staging code/proxy cannot be proven here.
- **Physical log interpretation:** user-provided log verifies staging profile, GPIO4 Event/GPIO5 Commissioning, accepted physical gesture, SoftAP and local HTTP routes; AP ran to its five-minute deadline. No proof request/completion route appears in the evidence. This is not claim success.
- **Implementation:** Android validates `data`, session id, exact Device ID and Store ID, challenge shape, expiry presence, and already-claimed response ownership before proceeding. Contract mismatch UI shows a fixed reason code and backend request ID, without body/challenge/secrets, and correctly says link is not complete. Backend route regression asserts `201` envelope and absence of Device creation at claim-start. Guide clarifies that Device list remains empty until proof completion. No endpoint/schema/migration/auth change.
- **Fresh commands/results:** backend focused `npm test -- --run src/modules/provisioning/provisioning.routes.test.ts src/modules/provisioning/device-claim.service.test.ts` — exit 0, 2 files / 8 tests PASS (sandbox first attempt failed before tests with Vite `spawn EPERM`; approved external rerun passed). `npm run typecheck; npm run build` — exit 0; Prisma client generate and TS build completed. Android initial JVM test attempt failed 3 newly written tests because Android platform `org.json` methods are stubs in local JVM; replaced those tests with pure field-validation checks (production checks unchanged). Final `:owner:testDebugUnitTest :owner:assembleDebug` — exit 0, 28 PASS / 0 FAIL / 0 SKIP. APK `apps/android-fcm-test/owner/build/outputs/apk/debug/owner-debug.apk`, 4,008,936 bytes, SHA-256 `F8B8E85854F273524B14C862A511B795888C235FE6AA1CEB104EA463607B9162`.
- **Files changed for RUN-051:** `apps/android-fcm-test/owner/src/main/java/com/pulselink/owner/ClaimStartResponse.java` (new), `MainActivity.java`, `ClaimStartFailure.java`, Android tests `ClaimStartResponseTest.java` (new) and `ClaimStartFailureTest.java`, `server/api/src/modules/provisioning/provisioning.routes.test.ts`, commissioning guide, docs ignore allowlist, WP14.9 summary and this log. Other dirty RUN-048/RUN-050 changes remain preserved.
- **Not done:** no staging API request, response body capture, DB query/write, migration, claim retry, SoftAP connection from app, proof completion, provisioning, Wi-Fi transfer, redemption, Event, FCM/email, flash/reset/erase, serial operation or security fuse change. No live Device–Store link verified.
- **Next action:** install this APK, make one claim attempt while the AP is active, and report only the UI response-check code and request ID. Staging operator correlates response status/schema; do not share challenge/body. Wait for prior session expiry before retry. Once response parses, continue only after board proof and `/complete` success.
- **Status:** `PARTIALLY COMPLETED` — code contract hardening and software verification pass; staging response and physical Device linking remain `NOT VERIFIED`. Detailed report: `docs/audits/wp14-14-run-051-device-claim-response-mismatch.md`.

### RUN-051 continuation — Final artifact/report consistency check

- **Timestamp:** 2026-11-03 20:31 Asia/Saigon (UTC+07:00).
- Verified the current debug APK exists at `apps/android-fcm-test/owner/build/outputs/apk/debug/owner-debug.apk`: 4,008,936 bytes; SHA-256 `F8B8E85854F273524B14C862A511B795888C235FE6AA1CEB104EA463607B9162`. This matches the detailed RUN-051 report. Corrected the WP14.9 summary's stale size value from 4,008,905 to 4,008,936 bytes.
- Rechecked source-level claim phases: claim-start creates a short-lived session only; the `/complete` route is the step that verifies signed proof and creates the Store-scoped Device. No staging request, database operation, board action, or notification was performed.
- Final `git diff --check` run is recorded in the continuation evidence for this entry; line-ending conversion warnings may be emitted by Git on this Windows worktree.

## WP14-RUN-052 — Fix Android SoftAP request permission failure

- **Timestamp:** 2026-11-03 21:16 Asia/Saigon (UTC+07:00).
- **Evidence/root cause:** user-provided app output was a `SecurityException` mapped incorrectly to Nearby Wi-Fi denial. `MainActivity` checks runtime permission before claim-start; the backend incoming POST proves that check passed for this attempt. Source then calls `ConnectivityManager.requestNetwork()` with `WifiNetworkSpecifier`; the manifest lacked `CHANGE_NETWORK_STATE` and `ACCESS_WIFI_STATE` (and lacked explicit `ACCESS_NETWORK_STATE`). These declarations are required for local network request/binding. This explains why claim-start reached backend but Android did not show the SoftAP prompt. The exact OS exception string/version was not supplied.
- **Physical log interpretation:** manual phone join reached the AP and received DHCP. Android's `GET /` got the expected 404 because `/` is not a commissioning route. This does not indicate an app proof request. The app must POST `/v1/commissioning/enrollment-proof`; only afterward does it call backend `/device-claims/:claimSessionId/complete`. The supplied log does not prove either request.
- **Changes:** Android manifest adds `ACCESS_WIFI_STATE`, `ACCESS_NETWORK_STATE`, `CHANGE_NETWORK_STATE`; retained `CHANGE_WIFI_STATE` and runtime permissions. SoftAP SecurityException UI is now generic/actionable and no longer blames Nearby permission alone. JVM assertion and operator guide updated. No backend/API, firmware, database, Store, or protocol changes.
- **Fresh verification:** `:owner:testDebugUnitTest :owner:assembleDebug` first failed before Gradle startup because sandbox could not access the user Gradle wrapper lock; rerun with access to existing local Gradle cache succeeded. **28 JVM tests pass, 0 fail, 0 skip**. Merged manifest verified all four Wi-Fi/network permissions. APK `apps/android-fcm-test/owner/build/outputs/apk/debug/owner-debug.apk`: **4,008,977 bytes**, SHA-256 `630B3F3E69145F1FCA0F418BD0D23BDAE3FD61C4BC1F069AF07F4F559B37F020`.
- **Not performed:** no APK install/launch, live system prompt, claim/proof API request, database operation, board/serial/flash/reset, Wi-Fi credential transfer, Event or FCM/email. `/complete`, Device–Store link and physical commissioning are not verified.
- **Status:** `PARTIALLY COMPLETED` — source defect fixed and software verified; physical Android prompt and end-to-end claim remain pending. Detailed report: `docs/audits/wp14-15-run-052-android-softap-request-permissions.md`.

## WP14-RUN-053 — Allow only the ESP32 SoftAP HTTP origin

- **Timestamp:** 2026-11-03 21:33 Asia/Saigon (UTC+07:00).
- **New evidence:** after RUN-052, the phone joined the AP, obtained `192.168.4.2`, then left about 610 ms later; app showed proof/claim failure; staging received claim-start only. Source calls local proof at `http://192.168.4.1` after network availability. The Owner app targets API 36 and had no cleartext exception. Android blocks cleartext by default for target API 28+ apps; the blocked local request occurs before `/complete`, and the catch closes the AP network binding. User timing is consistent with this path; raw Android exception was not captured.
- **Fix:** added an explicit Network Security Config with base cleartext denied and a per-host cleartext exception for only `192.168.4.1`; linked it in the manifest. HTTPS backend/TLS policy remains unchanged. Added safe cleartext/security failure classification and tests; commissioning guide updated. Firmware's `/` 404 remains a separate Android connectivity probe, not proof POST.
- **Fresh verification:** `:owner:testDebugUnitTest :owner:assembleDebug` — final build exit 0; **31 JVM tests pass, 0 fail, 0 skip**. Merged manifest points to `@xml/network_security_config`; resource compiler emitted the packaged config. APK size **4,127,042 bytes**, SHA-256 `9BB2BE31E8D84E611A45A763023337378C9BFA2D5C774476004DFAB47B64ABAE`. `adb install -r` returned `Success`; package metadata shows updated install time and target SDK 36. App was not launched to avoid initiating session/FCM synchronization or staging requests. No claim retry/API call/database operation/board action was performed.
- **Status:** `PARTIALLY COMPLETED` — platform transport blocker addressed and APK installed; actual proof POST and backend `/complete` need the next operator attempt. Detailed report: `docs/audits/wp14-15-run-053-local-softap-cleartext-policy.md`.

## WP14-RUN-054 — Fix enrollment-proof HTTP server stack exhaustion

- **Timestamp:** 2026-11-03 21:50 Asia/Saigon (UTC+07:00).
- **Root cause:** The supplied panic ELF prefix `3fabfdcdb` matched the prior staging ELF. `addr2line` mapped the PC to ESP-IDF `httpd_resp_set_status()` with `response_error()` in `commissioning_transport.c`, called from `enrollment_proof_handler()`. That handler's 4,097-byte request body and 2,048-byte transcript payload (plus other local buffers/crypto calls) exceeded the HTTP server's default 4 KiB task stack. The invalid request context caused the null-adjacent StoreProhibited. The monitor's unrelated MbedTLS/reconnect symbol labels are inaccurate for this ELF. Android source calls local `/v1/commissioning/enrollment-proof` first and calls backend `/complete` only after proof returns; the reboot therefore explains claim-start-only backend logs.
- **Change:** Set the commissioning HTTP server task stack to 16 KiB. Added safe receipt/rejection/response diagnostics and explicit start/route-registration error logs. No claim, crypto, authorization, or API contract change.
- **Fresh verification:** ESP-IDF 5.5.5 staging configure/build exit 0; image `0xee3d0` / 975,824 bytes, 72,752 bytes free (~7.0%) in 1 MiB partition; SHA-256 `45544DEA07AD32B8914F6ED6A48C20FCDBB3722DE4688D1A58BDF07249401FC1`. Effective profile confirms commissioning enabled, GPIO4 Event/GPIO5 commissioning, and both NVS providers enabled. Read-only Docker C host suite exit 0: 15 PASS / 0 FAIL / 0 SKIP. Final `git diff --check` after report/log updates: exit 0; only line-ending advisories.
- **Not performed:** no flash, serial operation, reset/NVS read or erase, staging API/DB operation, claim retry, Wi-Fi transfer, Event, FCM/email or eFuse/security change. The newly built firmware is not on the board. Physical proof response, backend `/complete`, Store link and later commissioning remain NOT VERIFIED.
- **Status:** `PARTIALLY COMPLETED` — source root cause corrected and staging build/host tests pass; physical retest is pending flashing the identified staging image after board/port safety confirmation. Detailed report: `docs/audits/wp14-15-run-054-enrollment-proof-httpd-stack-panic.md`.

## WP14-RUN-055 — Remove unsynchronized-clock rejection and wait for SoftAP DHCP

- **Timestamp:** 2026-11-03 22:10 Asia/Saigon (UTC+07:00).
- **Evidence/root cause:** operator-provided monitor shows SoftAP ready, an initial station association without DHCP followed by a later lease, then `enrollment proof request received` and generic rejection. Android calls backend `/complete` only after local proof returns, so its absence is expected at this stage. Source contains no SNTP initialization; the proof handler's `expires_at <= time(NULL)` / `expires_at <= now + 300` check could reject a valid absolute server expiry while the ESP32 wall clock remains near epoch. Backend already validates the signed exact expiry against its persisted claim session and server time.
- **Changes:** removed the unsynchronized local wall-clock comparison while preserving integer expiry validation and proof-of-possession; added safe per-predicate rejection reason logs. Android SoftAP connection now waits for DHCP IPv4 before invoking local HTTP, extends the bounded system network request from 8 to 30 seconds, and reports unavailable/lost network accurately. Added two JVM tests for DHCP readiness; commissioning guide updated. No API/backend/schema changes.
- **Fresh verification:** Owner JVM/APK `:owner:testDebugUnitTest :owner:assembleDebug` exit 0: 33 pass / 0 fail / 0 skipped; APK 4,127,042 bytes, SHA-256 `9B803AC769817BF10BE51F3F74742F8C6A43C7D5B585A5261156A55AB498186F`. Installed with `adb install -r` (`Success`), not launched. ESP-IDF 5.5.5 staging reconfigure/build exit 0: `0xee5b0` / 976,304 bytes, 72,272 bytes free (~7%) in 1 MiB app partition; SHA-256 `F7D2492563772FD239EE1D7E3C00533BC4492D43791C9D625129275B5F8401E4`. C host suite 15/15 pass. Backend/DB tests not run; no API or DB actions.
- **Not performed:** new firmware not flashed; COM4 enumerated as Espressif USB VID/PID `303A:1001`, but read-only process check found active `esp_idf_monitor -p COM4` processes (PIDs 3916, 42808). Monitor was not stopped and COM4 was not opened for chip-ID/flash. No claim completion/provisioning/API or DB write, Wi-Fi credential transfer, Event/FCM, NVS operation, eFuse or security configuration. User-provided logs are physical evidence for the previous firmware image, not verification of RUN-055.
- **Status:** `PARTIALLY COMPLETED` — source fixes and software verification pass; close the existing serial monitor, then flash RUN-055 firmware and retest with the installed APK. Detailed report: `docs/audits/wp14-15-run-055-claim-proof-clock-and-softap-dhcp-race.md`.

## WP14-RUN-056 — Wait for Internet route before backend claim completion

- **Timestamp:** 2026-11-04 Asia/Saigon.
- **Evidence/root cause:** user log shows proof request received and proof response sent; board client leaves SoftAP ~100 ms later; backend logs only claim-start. Source called `/complete` immediately after `SoftApConnection.close()` unbound the process from the Internet-less AP. Android may not yet have restored the default Internet route. The API client maps connection IOException to status 0, while `MainActivity` mapped all failures to one generic UI message. C/Android/TypeScript canonical claim transcript source formats match; physical proof signature acceptance and backend connection attempt remain unobserved.
- **Changes:** added a bounded 15-second wait for Android's default network to advertise both Internet and validated capabilities after releasing SoftAP; only then send HTTPS claim completion. Added safe, stage-specific claim failure mapping and JVM tests for handoff wait/readiness/timeout and HTTP authorization/conflict errors. Updated commissioning guide. No firmware, backend, API, schema or database changes.
- **Fresh verification:** final Owner JVM/APK `:owner:testDebugUnitTest :owner:assembleDebug` exit 0: 39 pass / 0 fail / 0 skipped. APK size 4,127,042 bytes; SHA-256 `5BD4D8A322E3165A61117C4DADE186715958273AECEDD4017D254A9290A16EC4`. Earlier `adb install -r` returned `INSTALL_FAILED_USER_RESTRICTED: Install canceled by user`; it was not retried after the final build, and RUN-056 UI was not run on handset. Backend/DB tests and API calls not run. Final `git diff --check` passed after report/log edits.
- **Not verified:** claim proof accepted by Android, backend `/complete`, Device–Store persistence, Wi-Fi provisioning, redemption, ONLINE, Event/ACK and notification. No firmware flash, serial action, database write or push delivery.
- **Status:** `PARTIALLY COMPLETED` — handoff fix and software tests pass; physical retest requires handset to permit the APK install. Detailed report: `docs/audits/wp14-15-run-056-owner-network-handoff-claim-completion.md`.

## WP14-RUN-057 — Diagnose provisioning SoftAP reconnect and preserve retry

- **Timestamp:** 2026-11-04 Asia/Saigon.
- **Git:** branch `main`; pre-existing dirty RUN-048–RUN-056 worktree preserved. No reset/clean.
- **Evidence/root cause:** the latest operator result (“Device claim confirmed”, Device and ProvisioningSession rows) differs from prior incomplete claim attempts. Source reaches that success message only after claim `/complete` succeeds, the enrolled Device appears under the Store, and a separate provisioning session is created. `device-claim.service.ts` creates the linked Device with `status=PENDING` and `provisioningState=READY`; pending is expected before Wi-Fi credentials are redeemed and authenticated runtime activity occurs. Board log proves initial SoftAP join, DHCP and proof response, followed by the phone leaving so Android can restore Internet and finish claim. For the later Connect attempt, no second station join/DHCP or local handshake/credentials request is present. Thus failure is before firmware receives provisioning data. The supplied evidence lacks the full five-minute AP timeline and Android `NetworkCallback` logcat, so it cannot distinguish Android prompt/timeout, unavailable/out-of-range AP, manual SSID mismatch or AP-window expiry.
- **Changes:** provisioning SSID is now derived from the linked Device ID rather than editable UI input. Android logs safe SoftAP request/available/IPv4/unavailable/lost milestones. If Android reports the SoftAP request unavailable while the lifecycle remains in its initial connection step, the app returns to `SESSION_READY`, preserves provisioning context and allows retry; expired/later-stage sessions are not reopened by this path. UI explains 30-second Android acquisition and five-minute firmware AP bounds. Guide, summary and detailed report updated.
- **Fresh verification:** `.\gradlew.bat :owner:testDebugUnitTest :owner:assembleDebug` — PASS, 41 tests / 0 failed / 0 skipped; APK 4,127,042 bytes, SHA-256 `33C111E822077CA621B98EC776D5D5C09B37F648ADEEB62F57F5D6714E1DA13A`. Initial sandbox attempt failed before tests because Windows denied the Gradle cache lock; approved rerun passed. `git diff --check` — PASS, exit 0, line-ending advisories only.
- **Not run:** no staging API, DB query/write, migration, Wi-Fi credential transfer, provisioning redemption, Event/FCM, firmware/C host build, handset install/runtime test, serial action, flash/reset/erase, NVS or fuse/security operation. Hardware is not claimed as verified.
- **Next physical check:** install the new APK, retry promptly during an active GPIO5 SoftAP window, accept Android's Wi-Fi prompt, and capture `PulseLinkSoftAp` logcat plus complete firmware logs through the attempt. Expected after callback IPv4-ready: second station join/DHCP, local handshake and encrypted credentials. If no second join occurs, callback milestones will isolate Android acquisition from firmware transport.
- **Status:** `PARTIALLY COMPLETED` — Android source retry/SSID fix and JVM/APK build pass; second SoftAP acquisition and all Wi-Fi provisioning/redeem/ONLINE/Event/recovery stages remain unverified. Detailed report: `docs/audits/wp14-16-run-057-provisioning-softap-retry.md`.

## WP14-RUN-058 — Diagnose local provisioning timeout and recover handshake

- **Timestamp:** 2026-11-04 Asia/Saigon.
- **Git:** branch `main`; preserved all pre-existing dirty worktree changes.
- **Evidence/root cause:** new physical log shows second phone join, DHCP lease at `74695`, and leave at `82965` (about 8.27 seconds). This matches the Owner local HTTP connect/read timeout of 8 seconds. The board log does not reveal whether handshake reached the HTTP handler because that handler had no phase logs. Local handshake/credentials endpoints are `192.168.4.1`; no backend request is expected until encrypted credentials are accepted and firmware POSTs the redemption route on venue Wi-Fi. The repeat Connect validation failure was confirmed in code: `finally` always cleared `provisioningData`/session after a local timeout. Firmware also stopped its timer loop in `RECEIVING_CONFIG` and would reject a new handshake after a lost response.
- **Changes:** increase Android local request timeout to 20s; close/flush request body before reading response; add safe app request stage logs and firmware handshake receipt/rejection/response-time logs; distinguish handshake timeout from credentials-ACK uncertainty; poll backend after ambiguous credentials timeout; require a fresh provisioning session after handshake timeout; tell user explicitly when context was cleared. Firmware permits a fresh handshake only from unconsumed `RECEIVING_CONFIG`, clears old derived key/transcript/context, returns lifecycle to SoftAP state, and keeps the original bounded AP deadline task alive while receiving config. Added C lifecycle regression. Added `esp_timer` component dependency. Fixed staging build script version probe because installed `idf.py` launcher reports its own `v1.0.3`, not the underlying ESP-IDF release.
- **Fresh verification:** Android `:owner:testDebugUnitTest :owner:assembleDebug` — PASS, 42/42, 0 failures/skips; APK size 4,127,042, SHA-256 `E80AC4444E17F8ADEABFEAE1FC78DA87965082A5D450F31E73C01FB38698ED2E`. C host suite — PASS, 15/15, 0 failures/skips. `Build-FirmwareProfile.ps1 -Profile staging` under ESP-IDF v5.5.5 — PASS; image `0xeeba0` / 977,824 bytes, 70,752 bytes (~6.7%) free of 1 MiB app partition; SHA-256 `648EB93E4B27FB2570AA95F4A93C411B119FA24513E2F3428797F4E5C29E5192`. `git diff --check` PASS, exit 0, line-ending advisories only.
- **Build issues resolved:** first IDF profile script invocation lacked exported environment; export selected absent py3.14 venv, so existing py3.11 environment was explicitly selected. Its `idf.py` launcher version guard then misread wrapper version `v1.0.3`; script now queries IDF's Python entrypoint. First firmware compile found `esp_timer` missing from component requirements; dependency added. Final staging profile script build passed.
- **Not run:** no APK install/phone runtime, firmware flash/serial, staging API, DB, migration, Wi-Fi credentials, provisioning redemption, Event/FCM/email, reset/erase, NVS operation, or security fuse/mode change. Physical E2E remains NOT VERIFIED.
- **Next verification:** install APK and flash staging image only under the previously approved physical workflow; capture `PulseLinkCommissioningHttp` and `pulselink-commissioning` lines. Compare Android handshake stage to firmware receipt/result. Create a fresh provisioning session after handshake timeout; do not re-claim the already linked Device. A credentials-stage timeout must be correlated with redemption before retry.
- **Status:** `PARTIALLY COMPLETED` — source fixes, host tests, Android build and staging firmware build pass; physical local handshake, Wi-Fi delivery, redemption, ONLINE, Event/ACK and recovery remain unverified. Detailed report: `docs/audits/wp14-17-run-058-local-handshake-timeout-recovery.md`.

## WP14-RUN-059 — Route commissioning requests over the granted SoftAP network

- **Timestamp:** 2026-11-05 Asia/Saigon. Preserved all existing dirty worktree changes.
- **Root cause/evidence:** User evidence confirms claim-start and claim-complete reached the backend. The subsequent Android “Authenticating device” request is local HTTP to `192.168.4.1`, not a backend call; it does not require Internet. Backend redemption is expected only after encrypted Wi-Fi credentials are accepted and the ESP32 rejoins venue Wi-Fi. Previous code relied on process-wide `bindProcessToNetwork()` followed by ordinary `URL.openConnection()`. The provided current board excerpt lacks a correlated handshake-handler log, so whether the timeout request reached firmware remains unverified. The implicit process route was replaced with explicit `Network.openConnection(URL)` for all local commissioning requests.
- **Changes:** Android transport now receives the exact Android `Network` that passed SoftAP IPv4 readiness and binds claim-proof, handshake and encrypted-credentials HTTP sockets directly to that network. No API/protocol/auth/backend/firmware contract changed. `PENDING` remains expected pending provisioning/redeem/runtime evidence.
- **Fresh verification:** Owner `:owner:testDebugUnitTest :owner:assembleDebug` PASS, 42 tests, 0 failures/skips; APK 4,127,042 bytes, SHA-256 `450ED807A2DDD97F009C9ABD1E514C4177B590B80E00D76214B799CF7339C043`. `git diff --check` PASS exit 0 (line-ending advisories only).
- **Not run:** no install/physical retest, firmware build/flash/serial, staging API, database, Wi-Fi transfer, redemption, Event/FCM, or reboot. No secret or production side effect.
- **Status:** `PARTIALLY COMPLETED` — Android change and build verified; physical local handshake, Wi-Fi delivery, redemption, ONLINE, Event/ACK and reboot recovery not verified. Detailed report: `docs/audits/wp14-18-run-059-explicit-softap-network-routing.md`.

## WP14-RUN-060 — Diagnose Android SoftAP acquisition timeout

- **Timestamp:** 2026-11-06 Asia/Saigon. Existing dirty worktree preserved.
- **Evidence:** Backend logs show Store devices GET, claim start/complete and provisioning-session creation. These establish app reached SoftAP acquisition; local handshake/credential requests do not appear in backend logs. The user-visible 30-second message is emitted by `NetworkCallback.onUnavailable`, before handshake. Latest board excerpt has no correlated join/DHCP, and no Android callback logcat was supplied; AP visibility/association root cause remains unverified.
- **Fix:** `SoftApConnection` now stores link properties and evaluates IPv4 readiness on both `onAvailable` and `onLinkPropertiesChanged`, guarding callback ordering. Safe logs classify available/IPv4-ready/unavailable/lost. UI no longer assumes the OS prompt appeared and asks operator to verify system Wi-Fi network visibility and active AP window. No backend/firmware contract changed.
- **Fresh verification:** Owner JVM/APK build PASS: 42 tests, 0 failures/skips; APK 4,127,042 bytes, SHA-256 `302C3363B1983CB792E502D509ED15646A8118AD5537AAE6B9893AF211F37882`. `git diff --check` PASS (exit 0; line-ending advisories).
- **Not run:** no phone install, board/serial action, staging API, DB, Wi-Fi credentials, provisioning, redemption, Event/FCM, or firmware build. Physical SoftAP acquisition remains NOT VERIFIED.
- **Status:** `PARTIALLY COMPLETED`; detailed report: `docs/audits/wp14-19-run-060-softap-network-request-diagnosis.md`.

## WP14-RUN-061 — Recover missing in-memory provisioning context

- **Timestamp:** 2026-11-06 Asia/Saigon. Preserved existing dirty worktree.
- **Evidence/root cause:** Board confirms claim proof request/response and SoftAP DHCP. Backend confirms claim completion and provisioning-session creation. The exact app message is guarded by `provisioningData == null` before SoftAP request; therefore this invocation returns before handshake. The in-memory provisioning context can be lost while backend session remains. The supplied board second join cannot be correlated without app logcat.
- **Fix:** Connect now reacquires a provisioning session through the existing Store-authorized API when in-memory context is absent, reloads linked Device context, starts a fresh lifecycle, then requests SoftAP; it never reclaims Device or persists session bootstrap secrets. Explicit session creation shares the same helper.
- **Fresh verification:** Owner unit tests/APK build PASS, 42 tests, 0 failures/skips; APK SHA-256 `1300F5887D68EF27005C1BA8E6D7B80CE9DC74F382E7051C303598B4AC82C8D7`. `git diff --check` PASS (exit 0; line-ending advisories).
- **Not run:** physical handset/board, staging API, DB, Wi-Fi transfer, firmware build/flash, redemption, Event/FCM or reboot.
- **Status:** `PARTIALLY COMPLETED`; detailed report: `docs/audits/wp14-20-run-061-provisioning-context-recovery.md`.

## WP14-RUN-062 — Force direct no-proxy SoftAP HTTP

- **Timestamp:** 2026-11-06 Asia/Saigon. Existing dirty worktree preserved.
- **Evidence:** User monitor shows SoftAP, DHCP and enrollment proof response; on Connect, phone joins/gets DHCP, leaves about 20 seconds later, but firmware has no handshake-handler entry. Backend only shows claim completion and provisioning session, expected because handshake is local. This proves failure before/at local handshake transport but not the exact historical socket failure or whether the tested APK included RUN-059/061.
- **Fix:** local commissioning HTTP now explicitly uses `Proxy.NO_PROXY` and the granted SoftAP `Network`; connect timeout is 5 seconds and response timeout 20 seconds. Safe logs distinguish timeout before response headers versus response-body wait. No API or firmware contract changed. This removes implicit proxy selection but awaits physical verification to establish outcome.
- **Fresh verification:** Owner tests/APK PASS, 42 tests, 0 failed/skipped; APK SHA-256 `3A243C9A19DF4FD76AF4BB317CF5A0EAB5F7D96493BFC5270FFAC2F30D7926D1`. `git diff --check` PASS, exit 0 (line-ending advisories).
- **Not run:** physical install/board, staging, DB, credential transfer, redemption, Event/FCM, firmware build/flash, reboot.
- **Status:** `PARTIALLY COMPLETED`; details in `docs/audits/wp14-21-run-062-direct-softap-http.md`.

## WP14-RUN-063 — Install current APK for handshake correlation

- **Timestamp:** 2026-11-06 Asia/Saigon. ADB found connected Android 15 device model `23021RAAEG`.
- **Action:** installed current debug APK with `adb install -r` (Success), SHA-256 `3A243C9A19DF4FD76AF4BB317CF5A0EAB5F7D96493BFC5270FFAC2F30D7926D1`; launched package `com.pulselink.owner`. This confirms current artifact is installed, but does not identify whether earlier user attempts used it.
- **Diagnosis:** supplied board log has AP join/DHCP and ~20s later client leave, without `handshake request received`; backend ends at provisioning session as expected for local handshake not yet completed. Current APK explicitly disables proxy on SoftAP HTTP. Exact socket failure remains unproven without logcat from this installed build, so no further firmware/backend change was made.
- **Not run:** no claim/provisioning API call, DB operation, Wi-Fi transfer, board serial/flash/reset, redemption, Event/FCM, or reboot. Awaiting operator retry with correlated Android and board logs.
- **Status:** `PARTIALLY COMPLETED`; evidence and next diagnostics: `docs/audits/wp14-22-run-063-installed-apk-handshake-correlation.md`.

## WP14-RUN-064 — Make SoftAP HTTP request framing explicit

- **Timestamp:** 2026-11-06 Asia/Saigon. Existing dirty worktree preserved.
- **Evidence:** Board receives station association and DHCP during Connect, but no handshake handler entry; client leaves after app's 20s timeout. ADB logcat could not be collected because `adb devices -l` was empty. Thus exact physical socket phase/root cause remains unverified. Backend logs ending at provisioning-session/list are expected for a local handshake failure.
- **Change:** commissioning POSTs now force fixed Content-Length and `Connection: close`, remain pinned to granted SoftAP Network with `Proxy.NO_PROXY`, and log safe timeout phase (`connect`, `write_request`, `response_headers`, `response_body`). No payload/contract change.
- **Fresh verification:** Android tests/build PASS, 42/42; APK SHA-256 `35E0CAF4C97C44C7FB2058AB891983C849A524C764A2DCBD090FC3C1CA9B61F7`. `git diff --check` PASS, exit 0 (line-ending notices only).
- **Not run:** handset install (ADB disconnected), board/firmware, staging/backend, DB, Wi-Fi transfer, redemption, Event/FCM or reboot.
- **Status:** `PARTIALLY COMPLETED`; report: `docs/audits/wp14-23-run-064-local-http-framing-diagnostics.md`.

## WP14-RUN-065 — Wait for Internet before Owner API status polling

- **Timestamp:** 2026-11-06 Asia/Saigon. Existing worktree changes preserved.
- **Root cause:** physical logs show local handshake/credential requests return 200, firmware acquires venue IP and backend receives redemption. Owner app then immediately polls Store devices after unbinding from Internet-less SoftAP; Android's default validated Internet route may not yet be restored. No post-redemption devices GET appears, consistent with first poll failing before backend. Catch showed generic “Unable to confirm Device Status.” Backend redemption incoming log alone does not prove transaction success. `status=PENDING` can remain until authenticated Event; redemption sets provisioningState PROVISIONED.
- **Fix:** reuse `InternetNetworkWaiter` to wait up to 30s for validated default Internet before the first backend status request; progress and timeout errors now identify that network handoff.
- **Fresh verification:** Owner tests/build PASS, 42/42. APK SHA-256 `CDAA08C9CCE282F883B16ECA22BB60FC1FDA3924EC48F68E6B47BD024F5F2E0B`. `git diff --check` PASS.
- **Install:** ADB install attempted; handset returned `INSTALL_FAILED_USER_RESTRICTED: Install canceled by user`. Fix is not yet running on phone.
- **Not run:** no additional staging API, DB, Wi-Fi credential transfer, firmware build/flash, Event/FCM or reboot.
- **Status:** `PARTIALLY COMPLETED`; report: `docs/audits/wp14-24-run-065-wait-for-owner-network.md`.

## WP14-RUN-066 — Fix authenticated status key-type mismatch and recover queued Events

- **Timestamp:** 2026-11-06 Asia/Saigon. Preserved the existing dirty worktree; no reset/clean.
- **Root cause:** the post-redemption status probe compared the local commissioning identity public key to backend `Device.deviceKey`, which the claim service sets to the operational bearer token. The authenticated status response could therefore be rejected as malformed even after TLS and token authentication. Firmware then did not enter `COMMISSIONING_ONLINE`, so Event sender stayed paused. Supplied firmware output also proves GPIO4's new event was rejected because all eight persistent queue slots were occupied. Previous blocked entries were never retried after credentials were refreshed.
- **Changes:** status probe now verifies the authenticated Device ID and `PROVISIONED`/`ENROLLED` state without comparing different key types. A successful probe transitions runtime online and safely requeues existing BLOCKED events, preserving their event IDs/payloads and persisting before notification. Added queue counts and safe status/sender/ACK diagnostics. No event queue or NVS data was cleared.
- **Fresh verification:** ESP-IDF 5.5.5 staging reconfigure/build **PASS**, image 979,120 bytes of 1 MiB, 69,456 bytes free (~6.6%), SHA-256 `0BB1EDA3AD2DD97EE7C0E808803413C9E4A195AA5102A3272F8C77429B85E071`. Focused backend suites: **49 passed / 0 failed / 0 skipped** across 10 files. Host C suite **NOT RUN** because Docker Desktop was unavailable and WSL was denied; no native Windows C compiler was installed. `git diff --check` result is recorded in RUN-066 report.
- **Not verified:** serial/COM port was not present in this environment, so no firmware flash or physical retest. No staging API calls, DB writes/migrations, FCM/email, NVS erase, eFuse or reset occurred. Android sources were unchanged; no APK build/install.
- **Status:** `PARTIALLY COMPLETED` — source fix and staging firmware build pass; physical Event commit/ACK and ONLINE/recovery require flashing this artifact and observing the board. Details: [`WP14-RUN-066`](wp14-25-run-066-device-event-auth-and-queue-recovery.md).
