#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "mbedtls/ecp.h"

typedef struct {
    mbedtls_ecp_keypair key;
    bool initialized;
} commissioning_ephemeral_key_t;

bool commissioning_crypto_ephemeral_generate(commissioning_ephemeral_key_t *key);
bool commissioning_crypto_ephemeral_public_key(
    const commissioning_ephemeral_key_t *key,
    uint8_t *output,
    size_t output_capacity,
    size_t *output_length
);
bool commissioning_crypto_ephemeral_shared_secret(
    const commissioning_ephemeral_key_t *key,
    const uint8_t *peer_public_key,
    size_t peer_public_key_length,
    uint8_t *output,
    size_t output_capacity,
    size_t *output_length
);
void commissioning_crypto_ephemeral_free(commissioning_ephemeral_key_t *key);

bool commissioning_crypto_hkdf_sha256(
    const uint8_t *shared_secret,
    size_t shared_secret_length,
    const uint8_t *salt,
    size_t salt_length,
    const uint8_t *info,
    size_t info_length,
    uint8_t *output,
    size_t output_length
);

bool commissioning_crypto_aes128_gcm_encrypt(
    const uint8_t key[16],
    const uint8_t nonce[12],
    const uint8_t *aad,
    size_t aad_length,
    const uint8_t *plaintext,
    size_t plaintext_length,
    uint8_t *ciphertext,
    uint8_t tag[16]
);

bool commissioning_crypto_aes128_gcm_decrypt(
    const uint8_t key[16],
    const uint8_t nonce[12],
    const uint8_t *aad,
    size_t aad_length,
    const uint8_t *ciphertext,
    size_t ciphertext_length,
    const uint8_t tag[16],
    uint8_t *plaintext
);

bool commissioning_crypto_verify_signature(
    const uint8_t *public_key_spki,
    size_t public_key_spki_length,
    const uint8_t *message,
    size_t message_length,
    const uint8_t *signature_der,
    size_t signature_der_length
);
