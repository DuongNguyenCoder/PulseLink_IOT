#pragma once

#include <stddef.h>
#include <stdint.h>

typedef enum {
    COMMISSIONING_PROTOCOL_OK = 0,
    COMMISSIONING_PROTOCOL_INVALID,
    COMMISSIONING_PROTOCOL_TOO_SMALL,
} commissioning_protocol_result_t;

/*
 * Builds the public handshake transcript. Fields are length-prefixed and
 * encoded in network byte order. This function does not encrypt credentials,
 * derive keys or open a transport.
 */
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
);
