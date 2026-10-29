#include "device_provisioning_payload.h"

#include <inttypes.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>

static bool is_single_line(const char *value) {
    return value != NULL && value[0] != '\0' &&
        strchr(value, '\n') == NULL && strchr(value, '\r') == NULL;
}

static bool is_base64url_32_byte_challenge(const char *value) {
    if (value == NULL || strlen(value) != 43U) return false;
    for (size_t i = 0U; i < 43U; ++i) {
        const char c = value[i];
        if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
              (c >= '0' && c <= '9') || c == '-' || c == '_')) return false;
    }
    return true;
}

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

device_provisioning_payload_result_t device_provisioning_build_enrollment_payload(
    char *output,
    size_t output_capacity,
    const char *device_key,
    uint32_t key_version,
    const char *public_key_spki_base64,
    const char *challenge_base64url,
    uint64_t expires_at_epoch_seconds,
    size_t *output_length
) {
    if (output_length != NULL) *output_length = 0U;
    if (output == NULL || output_capacity == 0U || output_length == NULL ||
        !is_single_line(device_key) || !is_single_line(public_key_spki_base64) ||
        !is_base64url_32_byte_challenge(challenge_base64url) ||
        key_version == 0U || expires_at_epoch_seconds == 0U) {
        return DEVICE_PROVISIONING_PAYLOAD_INVALID;
    }
    int written = snprintf(
        output,
        output_capacity,
        "pulselink-device-enrollment-v1\n%s\n%" PRIu32 "\n%s\n%s\n%" PRIu64,
        device_key,
        key_version,
        public_key_spki_base64,
        challenge_base64url,
        expires_at_epoch_seconds
    );
    if (written < 0) return DEVICE_PROVISIONING_PAYLOAD_INVALID;
    if ((size_t)written >= output_capacity) return DEVICE_PROVISIONING_PAYLOAD_TOO_SMALL;
    *output_length = (size_t)written;
    return DEVICE_PROVISIONING_PAYLOAD_OK;
}

device_provisioning_payload_result_t device_provisioning_build_claim_payload(
    char *output, size_t output_capacity, const char *device_id,
    const char *store_id, const char *claim_session_id, uint32_t key_version,
    const char *public_key_spki_base64, const char *challenge_base64url,
    uint64_t expires_at_epoch_seconds, size_t *output_length
) {
    if (output_length != NULL) *output_length = 0U;
    if (output == NULL || output_capacity == 0U || output_length == NULL ||
        !is_single_line(device_id) || !is_single_line(store_id) ||
        !is_single_line(claim_session_id) || !is_single_line(public_key_spki_base64) ||
        !is_base64url_32_byte_challenge(challenge_base64url) || key_version == 0U ||
        expires_at_epoch_seconds == 0U) return DEVICE_PROVISIONING_PAYLOAD_INVALID;
    int written = snprintf(output, output_capacity,
        "pulselink-device-claim-v1\n%s\n%s\n%s\n%" PRIu32 "\n%s\n%s\n%" PRIu64,
        device_id, store_id, claim_session_id, key_version, public_key_spki_base64,
        challenge_base64url, expires_at_epoch_seconds);
    if (written < 0) return DEVICE_PROVISIONING_PAYLOAD_INVALID;
    if ((size_t)written >= output_capacity) return DEVICE_PROVISIONING_PAYLOAD_TOO_SMALL;
    *output_length = (size_t)written;
    return DEVICE_PROVISIONING_PAYLOAD_OK;
}

bool device_provisioning_build_device_id(const uint8_t base_mac[6], char *output, size_t output_capacity) {
    if (base_mac == NULL || output == NULL || output_capacity < 16U) return false;
    int written = snprintf(output, output_capacity, "pl-%02x%02x%02x%02x%02x%02x",
        base_mac[0], base_mac[1], base_mac[2], base_mac[3], base_mac[4], base_mac[5]);
    return written == 15;
}
