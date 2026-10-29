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
