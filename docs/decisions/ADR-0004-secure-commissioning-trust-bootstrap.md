# ADR-0004: Secure commissioning trust bootstrap and protected identity

- Status: **PROPOSED — EXPLICIT APPROVAL REQUIRED**
- Date: 2026-10-28
- Scope: Owner-to-ESP32-S3 commissioning before SoftAP credential exchange

## Context

The backend already supports Owner-authorized enrollment of a per-device P-256
public key, a Store-bound provisioning session, challenge, expiry, bounded
failed attempts, single-use redemption and DER ECDSA/SHA-256 verification over
the canonical `pulselink-provisioning-v1` payload. Firmware has a conditional
ESP-IDF identity provider and host-tested payload primitives, but encrypted NVS,
private-key persistence and board runtime have not been verified.

The SoftAP document remains a contract draft. SSID, BSSID, IP address, serial
number, Device ID and a shared firmware secret are not trust anchors.

## Proposed trust boundary

1. The Owner app authenticates to PulseLink and requests a session for the
   already enrolled Device in the selected Store.
2. The Device opens a time-limited commissioning window only after the
   verified physical gate. The gate is not a replacement for cryptographic
   Device authentication.
3. The Device proves possession of its private P-256 key by signing a
   versioned handshake transcript containing Device identity, provisioning
   session ID, challenge, expiry and ephemeral-channel material.
4. Android accepts the Device only when the handshake public key matches the
   Owner-enrolled key obtained from the authenticated backend flow. It then
   derives an authenticated encrypted session for Wi-Fi data.
5. The Device redeems the existing backend session over authenticated HTTPS,
   stores the operational credential only inside its approved protected
   boundary, and closes SoftAP after success or timeout.

The exact local-channel construction remains an approval item. Candidates are
TLS on the local link with a per-device public-key pin, or an authenticated
ephemeral ECDH channel whose transcript is signed by the enrolled Device key
and protected with an approved AEAD implementation. No implementation may
send Wi-Fi credentials over plaintext HTTP or disable certificate validation.

## Candidate comparison

| Property | A — TLS/public-key pin | B — authenticated ephemeral ECDH |
| --- | --- | --- |
| Device trust anchor | Per-device certificate or public key pinned to the backend-enrolled key | Backend-enrolled public key verifies the Device signature over the handshake transcript |
| MITM/spoofing resistance | Requires correct pin distribution and certificate validation | Requires enrolled-key lookup and transcript signature verification; ECDH alone is not authentication |
| Replay/session substitution | Bind certificate identity to session ID, challenge, expiry and protocol version | Bind signed transcript to session ID, challenge, expiry, both ephemeral keys, protocol version and client context |
| Wi-Fi credential protection | TLS record encryption after authenticated certificate validation | AEAD derived from authenticated key agreement with specified nonce/sequence rules |
| Offline onboarding | Local exchange works after trust material and a valid backend session are obtained | Same; backend session and enrolled public key are still required before local exchange |
| Rotation/recovery | Certificate/public-key replacement requires backend enrollment and pin update | Device key rotation requires backend enrollment and invalidation of the old key |
| ESP-IDF/Android cost | Local HTTPS/TLS server and certificate lifecycle consume flash/RAM | ECDH, signature, transcript/AEAD implementation and vectors consume flash/RAM |
| Required evidence | Certificate validation, pin update and impersonation tests on target hardware | KEX/signature interoperability, nonce/replay, downgrade and impersonation tests on target hardware |

Both options require per-device public-identity provisioning, revocation and
replacement policy, and an explicit protocol version that cannot silently
downgrade. Neither option is approved by this ADR.

## Required test vectors before approval

The selected protocol must publish deterministic vectors for protocol version,
session ID, Device identity, challenge, expiry, client context, ephemeral key
material, transcript encoding and signature/AEAD output. Negative vectors must
cover wrong Device key, wrong session or Store binding, expiry, replayed nonce,
modified ciphertext, protocol downgrade and certificate/pin mismatch. Wi-Fi
passwords and private keys must never appear in vectors, logs or artifacts.

## Protected identity decision

The firmware provider remains fail-closed unless both the provider and NVS
encryption configuration are enabled. Normal NVS is not an approved private-key
store. The repository has no board-specific eFuse evidence or approved
manufacturing/recovery process, so this ADR does not select an eFuse block,
enable encrypted NVS, Flash Encryption or Secure Boot.

HMAC-based NVS encryption is the preferred prototype direction because it has
smaller software/partition impact, but it still requires an approved
HMAC-purpose eFuse block and an irreversible provisioning procedure.
Flash-Encryption-based NVS remains a separate option requiring a factory
security policy, `nvs_keys` partition and recovery plan.

The current provider conditionally stores a versioned private-key record via
the ESP-IDF NVS API and uses mbedTLS for P-256 generation, SPKI export and DER
signing. It refuses to replace an existing valid or corrupt record
automatically. This is implementation evidence, not proof that the NVS
partition is encrypted or that the key survives board reboot safely.

A missing or corrupt identity record must produce an error; firmware must not
silently generate a replacement key. Revocation, replacement, factory reset
and interrupted writes require an explicit recovery contract.

## Required approval decisions

- Select the local-channel candidate and approve trust-anchor distribution.
- Approve the prototype protected-storage path and manufacturing/recovery
  procedure.
- Confirm lost, reset and replaced Device revocation/re-enrollment semantics.
- Provide board evidence for the physical gate and protected-storage runtime.

Until these decisions are recorded, SoftAP credential exchange is blocked.

## WP14.5 approval gate

No approval is inferred from this document. The following register is the
review form for the project owner; approver and date remain blank until an
explicit decision is recorded outside this implementation change.

| ID | Decision | Proposal | Alternatives | Required evidence | Status | Approver/date |
| --- | --- | --- | --- | --- | --- | --- |
| TB-01 | Local trust bootstrap | Authenticated ephemeral ECDH + Device P-256 signature | TLS with per-device public-key pin | Target-compatible crypto test vectors and impersonation tests | OPEN | — |
| TB-02 | Trust-anchor distribution | Authenticated backend enrollment returns the expected public key to Owner app | Factory certificate/fingerprint distribution | Key custody, replacement and offline-onboarding record | OPEN | — |
| TB-03 | Transcript binding | Bind version, Device key, session ID, challenge, expiry, both ephemeral keys and client context | TLS certificate identity binding | Canonical transcript vectors and field mutation tests | OPEN | — |
| TB-04 | KDF/AEAD | Approved platform/library primitives after algorithm review | TLS record protection | Primitive availability, RAM/flash budget and interoperability vectors | OPEN | — |
| TB-05 | Replay/downgrade | Nonces, sequence numbers, expiry, single-use session and exact protocol version | None acceptable | Replay, duplicate, out-of-order and downgrade negative tests | OPEN | — |
| TB-06 | Key lifecycle | Explicit rotation/revoke; old identity never silently replaced | Factory replacement flow | Lost-device, replacement and revoke runbook | OPEN | — |
| TB-07 | Reset/recovery | Fail closed on corruption; re-enrollment requires approved physical/recovery process | Destructive factory reset | Recovery test and operator authorization | OPEN | — |
| ST-01 | Protected storage | HMAC-based encrypted NVS candidate | Flash-Encryption-based NVS | Board eFuse summary, provisioning plan and recovery policy | OPEN | — |
| ST-02 | Hardware security | No irreversible security operation in this package | Approved Secure Boot/Flash Encryption program | Manufacturing, debug and replacement policy | OPEN | — |

## WP14.5 ECDH protocol candidate (not frozen)

This is a review artifact, not a production wire contract. It intentionally
does not select a KDF, AEAD, curve encoding beyond the existing P-256 identity
contract, or Android/ESP-IDF implementation API until TB-04 is approved.

### Proposed message sequence

```text
Owner app -> backend: create provisioning session
Owner app -> device: HELLO(protocolVersion, sessionId, clientNonce, clientContext)
Device -> Owner app: DEVICE_HELLO(protocolVersion, sessionId, deviceKey,
                                  deviceNonce, deviceEphemeralPublicKey,
                                  expiresAt, signature)
Owner app -> device: CLIENT_KEY(clientEphemeralPublicKey, transcriptBinding)
Owner app -> device: ENCRYPTED_WIFI_CONFIG(sequence, ciphertext, tag)
Device -> Owner app: ACK(sequence, status)
```

The proposed canonical signed transcript is an ordered, length-prefixed
encoding of:

```text
domain = pulselink-softap-commissioning-v1
protocolVersion
sessionId
deviceKey (SPKI DER or its explicitly approved digest)
challenge (represented by the backend session context; never logged)
expiresAt (UTC epoch seconds)
clientContext
clientNonce
deviceNonce
clientEphemeralPublicKey
deviceEphemeralPublicKey
```

The Device signature must verify against the public key returned by the
authenticated backend enrollment lookup. The derived channel key must be bound
to the complete transcript and use a unique sequence/nonce rule. The exact KDF,
AEAD, public-key encoding and error codes are **OPEN** until TB-04 approval;
therefore this candidate is not frozen and no credential endpoint may consume
it.

### Negative cases required before freeze

- Wrong enrolled public key or malformed public key.
- Modified session ID, Device key, challenge, expiry, client context or nonce.
- Expired, consumed or cross-Device/session context.
- Signature failure, replayed nonce, duplicate/out-of-order sequence.
- Protocol version mismatch or downgrade attempt.
- Key-agreement/KDF/AEAD failure and modified ciphertext/tag.
- Cancellation, timeout, reboot and failed backend redemption.

Secrets must be cleared from temporary buffers after success, cancellation or
failure. No password, bearer token, private key or session key belongs in logs,
analytics, QR data or navigation arguments.

## WP14.5 recovery matrix

| Condition | Required behavior | Status |
| --- | --- | --- |
| Empty NVS | Generate only under approved first-boot enrollment policy | OPEN |
| Corrupt/tampered record | Enter ERROR; do not generate replacement identity | IMPLEMENTED BY SOURCE / RUNTIME NOT VERIFIED |
| Unreadable key | Fail signing and provisioning closed | IMPLEMENTED BY SOURCE / RUNTIME NOT VERIFIED |
| Signing failure | Abort handshake; do not send Wi-Fi credentials | DESIGN ONLY |
| Interrupted write | Preserve old valid identity or enter ERROR; never silently rotate | OPEN — requires board test |
| Reboot after enrollment | Reload same public identity | NOT VERIFIED |
| Lost/replaced board | Revoke old identity and perform approved re-enrollment | OPEN |
| Factory reset | Explicit destructive/recovery procedure; no implicit identity replacement | OPEN |
