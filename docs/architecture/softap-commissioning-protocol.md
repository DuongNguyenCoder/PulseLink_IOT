# PulseLink SoftAP Commissioning Protocol

Status: **MVP CLAIM PROOF AND SOFTAP TRANSPORT SOURCE IMPLEMENTED; OPERATIONAL STORAGE AND HARDWARE RUNTIME NOT VERIFIED**

This document records the security boundary and current implementation for the
ESP32-S3 SoftAP commissioning transport. Source/build evidence does not imply
hardware commissioning or secure-at-rest credential storage.

## Current implementation (WP14-RUN-038)

- Public Device IDs use `pl-` followed by the lowercase hex STA base MAC. The
  ID is stable identification only; it is neither secret nor proof of
  authenticity.
- An authenticated active Store OWNER creates
  `POST /v1/stores/{storeId}/device-claims` with Device ID and display name.
  The backend returns a five-minute challenge bound to that account, Store and
  Device ID. Completion uses
  `POST /v1/stores/{storeId}/device-claims/{claimSessionId}/complete`.
- During the physical commissioning window, the board serves
  `POST /v1/commissioning/enrollment-proof` over SoftAP. It checks the supplied
  Device ID against its STA base MAC and signs
  `pulselink-device-claim-v1` with P-256 ECDSA/SHA-256. The canonical UTF-8
  payload is newline-separated: domain, Device ID, Store ID, claim session ID,
  key version, base64 SPKI, challenge, expiry seconds. C, Java and TypeScript
  compare the same public fixture. The backend verifies the proof and
  transactionally consumes the claim before creating the Store-scoped
  ENROLLED Device. Device ID primary-key and unique public-key constraints
  prevent a second Store from winning a concurrent claim. Repeating a claim
  for the same active Device in the same Store is idempotent.
- Android derives the SoftAP SSID from the scanned MAC-based ID, requests the
  proof, verifies signature/context locally, and submits it to the backend.
  SoftAP HTTP success does not complete Store linking. Existing encrypted
  commissioning handshake remains the Wi-Fi credential path.
- This is first-claim proof-of-possession/TOFU. With no manufacturing root,
  there is no proof that the key came from a genuine ESP32-S3; a rogue first
  claimant may race, and raw NVS extraction can clone identity. The identity
  provider is opt-in and ordinary NVS is not confidentiality protection. Do
  not describe it as hardware attestation or protected storage.
- Operational credential storage is not registered and the readiness gate
  remains fail-closed. Redemption-to-ONLINE/Event is therefore not complete.
  Board identity, button wiring, SoftAP, Wi-Fi, reboot recovery and physical
  E2E remain NOT VERIFIED.

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

The transport-independent controller is implemented in
`firmware/esp32/main/commissioning_state.c`. It enforces lifecycle transitions,
deadline expiry, cancellation and a consume-once session marker, but it is not
connected to SoftAP, Wi-Fi credentials or a backend redemption client. Host
tests prove controller behavior only; they do not prove transport security or
device runtime behavior.

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

## Versioned handshake baseline

The public transcript encoder is implemented in
`firmware/esp32/main/commissioning_protocol.c` and mirrored by
`CommissioningTranscript.java`. It uses network-byte-order fields:

```text
u32(domain length) | domain = "pulselink-softap-commissioning-v1"
u16(protocol version = 1)
u32 + sessionId
u32 + deviceKey SPKI DER
u32 + backend challenge/session context
u64 + expiresAt epoch seconds
u32 + client context
u32 + client nonce
u32 + device nonce
u32 + client ephemeral P-256 public key
u32 + device ephemeral P-256 public key
```

The proposed handshake is:

```text
Owner -> Device: HELLO(version, sessionId, clientNonce, clientContext,
                        clientEphemeralPublicKey)
Device -> Owner: DEVICE_HELLO(deviceNonce, deviceEphemeralPublicKey,
                               enrolledDeviceKey, expiresAt, signature)
Owner -> Device: ENCRYPTED_WIFI_CONFIG(direction, sequence, ciphertext, tag)
Device -> Owner: ACK(direction, sequence, status)
```

The Device signature covers the complete transcript and is verified against
the Owner-enrolled public key obtained through the authenticated backend flow.
The ECDH shared secret is proposed as input to HKDF-SHA-256 with info
`pulselink-softap-session-v1`; the first 16 bytes are proposed as the
AES-128-GCM key. GCM uses a 12-byte nonce formed from a direction identifier
and a monotonically increasing 64-bit sequence number. These parameters are a
versioned implementation baseline, not evidence that the transport is already
implemented or hardware-ready.

The Wi-Fi credential payload must be encrypted and authenticated for the
intended device. The device must acknowledge receipt without echoing the
password. The Android client must clear sensitive state when the flow is
cancelled or expires. No access token, operational credential, private key or
session key belongs in logs, analytics, QR data or navigation arguments.

The transport remains blocked until the encrypted-NVS identity path and target
hardware trust anchor are available. The current C/Android code only tests
transcript compatibility; it does not implement ECDH, HKDF, AES-GCM, SoftAP or
credential exchange.

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
