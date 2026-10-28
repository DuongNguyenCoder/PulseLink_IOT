# PulseLink SoftAP Commissioning Protocol

Status: **CONTRACT DRAFT — NOT IMPLEMENTED / NOT PRODUCTION READY**

This document records the security boundary for the approved ESP32-S3 SoftAP
commissioning transport. It is intentionally not an assertion that the current
firmware or Android application implements this protocol.

## Existing backend contract

The current backend already provides the following owner-scoped operations:

- `POST /v1/stores/{storeId}/devices/{deviceId}/enrollment` accepts an ECDSA
  P-256 public key and transitions the device to `ENROLLED`.
- `POST /v1/stores/{storeId}/provisioning-sessions` returns a one-time
  bootstrap secret and challenge to an authenticated Store OWNER. The session
  expires after 30 minutes and stores only verifiers for the secret/challenge.
- `POST /v1/devices/{deviceId}/provisioning-sessions/{sessionId}/redeem`
  requires the bootstrap secret, challenge and a DER-encoded ECDSA signature.
  The signed canonical payload is versioned as `pulselink-provisioning-v1` and
  binds session ID, device key, challenge and expiry.

Redemption is single-use, bounded by the existing failed-attempt policy, and
updates the device and session transactionally. The operational token is
returned only by the redemption response and is not written to logs.

## Target state machine

```text
IDLE
  -> WAITING_FOR_PHYSICAL_CONFIRMATION
  -> SOFTAP_ACTIVE
  -> RECEIVING_CONFIG
  -> REDEEMING
  -> CONNECTING_TO_WIFI
  -> ONLINE

Any state before ONLINE -> FAILED or IDLE after bounded cleanup.
SOFTAP_ACTIVE and RECEIVING_CONFIG have finite deadlines.
ONLINE closes the SoftAP and invalidates the local commissioning context.
```

The physical button (or an equivalent hardware signal confirmed for the exact
board) is a mandatory gate before `SOFTAP_ACTIVE`. Device ID, serial number,
SSID/BSSID, local IP address and a known URL are not possession proofs.

## Required transport security before implementation

The transport must provide all of the following before Wi-Fi credentials can
be accepted:

1. A per-device, non-default trust anchor or authenticated ephemeral
   handshake. A common bootstrap password is prohibited.
2. Binding to the backend provisioning session, device identity and expiry.
3. Integrity protection and replay protection for every commissioning message.
4. Confidentiality for the Wi-Fi credentials; plaintext HTTP on the SoftAP is
   not acceptable.
5. Bounded payload size, request count, timeout and retry count.
6. Safe cleanup on cancel, reboot, failed redemption and physical-window
   expiry.

The final design must state where the device private key/trust material is
stored, how Android authenticates the intended device, how key rotation works,
and how a SoftAP impersonation attempt is rejected. Android must not trust a
SoftAP merely because it has the expected SSID.

## Message contract placeholder

No message schema is approved yet. A future versioned envelope must include a
protocol version, commissioning context identifier, message sequence or nonce,
authenticated device binding and an integrity/authentication value. It must
not include access tokens, raw operational credentials, private keys or
secrets in logs, analytics, QR contents or navigation arguments.

The Wi-Fi credential payload must be encrypted and authenticated for the
intended device. The device must acknowledge receipt without echoing the
password. The Android client must clear sensitive state when the flow is
cancelled or expires.

## Recovery rules

- A failed Wi-Fi attempt does not erase a currently working credential.
- A reboot returns to a safe non-commissioning state unless the physical gate
  and session are still valid under an explicitly persisted, bounded design.
- A consumed or expired backend session cannot be replayed.
- The device is not reported `ONLINE` merely because a SoftAP connection or
  local configuration succeeded; backend authentication and the existing
  Device Event/online evidence are required.
- The existing Device Event contract and notification default remain unchanged.

## Implementation blockers

The repository currently has no firmware SoftAP/provisioning implementation,
per-device SoftAP trust anchor, or Android production commissioning module. A
transport-independent physical-confirmation state machine exists, but it is not
wired to SoftAP startup and does not establish Android-to-Device trust. The
firmware currently uses build-time Wi-Fi/device-token configuration and has no
verified SoftAP, BLE, or bootstrap client implementation. Therefore no
insecure placeholder transport is added by this work package.

Wi-Fi credential exchange can begin only after the trust-anchor and
hardware-button provisioning decisions are made concrete in firmware and
testable on the ESP32-S3 target. Firmware compilation is available; hardware
commissioning remains unverified until a board is tested without bypassing the
physical gate.
