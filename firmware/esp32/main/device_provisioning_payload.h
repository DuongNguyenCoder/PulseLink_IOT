#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef enum {
    DEVICE_PROVISIONING_PAYLOAD_OK = 0,
    DEVICE_PROVISIONING_PAYLOAD_INVALID,
    DEVICE_PROVISIONING_PAYLOAD_TOO_SMALL,
} device_provisioning_payload_result_t;

device_provisioning_payload_result_t device_provisioning_build_canonical_payload(
    char *output,
    size_t output_capacity,
    const char *session_id,
    const char *device_key,
    const char *challenge,
    uint64_t expires_at_epoch_seconds,
    size_t *output_length
);

device_provisioning_payload_result_t device_provisioning_build_enrollment_payload(
    char *output,
    size_t output_capacity,
    const char *device_key,
    uint32_t key_version,
    const char *public_key_spki_base64,
    const char *challenge_base64url,
    uint64_t expires_at_epoch_seconds,
    size_t *output_length
);

device_provisioning_payload_result_t device_provisioning_build_claim_payload(
    char *output, size_t output_capacity, const char *device_id,
    const char *store_id, const char *claim_session_id, uint32_t key_version,
    const char *public_key_spki_base64, const char *challenge_base64url,
    uint64_t expires_at_epoch_seconds, size_t *output_length
);

bool device_provisioning_build_device_id(const uint8_t base_mac[6], char *output, size_t output_capacity);
