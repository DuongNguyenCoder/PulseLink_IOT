# ESP32 device event integration

## Contract

The firmware sends:

```text
POST /v1/device-events
Authorization: Bearer <operational-device-token>
Content-Type: application/json
```

The JSON body uses `eventId`, `type: BUTTON_PRESSED`, UTC `occurredAt`,
`firmwareVersion`, `rssiDbm`, and a bounded `payload` object. `eventId` is a
UUID v4 created once for a physical button press and reused for every retry.

## Firmware flow

The button task polls the configured active-low GPIO every 10 ms and accepts a
press only after 50 ms of stable state. After an event is successfully written
to NVS, further accepted presses are suppressed for 5 seconds. This cooldown
prevents repeated button presses from creating multiple events in a short
window; a failed NVS write does not start the cooldown. The sender task waits
for Wi-Fi, sends HTTPS with the ESP-IDF certificate bundle, and removes the
record only after HTTP `200` or `201`.

Timeouts, connection failures, `429`, and `5xx` responses retain the record and
retry with exponential backoff and jitter. `400`, `401`, `403`, and `409` are
persisted as `blocked`; they require operator/device remediation and are not
retried in a hot loop. A reboot between server commit and local deletion may
send the same UUID again, which the API handles idempotently. Delivery is not
exactly once.

The queue holds eight records. When full, a new press is rejected with a visible
error and existing records are not overwritten. NVS write/commit failure does
not acknowledge the press as queued. A successful HTTP response removes a
record only after the queue update is committed; if that cleanup or a
`BLOCKED` state update fails, the in-memory record is restored and the sender
retries instead of silently dropping it. NVS recovery never erases storage
automatically.

The current firmware does not yet configure an SNTP server. Until the device
clock is synchronized, `occurredAt` can be inaccurate, including Unix epoch on
fresh boot; the API's server-side `receivedAt` remains authoritative for
arrival ordering. SNTP configuration and clock-validity indication are
deployment follow-up work.

## Security

The operational token is configured per device through local provisioning and
is never logged. The endpoint must begin with `https://`; certificate
validation uses the ESP-IDF CA bundle. The firmware does not place a token in
the URL or event body.

## Verification status

Host source/configuration review is complete. ESP-IDF build and board-level
button, NVS power-loss, Wi-Fi recovery and TLS tests require an ESP-IDF
v5.5.5 shell and the actual ESP32-S3 carrier board; they must not be marked
passed without those observations.
