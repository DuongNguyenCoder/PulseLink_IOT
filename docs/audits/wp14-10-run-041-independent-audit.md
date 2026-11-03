# WP14-RUN-042 — Independent Audit of RUN-041 and Physical E2E Readiness

**Date:** 2026-10-29, Asia/Saigon (UTC+07:00)  
**Git:** `02aed7aa9427086e5a42242ae58745ce6f31cea4`, branch `main`  
**Overall:** `PARTIALLY COMPLETED`; physical commissioning via GPIO4 is `BLOCKED` pending a reviewed button/event arbitration change.

## Scope and safety

This audit compared the current working tree, RUN-041 log/report, source, staging build outputs, backend/Android contracts and fresh software tests. The worktree was already dirty at start and was preserved. No firmware, Android or backend source was changed in RUN-042; changes are limited to this audit report, the WP14 summary and append-only engineering log, plus the docs ignore allowlist so the explicitly requested report is visible to Git.

No COM port or serial device was opened. No board action, flash, reset, erase, eFuse/security change, claim, provisioning-session creation, Wi-Fi credential transfer, Device Event, staging API call, database write, FCM or email action was performed. In particular, the documented GPIO4 commissioning gesture was not attempted.

## Findings table

| Claim | Evidence | Result | Confidence |
| --- | --- | --- | --- |
| GPIO4 is configured for both commissioning and ordinary button Events in the RUN-041 staging profile. | `firmware/esp32/sdkconfig.staging.defaults`: `CONFIG_PULSELINK_COMMISSIONING_BUTTON_GPIO=4` and `CONFIG_PULSELINK_BUTTON_GPIO=4`; `main.c` configures both input paths with pull-up enabled, pull-down disabled, interrupts disabled. | `PASS` (source/config fact); physical wiring remains `UNVERIFIED`. | High for build config/source; none for actual board wiring. |
| A stable press can enqueue a normal Device Event while commissioning is active. | `button_task()` sees active-low, waits `BUTTON_STABLE_MS` (50 ms), then calls `enqueue_button_event()` on press; no lifecycle check is present in that task. `enqueue_button_event()` writes the queue to NVS. | `PASS` (confirmed behavior in source). | High. |
| Event sender suppresses commissioning-time Events entirely. | `event_sender_task()` waits while lifecycle is not `COMMISSIONING_ONLINE`; the event is already queued and persisted by then. | `FAIL` (sender delays delivery; it does not prevent enqueue or discard the gesture). | High. |
| Holding GPIO4 for ≥1.5 seconds triggers physical commissioning only. | `physical_confirmation_sample()` accepts on debounced release after a stable hold reaches 1,500 ms; ordinary `button_task()` independently enqueues on the press edge. | `FAIL` for exclusivity; the same gesture can queue an ordinary Event. | High. |
| Commissioning hold is permitted for 30 seconds after device boot. | The 30-second gate starts in `commissioning_gate_task()` when that task runs after `wifi_start()`, not at a measured chip-boot timestamp. It polls every 10 ms. | `UNVERIFIED` as exact “after boot” timing; source shows the start point is gate-task startup. | High for source, none for wall-clock board timing. |
| Long press is detected while the button remains held. | The physical state machine accepts after it observes a stable release; stable press records start time. | `FAIL`; acceptance occurs on release, not while held. | High. |
| A press during commissioning can produce duplicate Events from the hold/release pair. | The ordinary button handler only enqueues on stable pressed transition, not release. It has a 5-second minimum debounce between accepted presses. | `PASS` for one stable hold producing at most one enqueue in the usual task flow; repeated presses after debounce can enqueue again. | High for source logic; physical switch behavior not tested. |
| SoftAP timeout is five minutes from button press. | `commissioning_begin(..., COMMISSIONING_PAIRING_WINDOW_MS)` is called before the physical gesture in `commissioning_gate_task()`. Lifecycle expiry uses that deadline. | `FAIL`; the five-minute budget starts when the gate task starts, so time spent waiting for the press consumes it. The separate physical-confirmation window is 30 seconds from the same task start. | High. |
| App can use a Device ID alone to claim a Device. | Backend `createDeviceClaimSession()` requires Owner membership and board proof; `completeDeviceClaim()` verifies challenge, expiry, session binding and signature before creating the Device. | `FAIL` for ID-only authorization; QR/manual ID is identification only. | High from source/tests. |
| A same-Store already-claimed Device can continue through provisioning. | Backend returns `alreadyClaimed`; Android displays a prompt to create a provisioning session. The path is available, but is a separate user action. | `PASS` for supported continuation; not automatic. | High from source. |
| Device in another Store can be transferred by this claim flow. | Backend claim service rejects an existing Device unless it is active/enrolled in the same Store. | `FAIL` (transfer intentionally unavailable through this contract). | High. |
| Android validates the selected Store and API origin with an allowlist. | Store field is trimmed/nonblank; API path components are encoded. `ApiClient` requires an `https://` prefix and parses URI, but has no host allowlist. | `PARTIAL`; basic format/path handling exists, origin is not restricted to an approved host. | High. |
| Android scans arbitrary Wi-Fi SSIDs or silently joins any AP. | `SoftApConnection` uses Android 10+ `WifiNetworkSpecifier`, removes INTERNET capability and binds the process to the requested network; app derives expected `PulseLink-XXXX` from the public Device ID. | `PASS` for requested-SSID handoff flow; Android approval and device compatibility remain runtime dependent. | High for code, not physical behavior. |
| Wi-Fi credentials are sent in plaintext over the SoftAP. | Firmware local HTTP credentials endpoint decrypts the session AEAD payload and clears password buffers. Android performs handshake and `sendCredentials()` with the derived session. Local HTTP is inside the authenticated encrypted protocol; this audit did not send credentials. | `PASS` for source protocol shape; runtime interoperability not verified here. | Medium-high. |
| Device becomes ONLINE on Wi-Fi association alone. | Firmware backend reachability uses bearer-authenticated `/v1/device-status`, checks expected Device identity/key and `PROVISIONED`/`ENROLLED`; backend event service marks DB Device `ONLINE` and updates `lastSeenAt` in the event transaction. | `PASS` that association alone is insufficient; firmware ONLINE and backend persisted status are separate stages. | High for source, runtime unverified. |
| Event is authenticated and committed before ACK. | Event service authenticates bearer token, transactionally creates event, updates Device, creates notification intent; route responds only after service returns. Unique `eventId` conflict is read back and payload equivalence checked. | `PASS` in implementation contract; physical delivery and PostgreSQL runtime were not tested in RUN-042. | High for source; no fresh integration evidence. |
| RUN-041 staging image was built and flashed/read-back verified. | RUN-041 log reports successful `write_flash` and `verify_flash`, digest matched for bootloader/partition/app. Local staging artifacts still exist and current hashes can be calculated. No retained separate readback dump/hash is recorded for independent byte comparison. | `FLASH_COMMAND_REPORTED_SUCCESS` and `FLASH_READBACK_VERIFIED` as historical esptool report; current board/source identity `UNVERIFIED`. | High for historical command record; medium for artifact-to-board equivalence. |
| Current local staging build matches the previously flashed image. | Fresh RUN-042 build recreated the staging artifact. RUN-041 log does not record a comparable artifact SHA-256/readback dump hash. | `UNVERIFIED`; a build success cannot establish current board contents. | High. |
| Physical commissioning/runtime succeeded. | No claim, Wi-Fi, redemption, status probe, event, push receipt or reboot recovery was run in RUN-041 or RUN-042. | `NOT VERIFIED`. | High. |

## GPIO4 analysis — highest-priority blocker

### Configuration and electrical assumptions

The staging profile assigns both `CONFIG_PULSELINK_COMMISSIONING_BUTTON_GPIO` and `CONFIG_PULSELINK_BUTTON_GPIO` to GPIO4. `app_main()` configures each path as input, pull-up enabled, pull-down disabled, interrupts disabled. `physical_confirmation_sample_level()` interprets level 0 as pressed. This is consistent with an active-low button wired from GPIO4 to ground, but `physical_confirmation.c` contains only a comment asserting “verified wiring”; this audit found no schematic or hardware measurement proving the actual carrier-board wiring. Therefore the electrical wiring is `UNVERIFIED`.

### What a long press does in source

`button_task()` starts before `wifi_start()`. It polls every 10 ms; after a low level remains stable for 50 ms it invokes `enqueue_button_event()` immediately on the pressed transition. That function creates an event ID and timestamp, stores a pending event in the NVS event queue, then notifies the sender task. This queue write is independent of commissioning lifecycle.

`commissioning_gate_task()` starts after `wifi_start()`, initializes a 5-minute lifecycle deadline and starts a separate 30-second physical-confirmation window. The physical confirmation state machine debounces both edges and considers the gesture accepted only on a debounced release after a hold of at least 1.5 seconds. The gate then starts the SoftAP. It does not coordinate with or suppress `button_task()`.

The event sender checks lifecycle and waits while not `COMMISSIONING_ONLINE`; it does not remove the already queued event. Thus the usual GPIO4 long press first queues a business Event, then opens SoftAP on release. If provisioning later reaches ONLINE, the pending Event may be sent and produce a backend Event/notification. This audit did not send it. A very early pin state present before the first `button_task()` sample may not produce an edge; this timing corner does not make the documented gesture safe.

The 5-second ordinary button debounce prevents another accepted press within that interval; a single continuous hold does not enqueue on release. Distinct later presses after debounce can enqueue additional Events. No source-level mux, gesture reservation, suppression, or commissioning lifecycle guard exists around event enqueue.

### Safety conclusion and smallest remediation

**Do not instruct anyone to press/hold GPIO4 to open commissioning while the current staging firmware is running.** This path is `BLOCKED`: it can enqueue a persistent ordinary Device Event before the commissioning gesture is accepted, with possible later backend commit and notification.

Smallest candidate remediation, not implemented in this audit: either (a) use a distinct commissioning input only after the actual board schematic/wiring is confirmed, or (b) implement explicit GPIO gesture arbitration so the commissioning long-press is reserved and its initial press is not enqueued, while short presses in normal operational mode continue to produce exactly one Event. Simply gating the event sender is insufficient because the event is already persisted in the queue. Add deterministic tests for short press, long press, release, boundary timing, button held at boot, debounce, cancellation/expiry, and event queue contents. Review/approve the behavior before changing it; this audit intentionally made no hardware behavior change.

## Source/build/flash evidence classification

| Evidence class | RUN-042 result |
| --- | --- |
| `SOURCE_VERIFIED` | Current source/profile has both button GPIOs at 4; source paths and contract findings above. |
| `BUILD_VERIFIED` | Fresh ESP-IDF 5.5.5 staging-profile build passed; app image `0xebc90` (965,776 bytes). App partition `0x100000` (1,048,576 bytes), free `0x14370` (82,800 bytes, about 7.9%). Current local image SHA-256: `B02CD0146058D00F974DF9C177D6AB00F28ADF5BD0AB1793DAB71A6FF77F68F4`. |
| `FLASH_COMMAND_REPORTED_SUCCESS` | Historical RUN-041 log records `esptool write_flash` to COM4 at offsets `0x0`, `0x8000`, `0x10000`, successful exit. No flash command was run in RUN-042. |
| `FLASH_READBACK_VERIFIED` | Historical RUN-041 `verify_flash` reports “verify OK (digest matched)” for bootloader, partition and app. No separate readback binary/hash was retained for independent SHA-256 comparison in RUN-042. |
| `PHYSICAL_RUNTIME_VERIFIED` | No. RUN-042 did not open serial/COM4, query the board, or perform runtime operations. Board contents and wiring are not independently verified now. |

RUN-042 calculated local artifact hashes: bootloader `9523140A8199E4F0EFAAC2A01AB49162BF0708DDA5185EA5789AA64145B61244`; partition table `7F00B6C042A89B15B0CAC534F82ED988CAF29278FF5700B0C511EB1B5BB7C820`; Owner APK `B35B66D5AF617A4D8466E3F1ECFA3959226A681EEA5DBFA8936E4B2176514A3A`. These identify current local files only, not bytes independently read from the board. Staging config enables commissioning and operational credential storage, uses GPIO4 for both input roles, and has `CONFIG_NVS_ENCRYPTION=n`; ordinary-NVS secret exposure remains a limitation.

## RUN-041 tests vs RUN-042 fresh evidence

RUN-041 reported 10/10 C host runners, Android 21/21, APK build, ESP-IDF staging build, staging flash/readback, APK install and launch. The RUN-041 log is the evidence source; those physical actions were not repeated.

Fresh RUN-042 tests/builds:

| Command/action | Result |
| --- | --- |
| `docker run --rm --network none --read-only --tmpfs /tmp:rw,exec,nosuid,size=128m --mount type=bind,src=D:/project-PulseLink,dst=/src,readonly --workdir /src/firmware/esp32 gcc:13.2.0-bookworm sh tests/run_host_tests.sh` | `PASS`, exit 0; 10 host test runners passed, 0 failed, 0 skipped. These include physical confirmation, identity, lifecycle, transcript, crypto interoperability, storage, Wi-Fi controller, backend reachability, event gate and NVS-provider host contracts. Not hardware evidence. |
| `.\gradlew.bat :owner:testDebugUnitTest :owner:assembleDebug --rerun-tasks` | `PASS`, exit 0; Gradle `BUILD SUCCESSFUL`; 41 actionable tasks; XML reports count 21 tests, 0 failures/errors, 0 skipped. APK is 3,966,318 bytes. No RUN-042 app install/runtime action. |
| ESP-IDF 5.5.5 staging build, target `esp32s3`, single-job Ninja, staging sdkconfig/profile | `PASS`, exit 0; image `0xebc90`, free `0x14370` bytes. No flash. |
| `npm test -- --run src/modules/provisioning src/modules/device-status src/modules/device-events` | Initial sandbox attempt failed before test loading with Windows `spawn EPERM`; elevated retry `PASS`, exit 0; 10 files, 48 tests passed. These are focused backend tests, not staging/PostgreSQL integration. |
| `git diff --check` | `PASS`, exit 0; only LF/CRLF conversion advisories. |

No PostgreSQL integration test, backend typecheck/build, staging API request, FCM delivery test, SoftAP, Wi-Fi, board status, Event ACK, reboot recovery, COM4 inspection, physical Android interaction or full E2E test was run in RUN-042. Existing historical evidence is not fresh evidence for these checks.

## Contract audit notes

- **Owner claim:** Android calls `POST /v1/stores/:storeId/device-claims`, receives `alreadyClaimed` for an active same-Store Device, otherwise gets a challenge and connects to the expected `PulseLink-XXXX` SSID to collect board proof. It completes claim via the protected `/complete` route; backend checks OWNER membership, session/account/Store/device binding, expiry and signature. It does not let QR ID alone authorize a claim. An already-claimed same-Store device is shown as available and requires a separate “Create provisioning session” action. Existing Device in another Store is rejected; transfer is unsupported.
- **API origin and Store ID:** API base accepts `https://` and parses the URI, but does not enforce a host allowlist. Store ID is manually selected/entered and checked nonblank; authenticated API authorization is authoritative. Path components are URL encoded. This is input hygiene, not a substitute for OWNER membership.
- **Wi-Fi handoff:** Android 10+ uses `WifiNetworkSpecifier`; user system approval may be required. It binds the app process while connected and clears binding on close. Android does not perform general silent SSID scanning. The app validates the expected SoftAP naming pattern from Device ID, but SSID is discovery only, not device identity proof.
- **Credential channel:** Local HTTP endpoint accepts handshake and encrypted configuration messages. Firmware validates authenticated session/proof and AES-GCM message before extracting SSID/password; buffers are cleared in source. Local HTTP is not TLS, so trust relies on the commissioning cryptographic channel. No credentials were transmitted in this audit.
- **ONLINE and Event:** Firmware status probe uses the operational bearer credential and validates the expected Device identity, key, provisioning and enrollment fields. Backend Device DB status becomes ONLINE with authenticated Device Event ingestion, transactionally with the Event and notification intents. A status GET is read-only; Wi-Fi association alone does not prove backend reachability. FCM delivery remains separate and was not verified.
- **Storage and TLS:** Firmware uses ordinary NVS for operational credential/identity in this staging configuration; NVS encryption is disabled. TLS CRT bundle validation is configured in the firmware; source does not use a certificate-validation bypass. At-rest confidentiality and physical extraction resistance are not provided by ordinary NVS.
- **Test character:** Backend mock/unit/route tests, Android JVM tests and C host-shim tests establish logic/contracts only. They do not establish backend staging behavior, PostgreSQL runtime, TLS connection from ESP32, actual button wiring, Wi-Fi association, notification delivery or physical E2E.

## Blockers and next actions

1. **GPIO4 button/Event conflict — BLOCKED, highest priority.** Do not press the button for commissioning on this firmware. Approve/use a separately confirmed commissioning input or approve a reviewed software gesture-arbitration change. The latter must suppress the commissioning gesture's ordinary Event at enqueue time, not merely defer sender; retain normal operational short-press Event behavior. Add host tests and build, then separately review/authorize hardware procedure.
2. **Board wiring — UNVERIFIED.** Obtain schematic/board revision evidence for GPIO4 active-low/button-to-ground before relying on the source comment.
3. **Currently flashed artifact — not independently hash-verified.** If exact board contents must be proven, an authorized safe readback procedure is needed; RUN-042 did not open COM4 or touch flash.
4. **Protected persistence — limitation, not a newly enabled blocker.** Ordinary NVS credential/key is extractable. Do not describe at-rest protection or reboot recovery as verified on board.
5. **No physical E2E.** Claim, encrypted Wi-Fi transfer, redemption, ONLINE, event/ACK, FCM delivery and reboot recovery remain unverified in this run.

Until blocker 1 is resolved, this report intentionally provides no instruction to press GPIO4 or continue physical pairing. No claim, provisioning session, Wi-Fi transfer or Event was performed. RUN-042 files changed: this report, `docs/audits/wp14-9-end-to-end-commissioning-report.md`, append-only `docs/audits/wp14-engineering-log.md`, and `docs/.gitignore` to unignore this specifically requested report.
