# WP14-RUN-045 — Device Claim Root Cause and E2E Readiness

**Run time:** 2026-11-03 13:31 Asia/Saigon (UTC+07:00)  
**Git:** `02aed7aa9427086e5a42242ae58745ce6f31cea4`, branch `main`. The
worktree was already dirty before this increment; existing edits and generated
artifacts were preserved.  
**Result:** `PARTIALLY COMPLETED — SOURCE FIXES AND SOFTWARE CHECKS PASS;
PHYSICAL CLAIM/COMMISSIONING NOT VERIFIED`.

## Summary

The source confirms two firmware lifecycle defects relevant to the report:

1. The STA reconnect worker consumed a disconnect notification and called
   `esp_wifi_connect()` without checking that commissioning had switched the
   driver to SoftAP. This explains the observed `ESP_ERR_WIFI_MODE` warning.
   The worker did not itself stop the SoftAP.
2. The five-minute commissioning deadline began when the gate task started,
   before the user opened SoftAP. The provided logs show SoftAP mode beginning
   around tick 8.45 seconds and station mode returning around tick 300.7
   seconds. This is consistent with the original gate deadline expiring, but
   the excerpts do not establish the exact gate-task start tick or correlate
   it with the backend request timestamp. The observed delay is therefore
   supporting evidence, not a complete physical timing trace.

The app's generic error is emitted by a catch covering the claim-challenge
request/response parsing and the synchronous SoftAP request setup. The async
`onUnavailable`/`onLost` callbacks have separate messages. The supplied server
log proves an incoming request but does not include its response, and no
Android exception/stack trace was provided. Therefore the specific exception
that caused that particular UI message remains **UNVERIFIED**. The app now
maps safe HTTP/error categories and identifies the current stage without
exposing exception text or secrets.

`DeviceClaimSession` is expected: `POST /v1/stores/:storeId/device-claims`
creates a short-lived challenge. It is not the Device–Store relationship.
The relationship is created only after the board signs the claim proof and
`POST .../device-claims/:sessionId/complete` succeeds. Provisioning-session
creation and redemption are separate later operations. `APP_INSTALLATION_UPDATED`
does not establish any Device claim state.

## Implementation

- `commissioning_state_start_softap_window()` now starts the bounded five-minute
  deadline after SoftAP and its local HTTP server have started successfully.
  The physical confirmation window remains separate and bounded.
- `commissioning_wifi_mode_policy` prevents station reconnect attempts while
  an active commissioning state owns Wi-Fi mode. `main.c` serializes station
  connect/disconnect and SoftAP start/stop through a Wi-Fi mode mutex, verifies
  station mode before `esp_wifi_connect()`, and logs a deferred reconnect
  instead of surfacing the mode error.
- The commissioning timeout path now logs why the AP is stopped. A claim
  challenge/proof request does not stop SoftAP; the deliberate AP-to-STA switch
  remains tied to accepted encrypted Wi-Fi credentials.
- Owner app error handling now distinguishes authorization, missing Device,
  conflict, server/network failures and SoftAP setup failures using
  `ClaimStartFailure`. Incomplete challenge responses are rejected before AP
  connection begins. Public error messages do not contain raw exception data.
- The operator guide now documents the challenge-versus-claim distinction,
  five-minute timer origin, retry steps and the GPIO assignment: GPIO4 sends
  the Event, GPIO5 opens the commissioning confirmation flow.
- Backend contract and Device/Event routes were not changed. No database or
  staging API operation was performed.

## Contract trace

| Stage | Source and behavior | Evidence/status |
|---|---|---|
| Owner and Store | Android uses signed-in access token and selected Store ID; backend checks active OWNER membership. | Source reviewed; no staging request in this run. |
| Claim challenge | Android POSTs `/v1/stores/:storeId/device-claims`; backend creates a bounded `DeviceClaimSession` challenge. | Source reviewed; focused backend tests below. |
| Board proof | After Android obtains the matching SoftAP network, it requests the signed proof from `http://192.168.4.1` and submits it to `/complete`. | Source reviewed; not run against board. |
| Relationship | Backend verifies challenge, proof, Device and Store context, then persists the Device record/Store association transactionally. | Source and unit tests reviewed; no PostgreSQL test or staging write in this run. |
| Provisioning session | Android creates a provisioning session only after claim completion; this is not redemption. | Source reviewed. |
| Wi-Fi configuration | Android transfers commissioning data over the existing authenticated encrypted handshake. Firmware deliberately stops AP when it accepts the encrypted Wi-Fi configuration and starts Station work. | Source reviewed; physical transfer not run. |
| Station/redeem/storage/status | Firmware joins Wi-Fi, redeems session, persists operational credential and probes authenticated backend status. Ordinary NVS is used in this profile. | Not physically verified; no at-rest encryption claim. |
| Event/ACK | Event sender uses operational credential; backend derives Store from authenticated Device and commits before success response. | Source/contract not changed; no real Event sent in this run. |

## GPIO behavior

- GPIO4 remains the active-low Event button; a debounced press/release enters
  the Event path once.
- GPIO5 remains the active-low commissioning button; accepted hold/release
  does not enqueue a Device Event.
- Firmware source/config assigns separate pins. The repository has no
  carrier-board schematic or revision-specific wiring evidence; electrical
  GPIO4/GPIO5-to-GND wiring remains **NOT VERIFIED**.

## Fresh verification

| Command/action | Result |
|---|---|
| `docker run --rm --network none --read-only --tmpfs /tmp:rw,exec,nosuid,size=128m --mount type=bind,src=D:/project-PulseLink,dst=/src,readonly --workdir /src/firmware/esp32 gcc:13.2.0-bookworm sh tests/run_host_tests.sh` | PASS: 12 runners, 0 fail, 0 skip. Includes physical confirmation, Event button, lifecycle, Wi-Fi mode policy, credential storage, reachability and Event gate. |
| `idf.py` default ESP32-S3 build, isolated `build/wp14-claim-fix-default` | PASS: app `0x33810` bytes; `0xcc7f0` free in `0x100000` partition. |
| `idf.py` staging ESP32-S3 build, isolated `build/staging-run045` | PASS: app `0xec1d0` / 967,120 bytes; `0x13e30` / 81,456 bytes free (about 8%). App SHA-256 `0519CACD53E9DB94169220CB620599BF055739F8F5DF6451BBCC7AC0CC24C360`. |
| `npm test -- --run src/modules/provisioning/device-claim.service.test.ts src/modules/provisioning/provisioning.routes.test.ts` | PASS after retry outside sandbox: 2 files, 7 tests passed. Initial sandbox execution failed before test startup with Vite `spawn EPERM`. |
| `.\gradlew.bat :owner:testDebugUnitTest :owner:assembleDebug --rerun-tasks` | PASS: 24 JVM tests, 0 failures, 0 errors, 0 skipped; APK built. |
| `adb install -r apps/android-fcm-test/owner/build/outputs/apk/debug/owner-debug.apk` and `adb shell monkey -p com.pulselink.owner 1` | PASS: APK installed and app launch intent delivered to connected Android phone. This is launch smoke evidence only; no sign-in, API, Store, QR, Wi-Fi or commissioning flow was exercised. |
| APK artifact | `owner-debug.apk`, 3,966,318 bytes; SHA-256 `26D04E0D24D0ECFC78CA71DB2293077447E95A843FF58299F87F09ED6A064808`. |
| Default build sandbox attempt | BLOCKED before compiler execution: Windows `WinError 5` creating Ninja subprocess. The identical build outside sandbox succeeded. |
| `git diff --check` | PASS, exit 0 after report/log edits; Git emitted existing LF/CRLF advisories only. |

ESP-IDF emitted a non-fatal warning because `ESP_ROM_ELF_DIR` was not set; the
build completed successfully. No PostgreSQL integration test, Prisma
migration, backend typecheck/build, or staging API call was needed for this
firmware/Android-only code increment. Historical backend and database evidence
is not claimed as fresh here.

## Board and physical E2E

| Step | Status | Evidence |
|---|---|---|
| Board port enumeration | PASS (USB interface only) | `pnputil` reports COM4, Espressif VID `303A`, PID `1001`. |
| Fresh chip identity | BLOCKED | `esptool --chip auto --port COM4 chip_id` returned access denied: COM4 is busy. Prior RUN-044 chip identification is historical. |
| Flash current RUN-045 image | BLOCKED / NOT RUN | No flash command issued because the port is busy and chip identity could not be freshly confirmed. Existing RUN-044 image remains the last reported verified image; RUN-045 build is not on the board. |
| Flash readback | NOT RUN | No current-image write/readback. |
| Android installation/launch | PASS | Connected phone accepted install and launch. |
| GPIO5 / SoftAP / claim / persisted Store relationship | NOT VERIFIED | No button pressed and no staging request sent. |
| Encrypted Wi-Fi transfer / Station / redemption / authenticated ONLINE | NOT VERIFIED | No Wi-Fi credential was transmitted. |
| GPIO4 Event / backend commit / ACK / FCM | NOT VERIFIED | No Event or notification was generated. |
| Reboot recovery | NOT VERIFIED | No reboot/recovery test performed. |

The COM4 open attempt was read-only chip identification, which can toggle
RTS/reset; it failed before opening the port. The port remains busy. No serial
monitor was opened. No claim, provisioning session, Wi-Fi configuration,
Device Event, PostgreSQL write, FCM/email delivery, NVS erase, flash write,
eFuse write or security-mode change occurred in this run.

## Operator procedure

1. Close the process currently holding COM4, then confirm the USB device and
   chip identity. Do not erase NVS. Flash RUN-045's staging image only after
   confirming the port is the intended board and its recovery path.
2. Confirm carrier-board wiring: GPIO4-to-GND is Event; GPIO5-to-GND is
   commissioning. Hold GPIO5 low for at least 1.5 seconds and release within
   the physical confirmation window. The five-minute SoftAP window begins
   after the AP and HTTP server have started.
3. In Owner app, sign in, select the intended Store, scan/enter public Device
   ID and tap **Claim Device and prepare Wi-Fi**. Accept Android's prompt to
   join `PulseLink-XXXX`. Wait for signed board proof and backend claim
   confirmation; a challenge row alone is not success.
4. Enter the venue 2.4-GHz Wi-Fi details when prompted and send encrypted
   configuration. Wait for backend authenticated status. Only then press
   GPIO4 once to request the Event; verify the Event/ACK and Store status.
5. Verify notification separately. Reboot/recovery and re-pairing require
   separate observation; do not infer these from build or API status.

If COM4 remains busy, identify and close its owner before retrying. Do not
terminate an unknown process or flash blindly. If the app reports claim
failure, record the safe app stage/message and backend request ID/response
status; do not copy proof or credentials into logs.

## Remaining blockers

1. Release COM4 and freshly verify the ESP32-S3 target before writing the
   RUN-045 image; then verify the written bootloader, partition table and app.
2. Confirm physical carrier-board wiring for GPIO4/GPIO5.
3. Run the Owner claim flow on the phone and capture redacted app/backend
   status/request correlation; verify the Device–Store relationship in the
   approved staging environment.
4. Complete Wi-Fi transfer, redemption, authenticated ONLINE, GPIO4 Event,
   commit/ACK, notification and reboot recovery on hardware.
5. Operational credential and identity are still stored in ordinary NVS;
   this firmware provides no at-rest confidentiality guarantee.

