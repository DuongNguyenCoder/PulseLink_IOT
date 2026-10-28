#include "device_provisioning_payload.h"

#include <inttypes.h>
#include <stddef.h>
#include <stdio.h>

device_provisioning_payload_result_t device_provisioning_build_canonical_payload(
    char *output,
    size_t output_capacity,
    const char *session_id,
    const char *device_key,
    const char *challenge,
    uint64_t expires_at_epoch_seconds,
    size_t *output_length
) {
    if (output == NULL || output_length == NULL || output_capacity == 0U ||
        session_id == NULL || device_key == NULL || challenge == NULL) {
        return DEVICE_PROVISIONING_PAYLOAD_INVALID;
    }
    int written = snprintf(
        output,
        output_capacity,
        "pulselink-provisioning-v1\n%s\n%s\n%s\n%" PRIu64,
        session_id,
        device_key,
        challenge,
        expires_at_epoch_seconds
    );
    if (written < 0) return DEVICE_PROVISIONING_PAYLOAD_INVALID;
    if ((size_t)written >= output_capacity) return DEVICE_PROVISIONING_PAYLOAD_TOO_SMALL;
    *output_length = (size_t)written;
    return DEVICE_PROVISIONING_PAYLOAD_OK;
}
