#pragma once

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
