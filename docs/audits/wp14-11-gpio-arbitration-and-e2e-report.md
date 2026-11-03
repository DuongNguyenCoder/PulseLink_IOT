# WP14-RUN-043 — GPIO4/GPIO5 Arbitration and Commissioning Validation

**Time:** 2026-10-29 14:04 +07:00 (Asia/Saigon)  
**Git HEAD:** `02aed7aa9427086e5a42242ae58745ce6f31cea4`, branch `main`  
**Result:** `PARTIALLY_COMPLETED — SOFTWARE ARBITRATION FIX VERIFIED; GPIO5 WIRING AND PHYSICAL E2E NOT VERIFIED`

## Summary

RUN-042 found that GPIO4 had two independent consumers: the normal Device Event button and the commissioning long-press gate. The RUN-043 staging profile now assigns GPIO4 only to the Event button and GPIO5 only to commissioning. Event debounce and physical confirmation use separate state, duplicate pin assignment is rejected at compile time and runtime, and a commissioning button already low when the gate starts cannot count as a new gesture until released and pressed again. The commissioning button path does not call or persist an Event. Existing queued Events are not cleared.

The firmware build, C host suite, Android JVM tests/APK build and focused backend tests passed. GPIO5 has no other assignment in the firmware source/configuration reviewed, but there is no carrier schematic or revision-specific pinout in the repository. COM4 is present as a serial port name, but board identity and the electrical GPIO5 connection are not confirmed. The port was not opened; firmware was not flashed. Physical Wi-Fi commissioning, redemption, backend ONLINE, Event/ACK, notification and reboot recovery remain unverified.

## Starting state and scope

HEAD was `02aed7aa9427086e5a42242ae58745ce6f31cea4`, branch `main`; the worktree already contained the RUN-040/041 changes and RUN-042 audit. Those changes were preserved. No backend code or DB schema changed. No staging API request, database write, claim, provisioning session, Wi-Fi transfer, Event, notification, eFuse/security-fuse action, flash, erase or reset was performed. COM4 was enumerated read-only and not opened.

## Implementation

1. Staging now sets `CONFIG_PULSELINK_BUTTON_GPIO=4` and `CONFIG_PULSELINK_COMMISSIONING_BUTTON_GPIO=5`. Kconfig's commissioning input default is 5. The Owner prompt labels GPIO5 as commissioning and GPIO4 as Event.
2. `event_button.c/.h` isolates Event input edge/debounce logic from commissioning confirmation. Event enqueue remains at the same debounced active-low press and the caller records successful durable enqueue. A LOW state at task initialization is treated as already pressed, so it does not enqueue on boot; release and a fresh stable press are required.
3. A compile-time check rejects equal Event/commissioning GPIO values for a commissioning-enabled build. `button_gpio_assignments_valid()` provides an additional fail-closed runtime check.
4. `physical_confirmation_start_level()` initializes the commissioning input from its sampled level. If GPIO5 is LOW when the confirmation task begins, that held-at-start state cannot satisfy the long-press proof; the user must release and press again. The existing 50 ms edge debounce, 1,500 ms hold threshold, accept-on-release behavior, 30-second confirmation deadline and lifecycle state machine remain.
5. Timing documentation is corrected: both deadlines start when `commissioning_gate_task()` starts after Wi-Fi initialization. The 30-second physical confirmation window is not from a verified chip-boot timestamp. The five-minute lifecycle deadline begins at the same gate-task start and is not restarted on press; the SoftAP, opened after an accepted gesture, is bounded by that original deadline.
6. No event queue clearing or Device Event/API contract change was made.

### Pin mapping evidence and physical limit

Repository search found no existing GPIO5 reference for SPI, UART, I2C, JTAG, LED, reset, or another firmware peripheral. The staging output sdkconfig confirms Event=4 and Commissioning=5. Source configures both as active-low inputs with internal pull-up, pull-down disabled and interrupts disabled.

The repository contains no schematic/carrier-board pin map. The active-low button-to-GND assumption is firmware logic only; actual switch routing, external circuitry, board revision and whether GPIO5 is exposed/available remain `UNVERIFIED`. No board-specific electrical safety conclusion is made from the module name alone. Consequently the built image is **not authorized for flash or button operation based on this source review alone**.

## Test coverage

The new deterministic host test executable exercises:

- GPIO4 stable short/long press produces one enqueue action; continuous hold does not repeat.
- Minimum debounce and press edge consumption.
- GPIO4 LOW at initialization does not enqueue; fresh release/repress works.
- GPIO5 short press is rejected; valid hold and release accepts once.
- GPIO5 activity does not invoke the Event path and preserves an existing queued Event.
- GPIO4 activity does not transition commissioning.
- Interleaved activity across both independent state objects.
- GPIO5 LOW at gate startup requires release and a fresh valid gesture.
- Physical-window expiry and terminal lifecycle prevent SoftAP acceptance.
- Duplicate/invalid GPIO assignment validation.

These are host state-machine tests, not FreeRTOS concurrency, physical GPIO, NVS runtime or board evidence. Separate input pins and state objects remove the former shared-input race; actual electrical bounce and scheduling were not tested on hardware.

## Fresh verification

| Command or check | Result |
| --- | --- |
| `docker run --rm --network none --read-only --tmpfs /tmp:rw,exec,nosuid,size=128m --mount type=bind,src=D:/project-PulseLink,dst=/src,readonly --workdir /src/firmware/esp32 gcc:13.2.0-bookworm sh tests/run_host_tests.sh` | `PASS`, exit 0; 11 runners passed, 0 failed, 0 skipped. Includes `event-buttons` plus the existing 10 runners. |
| `.\gradlew.bat :owner:testDebugUnitTest :owner:assembleDebug --rerun-tasks` | `PASS`, exit 0; `BUILD SUCCESSFUL`; 41 tasks executed; 21 JVM tests passed, 0 failures/errors/skipped. APK: `apps/android-fcm-test/owner/build/outputs/apk/debug/owner-debug.apk`, 3,966,318 bytes. SHA-256 `5F77B5D6B2429508DF8ADB178F1C43485A7CBF63A7ACD82B80391AD5F935D6C7`. No APK install/launch in RUN-043. |
| ESP-IDF 5.5.5 staging build (isolated `build/staging-run043`, target `esp32s3`, one Ninja job, defaults `sdkconfig.defaults;sdkconfig.commissioning-mvp.defaults;sdkconfig.staging.defaults`) | `PASS`, exit 0. Compiled and linked `main.c`, `event_button.c`, `physical_confirmation.c`; effective sdkconfig confirms commissioning enabled, GPIO4/GPIO5 split, NVS encryption disabled. Image `0xebdd0` = 966,096 bytes; `0x100000` app partition leaves `0x14230` = 82,480 bytes (~7.9%). Build emitted a non-fatal missing `ESP_ROM_ELF_DIR` gdbinit warning. |
| Focused backend regression: `npm test -- --run src/modules/provisioning src/modules/device-status src/modules/device-events` | Initial sandbox attempt failed before test startup with `spawn EPERM`; elevated retry `PASS`, exit 0; 10 test files, 48 tests passed. Backend source was unchanged. Not PostgreSQL/staging integration. |
| COM enumeration: `[System.IO.Ports.SerialPort]::GetPortNames()` | `COM4` listed. No serial open, VID/PID/board identity not established. The follow-up PnP query returned no usable identity evidence (command exit 1). |
| `git diff --check` | `PASS`, exit 0 after final documentation edits; LF/CRLF advisories only. |

### Failed attempts retained

- First C host invocation failed before container startup because Docker Desktop Linux engine pipe access was denied. The escalated invocation reached tests and exposed an expiry assertion error in the new test harness; the harness was corrected to model the production lifecycle expiry call. A later complete run printed all 11 PASS runners but exited 1 because the runner script still expected 10; the expected count was corrected to 11. The final run passed.
- Initial staging build using the existing `build/staging/sdkconfig` was rejected by the new compile-time guard because that persisted config still had both pins set to GPIO4. This validates the duplicate-pin guard; the old generated config was preserved. A first isolated build lacked the Xtensa compiler in PATH; the corrected invocation still needed the installed compiler path. The isolated build then passed with explicit staging defaults and left the old build directory untouched.
- Initial Android Gradle invocation was denied access to the existing wrapper lock; the elevated rerun passed.
- Initial backend focused test invocation failed in Vite config loading with `spawn EPERM`; elevated rerun passed.
- No failure was bypassed or hidden; assertions were not weakened.

## Artifact and E2E status

- Firmware: `firmware/esp32/build/staging-run043/pulselink_firmware.bin`, 966,096 bytes, SHA-256 `992E372B00811E4A1165F8E8E61485AFE5776CCF1CD351673D222531A2359E31`.
- Partition headroom: `0x14230` bytes / 82,480 bytes in the 1 MiB app partition.
- APK and hash are listed above.
- Staging profile uses ordinary NVS; `CONFIG_NVS_ENCRYPTION` is unset. Identity and operational credential remain extractable from raw flash; no at-rest protection is claimed.
- COM4 port name is present, but the target board is not verified. No schematic, board revision proof or safe GPIO5 wiring evidence is in the repository.
- No physical action: no flash/readback, button press, SoftAP connection, Wi-Fi credential entry, Owner claim, provisioning session, redemption, ONLINE observation, Device Event, ACK, notification delivery or reboot recovery.

| Acceptance evidence | Status |
| --- | --- |
| Source GPIO4/GPIO5 split and duplicate guard | `PASS — SOURCE_VERIFIED` |
| Deterministic host state and lifecycle tests | `PASS — HOST_TEST_PASS` |
| ESP-IDF staging build and partition limit | `PASS — FIRMWARE_BUILD_PASS` |
| Android unit tests and APK | `PASS — ANDROID_BUILD_PASS` |
| Backend focused claim/status/Event tests | `PASS — BACKEND_TEST_PASS` |
| PostgreSQL test DB integration | `NOT RUN` — backend unchanged; no DB operation required |
| GPIO5 carrier wiring/board pin availability | `BLOCKED / NOT VERIFIED` — no schematic or board revision evidence |
| Board image identity/flash verify | `NOT RUN` |
| Physical commissioning, Wi-Fi, redemption, ONLINE, Event/ACK, recovery | `NOT RUN` |

## Files changed in RUN-043

- `firmware/esp32/main/event_button.c`, `.h`: isolated Event-button edge/debounce state machine and GPIO assignment validation.
- `firmware/esp32/main/physical_confirmation.c`, `.h`: seed initial GPIO state; clarify wiring is an assumption.
- `firmware/esp32/main/main.c`: use independent GPIO roles, compile/runtime duplicate guards, safe boot-held handling.
- `firmware/esp32/main/CMakeLists.txt`: include new module.
- `firmware/esp32/main/Kconfig.projbuild`, `firmware/esp32/sdkconfig.staging.defaults`: commission input defaults to GPIO5; Event remains GPIO4.
- `firmware/esp32/tests/event_button_test.c`, `tests/run_host_tests.sh`: add 11 deterministic test cases and register the new runner.
- `apps/android-fcm-test/owner/.../MainActivity.java`: distinguish commissioning and Event buttons in user instructions.
- `docs/development/firmware-build.md`: document pin separation, wiring caveat and correct deadline origin.
- `docs/.gitignore`: allowlist this requested audit report.
- `docs/audits/wp14-9-end-to-end-commissioning-report.md`: update current summary.
- `docs/audits/wp14-engineering-log.md`: append RUN-043; preserve prior entries.
- `docs/audits/wp14-11-gpio-arbitration-and-e2e-report.md`: this report.

## Next safe actions

1. Obtain the carrier-board schematic or revision-specific pinout and verify GPIO5 is exposed, unoccupied and connected to its own button-to-GND circuit. Confirm GPIO4 remains the Event button.
2. Before any flash, independently identify the board on COM4 and confirm the recovery path and firmware artifact. Do not open a serial monitor or flash based solely on the COM4 name.
3. With that evidence, perform an explicitly authorized controlled hardware run: commissioning via GPIO5, then a single GPIO4 Event, verify backend commit/ACK and no Event from GPIO5, then reboot/recovery. Ordinary NVS exposure remains a known limitation.

RUN-043 did not write production/staging databases, run migrations, send FCM/email, erase flash or write eFuses. Overall commissioning remains `PARTIALLY_COMPLETED`; physical E2E is not claimed.
