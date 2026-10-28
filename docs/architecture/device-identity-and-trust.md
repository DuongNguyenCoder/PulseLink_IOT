# PulseLink Device Identity and Trust Model

Status: **BASELINE / PARTIALLY IMPLEMENTED**

This document separates the backend identity contract that exists today from
the factory, firmware and Android trust decisions still required before
SoftAP credential exchange.

## Implemented backend contract

- A Device has a server-side `deviceKey` and Store binding.
- Owner enrollment accepts an ECDSA P-256 (`prime256v1`) public key.
- The backend stores the enrollment public key and key version, never the
  corresponding private key.
- Provisioning sessions bind Device, Store, actor Account, challenge and
  expiry. Bootstrap/challenge verifiers are stored instead of raw values.
- Redemption verifies the Device/Store relationship, challenge, bootstrap
  value and DER-encoded ECDSA signature over the versioned canonical payload
  `pulselink-provisioning-v1`.
- Redemption is single-use and transactional. The operational bearer token is
  returned only at successful redemption; the backend stores a hash.
- Device Event authorization derives Store scope from the authenticated Device,
  not from a client-supplied Store ID.

These properties are implemented in the API. They do not prove that current
firmware can generate or protect the required private key.

The firmware now contains a transport-independent physical-confirmation state
machine in `firmware/esp32/main/physical_confirmation.c`. It is deliberately
not connected to SoftAP startup or a remote API. GPIO4 is represented by a
configurable active-low adapter, but the electrical pull-up and voltage remain
unverified on the carrier board.

The firmware contains a provider-bound identity interface in
`firmware/esp32/main/device_identity.c` and a canonical payload builder in
`device_provisioning_payload.c`. These components do not hold or generate keys
by themselves. An ESP-IDF adapter now exists in
`firmware/esp32/main/esp_device_identity_provider.c`, but it is enabled only
when both `CONFIG_PULSELINK_DEVICE_IDENTITY_NVS_PROVIDER` and
`CONFIG_NVS_ENCRYPTION` are enabled. In every other configuration it returns
an unavailable/invalid provider result rather than silently falling back to
normal NVS or generating a replacement identity.

When enabled, the adapter uses the ESP-IDF NVS API for a versioned key record
and mbedTLS to generate a P-256 key, export an SPKI public key and create a
DER ECDSA signature over the SHA-256 digest of the canonical payload. It never
exports a private key. A corrupt or unreadable stored record is terminal for
that identity: it is not overwritten by automatic key generation.

## Required per-device lifecycle

1. Generate an independent P-256 key pair on the device or in an approved
   factory process. A shared private key is prohibited.
2. Keep the private key inside an approved device-protected boundary. The
   conditional ESP-IDF provider requires encrypted NVS; normal NVS is never an
   acceptable fallback. The exact ESP32-S3 security configuration and factory
   process must still be validated before production.
3. Register only the public key through the authenticated Owner enrollment
   contract.
4. During future commissioning, authenticate the intended Device and bind all
   messages to the active provisioning session, Device identity and expiry.
5. Revoke the enrollment/operational credential on loss of trust or device
   decommissioning. Rotation must not silently replace an enrolled key.
6. Factory reset must define whether identity is destroyed, retained, or
   recoverable through an approved re-provisioning process. This is not yet a
   production contract.

## Trust anchors

The future SoftAP flow needs two independently defined trust relationships:

- Android must authenticate the specific Device before sending Wi-Fi
  credentials. SSID, BSSID, IP address, serial number and Device ID are not
  trust anchors.
- The Device must authenticate the backend using the existing HTTPS/TLS trust
  configuration and must sign the backend provisioning payload with its
  per-device private key.

The Android trust bootstrap mechanism is **OPEN DECISION**. Candidate designs
include a QR/near-field transfer of a public certificate or an authenticated
ephemeral handshake rooted in per-device factory material. A common static
secret, a secret embedded in every firmware image, or an unauthenticated local
HTTP endpoint is not acceptable.

Normal NVS is not treated as secure storage. The current local firmware
configuration has Secure Boot, Flash Encryption and NVS Encryption disabled,
so the ESP-IDF provider is intentionally unavailable in the built firmware.
Enabling NVS Encryption alone is also insufficient production evidence: the
NVS security-key lifecycle, Flash Encryption/Secure Boot policy, factory
provisioning and recovery process must be reviewed and validated on hardware.

## Security capabilities not yet verified

The current project does not demonstrate:

- enabled encrypted-NVS private-key persistence or recovery on hardware;
- factory/manufacturing provisioning and certificate rotation;
- Secure Boot enforcement;
- Flash Encryption enforcement;
- NVS Encryption for credential storage;
- Android-to-device trust bootstrap;
- physical possession/button gating.

The ESP-IDF configuration exposes hardware support for some security features,
but capability support is not evidence that the feature is enabled and
provisioned on a device. No feature is claimed as active here without a
configuration and hardware test record.

## Threat boundaries

Physical access may allow probing, reset attempts or flash extraction unless
the selected ESP-IDF security configuration and manufacturing process protect
against it. SoftAP WPA credentials alone do not prove possession. Lost,
replaced or factory-reset devices require explicit revocation and recovery
semantics before production rollout.

No private key, bootstrap secret, operational token or Wi-Fi credential may be
placed in source, shared firmware images, logs, crash reports or Android
navigation/analytics data.

## C6-D entry conditions

Before implementing SoftAP credential exchange, the project must approve the
Android trust bootstrap, confirm the board's physical gate, define factory key
provisioning and verify the storage/security configuration on the ESP32-S3.
