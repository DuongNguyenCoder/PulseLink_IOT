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
