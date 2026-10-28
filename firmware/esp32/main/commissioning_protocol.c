#include "commissioning_protocol.h"

#include <stdbool.h>
#include <string.h>

#define COMMISSIONING_PROTOCOL_DOMAIN "pulselink-softap-commissioning-v1"
#define COMMISSIONING_PROTOCOL_MAX_FIELD UINT32_MAX

static bool append_bytes(uint8_t *output, size_t capacity, size_t *offset,
    const uint8_t *value, size_t length) {
    if (length > COMMISSIONING_PROTOCOL_MAX_FIELD || *offset > capacity ||
        length > capacity - *offset) return false;
    if (length > 0U && value == NULL) return false;
    if (length > 0U) memcpy(output + *offset, value, length);
    *offset += length;
    return true;
}

static bool append_u16(uint8_t *output, size_t capacity, size_t *offset, uint16_t value) {
    uint8_t bytes[2] = { (uint8_t)(value >> 8U), (uint8_t)value };
    return append_bytes(output, capacity, offset, bytes, sizeof(bytes));
}

static bool append_u32(uint8_t *output, size_t capacity, size_t *offset, uint32_t value) {
    uint8_t bytes[4] = {
        (uint8_t)(value >> 24U), (uint8_t)(value >> 16U),
        (uint8_t)(value >> 8U), (uint8_t)value,
    };
    return append_bytes(output, capacity, offset, bytes, sizeof(bytes));
}

static bool append_u64(uint8_t *output, size_t capacity, size_t *offset, uint64_t value) {
    uint8_t bytes[8];
    for (size_t index = 0U; index < sizeof(bytes); index++) {
        bytes[sizeof(bytes) - 1U - index] = (uint8_t)(value >> (index * 8U));
    }
    return append_bytes(output, capacity, offset, bytes, sizeof(bytes));
}

static bool append_field(uint8_t *output, size_t capacity, size_t *offset,
    const uint8_t *value, size_t length) {
    if (length > COMMISSIONING_PROTOCOL_MAX_FIELD) return false;
    return append_u32(output, capacity, offset, (uint32_t)length) &&
        append_bytes(output, capacity, offset, value, length);
}

commissioning_protocol_result_t commissioning_protocol_build_transcript(
    uint8_t *output,
    size_t output_capacity,
    uint16_t protocol_version,
    const uint8_t *session_id,
    size_t session_id_length,
    const uint8_t *device_key_spki,
    size_t device_key_spki_length,
    const uint8_t *challenge,
    size_t challenge_length,
    uint64_t expires_at_epoch_seconds,
    const uint8_t *client_context,
    size_t client_context_length,
    const uint8_t *client_nonce,
    size_t client_nonce_length,
    const uint8_t *device_nonce,
    size_t device_nonce_length,
    const uint8_t *client_ephemeral_public_key,
    size_t client_ephemeral_public_key_length,
    const uint8_t *device_ephemeral_public_key,
    size_t device_ephemeral_public_key_length,
    size_t *output_length
) {
    if (output == NULL || output_length == NULL || output_capacity == 0U ||
        protocol_version == 0U) return COMMISSIONING_PROTOCOL_INVALID;
    size_t offset = 0U;
    const uint8_t *domain = (const uint8_t *)COMMISSIONING_PROTOCOL_DOMAIN;
    if (!append_field(output, output_capacity, &offset, domain, strlen((const char *)domain)) ||
        !append_u16(output, output_capacity, &offset, protocol_version) ||
        !append_field(output, output_capacity, &offset, session_id, session_id_length) ||
        !append_field(output, output_capacity, &offset, device_key_spki, device_key_spki_length) ||
        !append_field(output, output_capacity, &offset, challenge, challenge_length) ||
        !append_u64(output, output_capacity, &offset, expires_at_epoch_seconds) ||
        !append_field(output, output_capacity, &offset, client_context, client_context_length) ||
        !append_field(output, output_capacity, &offset, client_nonce, client_nonce_length) ||
        !append_field(output, output_capacity, &offset, device_nonce, device_nonce_length) ||
        !append_field(output, output_capacity, &offset, client_ephemeral_public_key, client_ephemeral_public_key_length) ||
        !append_field(output, output_capacity, &offset, device_ephemeral_public_key, device_ephemeral_public_key_length)) {
        if (offset >= output_capacity) return COMMISSIONING_PROTOCOL_TOO_SMALL;
        return COMMISSIONING_PROTOCOL_INVALID;
    }
    *output_length = offset;
    return COMMISSIONING_PROTOCOL_OK;
}
