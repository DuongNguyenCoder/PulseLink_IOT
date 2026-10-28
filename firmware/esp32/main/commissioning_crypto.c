#include "commissioning_crypto.h"

#include <string.h>

#include "mbedtls/ctr_drbg.h"
#include "mbedtls/ecdh.h"
#include "mbedtls/entropy.h"
#include "mbedtls/gcm.h"
#include "mbedtls/hkdf.h"
#include "mbedtls/pk.h"
#include "mbedtls/sha256.h"

static bool rng_init(mbedtls_entropy_context *entropy, mbedtls_ctr_drbg_context *drbg) {
    static const uint8_t personalization[] = "pulselink-commissioning";
    mbedtls_entropy_init(entropy);
    mbedtls_ctr_drbg_init(drbg);
    return mbedtls_ctr_drbg_seed(
        drbg, mbedtls_entropy_func, entropy,
        personalization, sizeof(personalization) - 1U
    ) == 0;
}

bool commissioning_crypto_ephemeral_generate(commissioning_ephemeral_key_t *key) {
    if (key == NULL) return false;
    mbedtls_ecp_keypair_init(&key->key);
    key->initialized = false;
    mbedtls_entropy_context entropy;
    mbedtls_ctr_drbg_context drbg;
    if (!rng_init(&entropy, &drbg)) {
        mbedtls_ctr_drbg_free(&drbg);
        mbedtls_entropy_free(&entropy);
        return false;
    }
    int result = mbedtls_ecp_gen_key(
        MBEDTLS_ECP_DP_SECP256R1, &key->key,
        mbedtls_ctr_drbg_random, &drbg
    );
    mbedtls_ctr_drbg_free(&drbg);
    mbedtls_entropy_free(&entropy);
    key->initialized = result == 0;
    if (!key->initialized) mbedtls_ecp_keypair_free(&key->key);
    return key->initialized;
}

bool commissioning_crypto_ephemeral_public_key(
    const commissioning_ephemeral_key_t *key,
    uint8_t *output,
    size_t output_capacity,
    size_t *output_length
) {
    if (key == NULL || !key->initialized || output == NULL || output_length == NULL) return false;
    size_t written = 0U;
    if (mbedtls_ecp_write_public_key(
        &key->key, MBEDTLS_ECP_PF_UNCOMPRESSED,
        &written, output, output_capacity
    ) != 0) return false;
    *output_length = written;
    return true;
}

bool commissioning_crypto_ephemeral_shared_secret(
    const commissioning_ephemeral_key_t *key,
    const uint8_t *peer_public_key,
    size_t peer_public_key_length,
    uint8_t *output,
    size_t output_capacity,
    size_t *output_length
) {
    if (key == NULL || !key->initialized || peer_public_key == NULL ||
        output == NULL || output_length == NULL || output_capacity < 32U) return false;
    mbedtls_ecp_group group;
    mbedtls_mpi private_key;
    mbedtls_ecp_point peer;
    mbedtls_mpi shared;
    mbedtls_ecp_group_init(&group);
    mbedtls_mpi_init(&private_key);
    mbedtls_ecp_point_init(&peer);
    mbedtls_mpi_init(&shared);
    bool ok = false;
    mbedtls_entropy_context entropy;
    mbedtls_ctr_drbg_context drbg;
    mbedtls_entropy_init(&entropy);
    mbedtls_ctr_drbg_init(&drbg);
    if (mbedtls_ecp_export(&key->key, &group, &private_key, NULL) == 0 &&
        mbedtls_ecp_point_read_binary(&group, &peer, peer_public_key, peer_public_key_length) == 0 &&
        mbedtls_ctr_drbg_seed(
            &drbg, mbedtls_entropy_func, &entropy,
            (const uint8_t *)"pulselink-commissioning",
            sizeof("pulselink-commissioning") - 1U
        ) == 0 &&
        mbedtls_ecdh_compute_shared(
            &group, &shared, &peer, &private_key,
            mbedtls_ctr_drbg_random, &drbg
        ) == 0 && mbedtls_mpi_write_binary(&shared, output, 32U) == 0) {
        *output_length = 32U;
        ok = true;
    }
    mbedtls_ctr_drbg_free(&drbg);
    mbedtls_entropy_free(&entropy);
    mbedtls_mpi_free(&shared);
    mbedtls_ecp_point_free(&peer);
    mbedtls_mpi_free(&private_key);
    mbedtls_ecp_group_free(&group);
    return ok;
}

void commissioning_crypto_ephemeral_free(commissioning_ephemeral_key_t *key) {
    if (key == NULL) return;
    if (key->initialized) mbedtls_ecp_keypair_free(&key->key);
    memset(key, 0, sizeof(*key));
}

bool commissioning_crypto_hkdf_sha256(
    const uint8_t *shared_secret, size_t shared_secret_length,
    const uint8_t *salt, size_t salt_length,
    const uint8_t *info, size_t info_length,
    uint8_t *output, size_t output_length
) {
    if (shared_secret == NULL || shared_secret_length == 0U || output == NULL || output_length == 0U) return false;
    return mbedtls_hkdf(
        mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),
        salt, salt_length, shared_secret, shared_secret_length,
        info, info_length, output, output_length
    ) == 0;
}

bool commissioning_crypto_aes128_gcm_encrypt(
    const uint8_t key[16], const uint8_t nonce[12],
    const uint8_t *aad, size_t aad_length,
    const uint8_t *plaintext, size_t plaintext_length,
    uint8_t *ciphertext, uint8_t tag[16]
) {
    if (key == NULL || nonce == NULL || plaintext == NULL || ciphertext == NULL || tag == NULL) return false;
    mbedtls_gcm_context gcm;
    mbedtls_gcm_init(&gcm);
    bool ok = mbedtls_gcm_setkey(&gcm, MBEDTLS_CIPHER_ID_AES, key, 128) == 0 &&
        mbedtls_gcm_crypt_and_tag(
            &gcm, MBEDTLS_GCM_ENCRYPT, plaintext_length, nonce, 12U,
            aad, aad_length, plaintext, ciphertext, 16U, tag
        ) == 0;
    mbedtls_gcm_free(&gcm);
    return ok;
}

bool commissioning_crypto_aes128_gcm_decrypt(
    const uint8_t key[16], const uint8_t nonce[12],
    const uint8_t *aad, size_t aad_length,
    const uint8_t *ciphertext, size_t ciphertext_length,
    const uint8_t tag[16], uint8_t *plaintext
) {
    if (key == NULL || nonce == NULL || ciphertext == NULL || tag == NULL || plaintext == NULL) return false;
    mbedtls_gcm_context gcm;
    mbedtls_gcm_init(&gcm);
    bool ok = mbedtls_gcm_setkey(&gcm, MBEDTLS_CIPHER_ID_AES, key, 128) == 0 &&
        mbedtls_gcm_auth_decrypt(
            &gcm, ciphertext_length, nonce, 12U,
            aad, aad_length, tag, 16U, ciphertext, plaintext
        ) == 0;
    mbedtls_gcm_free(&gcm);
    return ok;
}

bool commissioning_crypto_verify_signature(
    const uint8_t *public_key_spki, size_t public_key_spki_length,
    const uint8_t *message, size_t message_length,
    const uint8_t *signature_der, size_t signature_der_length
) {
    if (public_key_spki == NULL || message == NULL || signature_der == NULL) return false;
    mbedtls_pk_context key;
    mbedtls_pk_init(&key);
    uint8_t hash[32];
    mbedtls_sha256(message, message_length, hash, 0);
    bool ok = mbedtls_pk_parse_public_key(&key, public_key_spki, public_key_spki_length) == 0 &&
        mbedtls_pk_verify(&key, MBEDTLS_MD_SHA256, hash, sizeof(hash), signature_der, signature_der_length) == 0;
    mbedtls_pk_free(&key);
    memset(hash, 0, sizeof(hash));
    return ok;
}
