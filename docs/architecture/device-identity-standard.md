# Device Identity Standard

## Canonical identity

PulseLink uses the ESP32-S3 Wi-Fi station/base MAC as the Device identity input.
Firmware obtains it with `esp_read_mac(mac, ESP_MAC_WIFI_STA)`. The six bytes
are rendered in array order, byte 0 through byte 5, as lowercase hexadecimal:

```text
Device.id = pl- + mac[0] + mac[1] + mac[2] + mac[3] + mac[4] + mac[5]
```

Example:

```text
MAC:       02:11:22:33:44:55
Device.id: pl-021122334455
```

The canonical Device ID is exactly `pl-` followed by twelve lowercase hex
characters. Separators are accepted only when normalizing a raw MAC in backend
test/tool code; API Device IDs must already be canonical. Uppercase IDs,
arbitrary strings and client-selected CUIDs are rejected for new registration
and claim sessions.

## Security boundary

The MAC-derived ID is an identifier and lookup key, not a credential. Claiming
still requires the Owner-authorized claim session and firmware public-key proof.
Provisioning bootstrap values and the operational device bearer credential are
separate secrets and retain their existing lifecycle.

## Compatibility

Existing Device rows are not rewritten or deleted. Historical rows that use a
legacy ID remain addressable for events, provisioning and authorization. New
Owner registration and new claim sessions must use the canonical MAC-derived
format. No migration is required because the initial `Device.id` database
column has never had a database default; only the Prisma model-level accidental
`cuid()` default was removed.

## Test vector

```text
input MAC: 02:11:22:33:44:55
bytes:     02 11 22 33 44 55
output:    pl-021122334455
```

This vector is asserted by the firmware host test and the backend TypeScript
test. Hardware reboot, Wi-Fi changes and physical SoftAP commissioning do not
change the MAC input; a board-level E2E test remains separate from these tests.
