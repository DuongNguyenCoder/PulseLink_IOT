#include "esp_device_identity_provider.h"

#include <stddef.h>

#include "sdkconfig.h"

#if CONFIG_PULSELINK_DEVICE_IDENTITY_NVS_PROVIDER && CONFIG_NVS_ENCRYPTION

#include <string.h>

#include "esp_err.h"
#include "mbedtls/ctr_drbg.h"
#include "mbedtls/ecp.h"
#include "mbedtls/entropy.h"
#include "mbedtls/pk.h"
#include "mbedtls/sha256.h"
#include "nvs.h"

#define IDENTITY_KEY_NAME "key_record"
#define IDENTITY_KEY_MAGIC 0x504C4B31U
#define IDENTITY_KEY_MAX_DER 512U

typedef struct {
    uint32_t magic;
    uint32_t version;
    uint32_t der_length;
    uint8_t der[IDENTITY_KEY_MAX_DER];
} identity_key_record_t;

static esp_err_t setup_rng(mbedtls_entropy_context *entropy, mbedtls_ctr_drbg_context *drbg) {
    static const unsigned char personalization[] = "pulselink-device-identity";
    mbedtls_entropy_init(entropy);
    mbedtls_ctr_drbg_init(drbg);
    return mbedtls_ctr_drbg_seed(
        drbg, mbedtls_entropy_func, entropy, personalization,
        sizeof(personalization) - 1U
    ) == 0 ? ESP_OK : ESP_FAIL;
}

static device_key_provider_result_t load_record(
    esp_device_identity_provider_t *provider,
    identity_key_record_t *record
) {
    nvs_handle_t handle = 0;
    esp_err_t err = nvs_open(provider->nvs_namespace, NVS_READONLY, &handle);
    if (err != ESP_OK) return err == ESP_ERR_NVS_NOT_FOUND ? DEVICE_KEY_PROVIDER_NOT_FOUND : DEVICE_KEY_PROVIDER_IO_ERROR;
    size_t length = sizeof(*record);
    err = nvs_get_blob(handle, IDENTITY_KEY_NAME, record, &length);
    nvs_close(handle);
    if (err == ESP_ERR_NVS_NOT_FOUND) return DEVICE_KEY_PROVIDER_NOT_FOUND;
    if (err != ESP_OK) return DEVICE_KEY_PROVIDER_IO_ERROR;
    if (length != sizeof(*record) || record->magic != IDENTITY_KEY_MAGIC ||
        record->version == 0U || record->der_length == 0U ||
        record->der_length > IDENTITY_KEY_MAX_DER) return DEVICE_KEY_PROVIDER_CORRUPT;
    return DEVICE_KEY_PROVIDER_OK;
}

static device_key_provider_result_t parse_record(
    const identity_key_record_t *record,
    mbedtls_pk_context *key
) {
    mbedtls_pk_init(key);
    if (mbedtls_pk_parse_key(key, record->der, record->der_length, NULL, 0U, NULL, NULL) != 0 ||
        !mbedtls_pk_can_do(key, MBEDTLS_PK_ECKEY) || mbedtls_pk_get_bitlen(key) != 256U ||
        mbedtls_ecp_keypair_get_group_id(mbedtls_pk_ec(*key)) != MBEDTLS_ECP_DP_SECP256R1) {
        mbedtls_pk_free(key);
        return DEVICE_KEY_PROVIDER_CORRUPT;
    }
    return DEVICE_KEY_PROVIDER_OK;
}

static device_key_provider_result_t provider_generate(void *context, uint32_t key_version) {
    esp_device_identity_provider_t *provider = context;
    identity_key_record_t existing;
    device_key_provider_result_t existing_result = load_record(provider, &existing);
    if (existing_result == DEVICE_KEY_PROVIDER_OK) return DEVICE_KEY_PROVIDER_INVALID;
    if (existing_result == DEVICE_KEY_PROVIDER_CORRUPT || existing_result != DEVICE_KEY_PROVIDER_NOT_FOUND || key_version == 0U) {
        return existing_result == DEVICE_KEY_PROVIDER_CORRUPT ? existing_result : DEVICE_KEY_PROVIDER_IO_ERROR;
    }

    mbedtls_entropy_context entropy;
    mbedtls_ctr_drbg_context drbg;
    if (setup_rng(&entropy, &drbg) != ESP_OK) return DEVICE_KEY_PROVIDER_IO_ERROR;
    mbedtls_pk_context key;
    mbedtls_pk_init(&key);
    int result = mbedtls_pk_setup(&key, mbedtls_pk_info_from_type(MBEDTLS_PK_ECKEY));
    if (result == 0) result = mbedtls_ecp_gen_key(MBEDTLS_ECP_DP_SECP256R1, mbedtls_pk_ec(key), mbedtls_ctr_drbg_random, &drbg);
    identity_key_record_t record = { .magic = IDENTITY_KEY_MAGIC, .version = key_version };
    if (result == 0) {
        int written = mbedtls_pk_write_key_der(&key, record.der, sizeof(record.der));
        if (written <= 0) result = written;
        else {
            memmove(record.der, record.der + sizeof(record.der) - (size_t)written, (size_t)written);
            record.der_length = (uint32_t)written;
        }
    }
    mbedtls_pk_free(&key);
    mbedtls_ctr_drbg_free(&drbg);
    mbedtls_entropy_free(&entropy);
    if (result != 0) return DEVICE_KEY_PROVIDER_IO_ERROR;

    nvs_handle_t handle = 0;
    esp_err_t err = nvs_open(provider->nvs_namespace, NVS_READWRITE, &handle);
    if (err == ESP_OK) err = nvs_set_blob(handle, IDENTITY_KEY_NAME, &record, sizeof(record));
    if (err == ESP_OK) err = nvs_commit(handle);
    if (handle != 0) nvs_close(handle);
    return err == ESP_OK ? DEVICE_KEY_PROVIDER_OK : DEVICE_KEY_PROVIDER_IO_ERROR;
}

static device_key_provider_result_t provider_load(
    void *context, uint8_t *public_key, size_t public_key_capacity,
    size_t *public_key_length, uint32_t *key_version
) {
    esp_device_identity_provider_t *provider = context;
    identity_key_record_t record;
    device_key_provider_result_t result = load_record(provider, &record);
    if (result != DEVICE_KEY_PROVIDER_OK) return result;
    mbedtls_pk_context key;
    result = parse_record(&record, &key);
    if (result != DEVICE_KEY_PROVIDER_OK) return result;
    unsigned char encoded[160];
    int written = mbedtls_pk_write_pubkey_der(&key, encoded, sizeof(encoded));
    mbedtls_pk_free(&key);
    if (written <= 0 || (size_t)written > public_key_capacity) return DEVICE_KEY_PROVIDER_CORRUPT;
    memcpy(public_key, encoded + sizeof(encoded) - (size_t)written, (size_t)written);
    *public_key_length = (size_t)written;
    *key_version = record.version;
    return DEVICE_KEY_PROVIDER_OK;
}

static device_key_provider_result_t provider_sign(
    void *context, const uint8_t *message, size_t message_length,
    uint8_t *signature, size_t signature_capacity, size_t *signature_length
) {
    esp_device_identity_provider_t *provider = context;
    identity_key_record_t record;
    device_key_provider_result_t result = load_record(provider, &record);
    if (result != DEVICE_KEY_PROVIDER_OK) return result;
    mbedtls_pk_context key;
    result = parse_record(&record, &key);
    if (result != DEVICE_KEY_PROVIDER_OK) return result;
    unsigned char hash[32];
    mbedtls_sha256(message, message_length, hash, 0);
    mbedtls_entropy_context entropy;
    mbedtls_ctr_drbg_context drbg;
    if (setup_rng(&entropy, &drbg) != ESP_OK) {
        mbedtls_pk_free(&key);
        return DEVICE_KEY_PROVIDER_IO_ERROR;
    }
    int signed_result = mbedtls_pk_sign(&key, MBEDTLS_MD_SHA256, hash, sizeof(hash), signature,
        signature_capacity, signature_length, mbedtls_ctr_drbg_random, &drbg);
    mbedtls_ctr_drbg_free(&drbg);
    mbedtls_entropy_free(&entropy);
    mbedtls_pk_free(&key);
    return signed_result == 0 ? DEVICE_KEY_PROVIDER_OK : DEVICE_KEY_PROVIDER_IO_ERROR;
}

static device_key_provider_result_t provider_revoke(void *context) {
    esp_device_identity_provider_t *provider = context;
    nvs_handle_t handle = 0;
    esp_err_t err = nvs_open(provider->nvs_namespace, NVS_READWRITE, &handle);
    if (err == ESP_ERR_NVS_NOT_FOUND) return DEVICE_KEY_PROVIDER_NOT_FOUND;
    if (err != ESP_OK) return DEVICE_KEY_PROVIDER_IO_ERROR;
    err = nvs_erase_key(handle, IDENTITY_KEY_NAME);
    if (err == ESP_OK) err = nvs_commit(handle);
    nvs_close(handle);
    return err == ESP_OK || err == ESP_ERR_NVS_NOT_FOUND ? DEVICE_KEY_PROVIDER_OK : DEVICE_KEY_PROVIDER_IO_ERROR;
}

bool esp_device_identity_provider_is_available(void) { return true; }

#else

static device_key_provider_result_t stub_load(void *context, uint8_t *key, size_t cap, size_t *len, uint32_t *version) {
    (void)context; (void)key; (void)cap; (void)len; (void)version; return DEVICE_KEY_PROVIDER_INVALID;
}
static device_key_provider_result_t stub_generate(void *context, uint32_t version) {
    (void)context; (void)version; return DEVICE_KEY_PROVIDER_INVALID;
}
static device_key_provider_result_t stub_sign(void *context, const uint8_t *msg, size_t msg_len, uint8_t *sig, size_t cap, size_t *len) {
    (void)context; (void)msg; (void)msg_len; (void)sig; (void)cap; (void)len; return DEVICE_KEY_PROVIDER_INVALID;
}
static device_key_provider_result_t stub_revoke(void *context) {
    (void)context; return DEVICE_KEY_PROVIDER_INVALID;
}
bool esp_device_identity_provider_is_available(void) { return false; }

#endif

bool esp_device_identity_provider_init(esp_device_identity_provider_t *provider, const char *nvs_namespace) {
    if (provider == NULL || nvs_namespace == NULL || nvs_namespace[0] == '\0') return false;
    provider->nvs_namespace = nvs_namespace;
    return esp_device_identity_provider_is_available();
}

device_key_provider_t esp_device_identity_provider_as_provider(esp_device_identity_provider_t *provider) {
#if CONFIG_PULSELINK_DEVICE_IDENTITY_NVS_PROVIDER && CONFIG_NVS_ENCRYPTION
    return (device_key_provider_t){ .context = provider, .load_public_key = provider_load, .generate_key = provider_generate, .sign_der = provider_sign, .revoke = provider_revoke };
#else
    return (device_key_provider_t){ .context = provider, .load_public_key = stub_load, .generate_key = stub_generate, .sign_der = stub_sign, .revoke = stub_revoke };
#endif
}
