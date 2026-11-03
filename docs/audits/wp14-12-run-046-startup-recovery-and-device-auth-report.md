# WP14-RUN-046 — Startup Recovery, Missing SoftAP and Device Authentication

**Run time:** 2026-11-03 14:03 Asia/Saigon (UTC+07:00)  
**Git:** HEAD `02aed7aa9427086e5a42242ae58745ce6f31cea4`, branch `main`.
The worktree was already dirty; prior changes were preserved.  
**Result:** `PARTIALLY COMPLETED — SOURCE FIXES AND SOFTWARE CHECKS PASS;
BOARD NVS AND RUNTIME AUTH STATE NOT VERIFIED`.

## Findings

### Why GPIO5 does not open SoftAP

The staging startup flow in `firmware/esp32/main/main.c` is:

1. Initialize NVS; fail without auto-erasing when NVS reports no free pages or
   a newer format.
2. Initialize the operational credential provider and Device identity
   provider. Load or initialize the per-device identity; malformed/lost
   initialized identity fails closed.
3. Read the operational credential. `COMMISSIONING_STORAGE_OK` with nonzero
   length means present. `UNAVAILABLE` means no stored record. `INVALID` or
   `IO_ERROR` is now treated as a startup storage fault.
4. Start Wi-Fi in STA mode. In the commissioning profile, configured SSID and
   password macros are ignored; `station_configured` is discovered from the
   Wi-Fi STA config already in NVS.
5. If both station configuration and a valid operational credential exist,
   select backend recovery, start authenticated status recovery and do not
   start `commissioning_gate_task`. The GPIO5 pin may be configured, but the
   30-second physical confirmation sampler is not started. Therefore GPIO5
   cannot open SoftAP in this branch.
6. If commissioning runtime is ready and the credential is absent, select
   commissioning; the gate samples GPIO5 active-low for the physical
   confirmation window. With both station config and no credential, STA can
   still reconnect while the gate waits. On accepted GPIO5 hold/release, the
   bounded SoftAP window starts.

This explains how the reported board can keep connecting to venue Wi-Fi while
never exposing SoftAP: saved STA configuration plus a stored operational
credential selects recovery. **The board's actual NVS contents were not read**
because COM4 was busy and no safe runtime diagnostic was available. Thus the
branch is source-verified, while which branch the current board took is
`NOT VERIFIED`.

Policy remains unchanged: a commissioned/recovery device does not become
reconfigurable merely because GPIO5 is pressed. We did not add a factory reset
or an implicit credential deletion/re-enrollment path. A separate, explicit
non-destructive recovery workflow is still required for an invalid/revoked
credential or changed venue Wi-Fi.

### Why backend returns 401 for Device Event

- In the staging compile profile, `CONFIG_PULSELINK_COMMISSIONING_ENABLED=y`
  and `CONFIG_PULSELINK_OPERATIONAL_CREDENTIAL_STORAGE=y`. The Event sender
  loads from the operational credential provider (`opcred` NVS), constructs a
  `Bearer` Authorization header and uses the configured HTTPS
  `/v1/device-events` endpoint. It does not use the build-time token in this
  profile. The Authorization value is cleared from temporary RAM after the
  request and never logged.
- Backend `authenticateDevice()` hashes the bearer token and looks for a
  matching `deviceSecretHash`. It rejects when no matching Device exists, the
  Device is disabled, enrollment is not `ENROLLED`, or provisioning is not
  `PROVISIONED`. The public error is generic 401; it deliberately does not
  reveal which condition failed.
- ESP-IDF 5.5.5 source shows the quoted HTTP_CLIENT warning is emitted after a
  response includes a `WWW-Authenticate` challenge that the configured client
  cannot handle (e.g. a challenge scheme other than enabled Basic/Digest). It
  returns `ESP_ERR_NOT_SUPPORTED`. This **does not prove** that the request
  lacked its Bearer header. The request source explicitly sets that header.
  The challenge may be from the API front end or another layer; no response
  headers were collected, so its origin is `UNVERIFIED`.
- Firmware previously treated a non-`ESP_OK` `esp_http_client_perform()` result
  as transport failure even when `get_status_code()` returned 401. Therefore
  the log showed `status=401 err=ESP_ERR_NOT_SUPPORTED` but entered the
  temporary retry loop. This was a confirmed classification bug and is fixed:
  400/401/403/409 responses are now retained as blocked, not ACKed and not
  retried indefinitely. Network errors and server failures remain retryable.
- Authenticated status and redemption had the same issue: they returned
  transport/retryable results before considering a received 401 status. They
  now classify a nonzero HTTP response status even when ESP-IDF reports
  `ESP_ERR_NOT_SUPPORTED`; recovery authentication failure is terminal and
  does not mark the Device ONLINE.

The exact reason this board's token is rejected remains **UNVERIFIED**. It may
be a token/hash mismatch (for example, credential rotation), or the Device may
not satisfy the backend state checks. No token was read, no backend DB query
was made, and no staging API request was issued. Do not copy or compare token
values in logs.

### HTTP smoke request

`http_smoke_task()` sends an unauthenticated GET to
`CONFIG_PULSELINK_BACKEND_URL` after STA receives an IP, only if that optional
URL is nonempty. It is separate from status and Event. RUN-046's staging
`sdkconfig` leaves this URL blank, so the smoke task is disabled in that
profile. The previous `ESP_ERR_HTTP_CONNECT` message can only be attributed to
a build with this optional URL enabled; the old log excerpt did not identify
which build/profile. Diagnostics now report a safe category (`dns`, TCP
connect/timeout, TLS handshake, HTTP auth/server/response, or transport), HTTP
status and socket errno, without logging URL, headers or response body.

## Changes made

- Added startup decision policy and host tests. Startup reports NVS init,
  identity presence (`yes/no/unknown-error`), credential load result,
  station-config presence, selected path, GPIO5 input setup and the 30-second
  physical confirmation start/end uptime. A credential storage `INVALID` or
  `IO_ERROR`, or unavailable commissioning runtime, now selects a blocked
  path; it cannot silently fall through into commissioning.
- Added shared HTTP response policy used by status and redemption adapters.
  A received 401 is classified even if `esp_http_client_perform()` returns an
  error due to an unsupported `WWW-Authenticate` challenge.
- Added Event response policy. Authentication/client rejection remains
  persisted as blocked; 401 log reports only credential source/presence and
  HTTP result. Retry preserves the event and its stable event ID for
  retryable transport/server errors.
- Added optional HTTP smoke failure classification and socket errno
  diagnostics. Existing staging config already disables the smoke URL.
- Updated operator guidance for the recovery-path/GPIO5 limitation and 401
  handling.
- Backend, API response/auth contract, database schema, Store ownership and
  notification behavior were not changed.

## Verification evidence

| Check | Result |
|---|---|
| C host suite, Docker `gcc:13.2.0-bookworm` | PASS: 15 runners, 0 failures, 0 skipped. Added startup selection, generic HTTP response and Event HTTP classification tests. |
| Backend focused tests: Device Event service/routes, Device status routes, provisioning service | PASS: 4 files, 20 tests. No backend source changed. |
| ESP-IDF 5.5.5 staging build, ESP32-S3, `build/staging-run046` | PASS. App `0xecae0` / 969,440 bytes; `0x13520` / 78,880 bytes free in 1 MiB partition (~7.5%). Image SHA-256 `21541FE1E23B0A440F9D99E5490DA36D7BF8EC56055BC22334C75CFF599028C0`. |
| ESP-IDF 5.5.5 default build, ESP32-S3, `build/default-run046` | PASS. App `0x33860`; `0xcc7a0` free (~80%). |
| Staging config inspection | `COMMISSIONING_ENABLED=y`, operational storage enabled, redemption and Event origins are HTTPS staging; `BACKEND_URL=""` disables smoke GET. This is local profile evidence, not remote deployment evidence. |
| Android | NOT RUN; no Android source/contract changed in RUN-046. |
| PostgreSQL integration/typecheck/build | NOT RUN; no backend implementation/schema changed. No DB was accessed. |
| `git diff --check` | PASS; exit 0. Git emitted only LF-to-CRLF advisories. |

The builds emitted a non-fatal ESP-IDF warning that `ESP_ROM_ELF_DIR` was
unset; compilation and image generation completed successfully.

## Physical verification and data safety

- Fresh read-only `pnputil /enum-devices /class Ports` listed COM4 as USB
  Serial Device VID/PID `303A:1001`, status Started; COM3 was disconnected.
  This identifies a USB serial interface, not the chip/board revision or
  firmware currently running. Historical `esptool chip_id` access was denied
  because COM4 was busy. RUN-046 did not open the port, read NVS, flash, reset,
  erase, or modify the board.
- NVS station configuration, credential-presence state and identity state on
  the actual board: **NOT VERIFIED**. Source code cannot establish persisted
  runtime values.
- Current RUN-046 staging image: build verified only; not flashed or
  readback-verified.
- No claim/provisioning session, Wi-Fi credentials, Event, DB write, FCM/email
  or staging API request occurred. No token/password/private key was printed.
- No NVS erase, identity change, Store ownership change, eFuse write,
  security-mode change or TLS bypass occurred.

## Next operator steps

1. Close the known process holding COM4 and verify the target chip before any
   board action. Do not erase NVS.
2. Capture safe boot diagnostics from RUN-046: station-config presence,
   credential result, identity presence and selected path. This will establish
   which startup branch the board actually takes.
3. If path is `backend-recovery`, a GPIO5 press will not start SoftAP by
   design. Have an authorized backend operator verify the matching Device
   record/state using redacted metadata. Reissue/recover an operational
   credential only through an approved API/workflow; no such recovery contract
   was established by this run.
4. Once the token/device-state mismatch is resolved, verify authenticated
   status. Only then should Event delivery proceed. A 401 Event is retained as
   blocked; do not infer success from the queued Event or retry log.
5. If Wi-Fi reconfiguration of a commissioned device is needed, approve and
   implement a distinct non-destructive physical confirmation flow that does
   not erase identity or credential. GPIO5 remains a commissioning gate only
   on the commissioning startup path.

