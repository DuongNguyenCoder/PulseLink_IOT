# ADR — Device Identity and Operational Credential Storage

- Status: **PROPOSED — OWNER SECURITY DECISIONS REQUIRED**
- Date: 2026-10-28
- Scope: ESP32-S3-WROOM-1 N16R8, ESP-IDF 5.5.5, PulseLink commissioning prototype and production-build preparation.

## Context

The backend accepts Device enrollment only through the operator-authorized
`POST /v1/operator/devices/:deviceId/enrollment` route. It verifies the
`pulselink-device-enrollment-v1` P-256/SHA-256 DER signature over Device key,
key version, canonical SPKI, 32-byte challenge and expiry. The Device row is
claimed once, public key uniqueness is enforced by PostgreSQL, and the
operator grant is scoped to the Store already bound to that Device.

Firmware has a conditional ESP-IDF identity-provider implementation. It
creates a P-256 key only when explicitly asked and no record exists; runtime
calls `device_identity_load_or_generate(..., false, ...)`, so it does not
regenerate a missing identity. The provider code stores the private DER record
in NVS and is compiled unavailable unless the identity-provider and NVS
encryption settings are selected. Runtime currently calls ordinary
`nvs_flash_init()` and the operational credential-storage API has no
production provider registration. No hardware configuration was inspected by
opening the board or reading eFuses.

The repository has no factory protocol over USB/UART, no board-side
enrollment-proof endpoint, and no manufacturing certificate/key root. The
USB serial interface previously enumerated is not proof of the exact board or
of a usable factory channel. A signature from an arbitrary local key proves
possession of that key only; it does not prove that the key belongs to the
physical PulseLink board.

## Threat model and requirements

Protect a per-device Device identity private key and backend operational
bearer credential against raw flash readout, accidental disclosure, firmware
logs and cross-device reuse. Detect missing/corrupt records and fail closed.
The MVP does not claim resistance to a fully invasive attacker or malicious
firmware unless Secure Boot and the relevant debug/flash policy are adopted.
Availability and recovery must not silently replace identity or accept stale
credentials.

## Storage alternatives

| Choice | At-rest protection and key custody | Manufacturing/recovery implications | Assessment |
| --- | --- | --- | --- |
| ESP-IDF encrypted NVS using the HMAC peripheral | NVS encryption keys are derived with an eFuse HMAC key and are not stored as plaintext NVS keys. Requires a unique per-device HMAC key and an explicitly selected HMAC key ID/purpose. | Requires one-time eFuse provisioning, a controlled factory station, secure-bootloader/configuration decisions, inventory, and an irreversible-operation/recovery procedure. Loss or incorrect provisioning can make the NVS partition unreadable. A replacement board gets a new identity and new keys; revoke the old Device/credential. | **Recommended candidate** for this board if owner approves per-device key provisioning and accepts device-bound, non-exportable recovery. Not enabled. No eFuse block/key ID is selected here. |
| ESP-IDF encrypted NVS with an `nvs_keys` partition protected by Flash Encryption | NVS data is encrypted; the NVS key partition depends on Flash Encryption for protection from raw flash extraction. | Requires partition and provisioning policy, Flash Encryption key custody, release-mode transition, recovery/repair plan and irreversible eFuse state. Power-loss during initial provisioning needs a documented recovery path. | Viable if the project adopts whole-flash protection; more coupled to Flash Encryption than needed solely to protect NVS contents. Not enabled. |
| Flash Encryption without NVS encryption | Encrypts flash contents under the flash key but is a broader, lifecycle-sensitive platform control. | Requires provisioning, encrypted boot/update artifacts, debug/return policy and irreversible state handling. | Do not assume it substitutes for the ESP-IDF NVS encryption API's integrity/storage semantics. Not selected alone. |
| Secure Boot v2 | Authenticates firmware image/boot chain; does not encrypt NVS or a bearer credential by itself. | Requires signing-key custody, signed updates and eFuse/bootloader lifecycle. | Recommended before production deployment as a separate firmware-authenticity control. It is not a storage implementation. |
| Per-device external secure element | Could keep identity signing key non-exportable if a selected part and supported driver exist. | Requires an actual BOM, board schematic, bus mapping, provisioning and replacement policy. | No secure-element hardware or integration is evidenced in this repository. Do not assume one is present. |
| Software key stored in firmware, ordinary NVS, or a shared wrapping key | Key can be extracted from image/storage or compromise multiple devices. | Superficially easy to recover but has no acceptable per-device custody boundary. | Rejected. No hardcoded/shared-key or plaintext fallback. |

NVS encryption, Flash Encryption and Secure Boot address different controls.
NVS encryption is the direct candidate for protecting stored credentials;
HMAC key custody or Flash Encryption is needed to protect the NVS encryption
key. Secure Boot protects firmware authenticity, not stored-data confidentiality.
Exact ESP-IDF 5.5.5 key-scheme and bootloader settings must be validated in an
isolated compile profile and then reviewed before any physical provisioning.

## Recommended lifecycle (conditional)

1. At factory station, provision a unique HMAC key using the selected ESP-IDF
   HMAC-backed NVS scheme and an owner-approved key ID/purpose. Keep the key
   unavailable to application software and the factory workstation after
   provisioning. Do not reuse a key across boards.
2. Initialize encrypted NVS and confirm the expected partition/key scheme is
   usable. Generate the P-256 Device identity once inside the board, store its
   DER record only in encrypted NVS, and read back the public SPKI. A missing,
   corrupt or unreadable existing record must stop enrollment; production boot
   must never generate a replacement.
3. The approved factory interface sends a short-lived challenge and receives
   only SPKI plus a signature over the exact enrollment transcript. The
   interface must be physically gated and must not expose private-key bytes.
   The operator utility validates the proof and formats the existing API
   request; backend Store authorization, Device binding, proof verification,
   expiry, single-use state and unique-key constraint remain authoritative.
4. Provisioning redemption issues an operational credential only after
   proof-of-possession. Save atomically to protected storage, read back and
   validate before allowing Station/backend status. Keep the token in RAM only
   for use; clear buffers on all exits. `ONLINE` requires the authenticated
   Device status response.
5. Rotation/revocation: issue a replacement Device operational credential
   through an approved backend lifecycle; commit new protected record, verify
   authenticated status, then revoke the previous token. If the current API
   cannot issue overlapping credentials, require an explicit downtime window;
   do not invent a second credential API.
6. Lost, stolen or corrupted board: operator marks the Device/credential
   revoked and audits the action. Replacement board is a new physical
   identity/Device enrollment. Do not copy the old private key or recover it
   from backups. NVS erase/factory reset is a controlled destructive operation
   and does not restore trust; re-enrollment is required.
7. Interrupted provisioning: boot reads key/record state and fails closed on
   partial, invalid or inaccessible data. Do not auto-erase, regenerate keys,
   claim ONLINE, or send Events. Operator follows a reviewed recovery or
   replacement procedure; provisioning is retried only with an unconsumed,
   valid backend session.

## Factory proof interface gap

The present board code has `device_identity_get_public_key()` and
`device_identity_sign_der()` abstractions and an ESP-IDF conditional provider,
but no enrollment-specific SoftAP/USB command. SoftAP is not a trust anchor;
the existing commissioning transport uses an already-enrolled key and cannot
bootstrap that enrollment by itself. A future factory adapter must be based on
the verified carrier-board connection (USB Serial/JTAG or a UART actually
present in the schematic), require a fresh physical gate, bound message size
and expiry, and return only the signed transcript/public SPKI. Do not select a
GPIO, baud rate, USB command framing or claim physical confirmation until
board revision/schematic and electrical behavior are verified.

The WP14.38-A request builder accepts a board proof, validates the same
signature/transcript locally and formats the existing operator route. It does
not sign, contact the API, authenticate an operator, or establish physical
board provenance. The operator must still use an authenticated account with
active `DEVICES_WRITE` for the Device's persisted Store.

## Decisions requiring owner approval

1. **Storage scheme:** approve HMAC-backed encrypted NVS (recommended) or
   encrypted NVS keys protected by Flash Encryption. Reject software-only
   wrapping.
2. **Firmware authenticity/confidentiality:** require Secure Boot v2 before
   production? Require Flash Encryption in release mode? These are separate
   from NVS encryption and expand irreversible provisioning/recovery scope.
3. **Provisioning authority:** confirm the owner/production operator is
   responsible for manufacturing provisioning and recovery; name the
   authorized role/station and record custody/audit requirements. Select an
   approved per-device HMAC key ID/purpose only in the reviewed manufacturing
   plan; this ADR deliberately does not guess one.
4. **Recovery:** approve that a lost/corrupt identity is revoked and replaced
   with a newly enrolled Device, with no private-key restoration. Define
   factory-reset authorization and handling of returned boards.
5. **Rotation:** confirm whether backend supports overlapping operational
   credentials; if not, approve a bounded service interruption during
   credential replacement.
6. **Factory transport:** verify board revision, schematic and whether the
   actual USB/UART path may be used for a physically gated proof exchange.
   No serial port should be opened until the exact reset/DTR behavior and
   hardware test action are separately authorized.

## Irreversible or destructive actions (not authorized by this ADR)

- Burning/locking any eFuse, including an HMAC key or key-purpose/block state.
- Enabling Secure Boot or Flash Encryption, changing release mode, or burning
  associated eFuse bits.
- Flashing, erasing, resetting or factory-resetting a physical board; opening
  a serial port that can toggle DTR/RTS.
- Erasing encrypted NVS or replacing an identity record.

## Status

This recommendation is not an approval to provision hardware. Until decisions
1–6 are recorded and the manufacturing/recovery procedure is approved, keep
the identity/storage gates closed and do not claim production-ready storage,
trusted enrollment or Physical E2E readiness.
