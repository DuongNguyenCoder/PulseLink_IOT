#include "esp_device_credential_storage.h"

#include <string.h>

#include "esp_err.h"
#include "nvs.h"
#include "sdkconfig.h"

#define OPERATIONAL_TOKEN_LENGTH 43U
#define OPERATIONAL_RECORD_MAGIC 0x504C4F43U
#define OPERATIONAL_RECORD_VERSION 1U
#define OPERATIONAL_RECORD_KEY "token_v1"

typedef struct {
    uint32_t magic;
    uint16_t version;
    uint16_t length;
    uint8_t token[OPERATIONAL_TOKEN_LENGTH];
} operational_record_t;

#if CONFIG_PULSELINK_OPERATIONAL_CREDENTIAL_STORAGE
static void clear_sensitive(void *value, size_t length) {
    volatile uint8_t *bytes = value;
    while (length-- > 0U) *bytes++ = 0U;
}

static commissioning_storage_result_t map_nvs_error(esp_err_t error) {
    if (error == ESP_ERR_NVS_NOT_FOUND) return COMMISSIONING_STORAGE_UNAVAILABLE;
    if (error == ESP_ERR_NVS_INVALID_LENGTH || error == ESP_ERR_NVS_TYPE_MISMATCH) return COMMISSIONING_STORAGE_INVALID;
    return COMMISSIONING_STORAGE_IO_ERROR;
}

static commissioning_storage_result_t provider_save(void *context, const uint8_t *token, size_t length) {
    esp_device_credential_storage_t *provider = context;
    if (provider == NULL || !provider->initialized) return COMMISSIONING_STORAGE_UNAVAILABLE;
    if (!commissioning_credential_token_format_valid(token, length)) return COMMISSIONING_STORAGE_INVALID;

    operational_record_t record = { .magic = OPERATIONAL_RECORD_MAGIC,
        .version = OPERATIONAL_RECORD_VERSION, .length = OPERATIONAL_TOKEN_LENGTH };
    memcpy(record.token, token, length);
    nvs_handle_t handle = 0U;
    esp_err_t error = nvs_open(provider->nvs_namespace, NVS_READWRITE, &handle);
    if (error == ESP_OK) {
        error = nvs_set_blob(handle, OPERATIONAL_RECORD_KEY, &record, sizeof(record));
        if (error == ESP_OK) error = nvs_commit(handle);
        nvs_close(handle);
    }
    clear_sensitive(&record, sizeof(record));
    if (error != ESP_OK) return COMMISSIONING_STORAGE_IO_ERROR;

    uint8_t readback[OPERATIONAL_TOKEN_LENGTH] = { 0 };
    commissioning_storage_result_t result = COMMISSIONING_STORAGE_IO_ERROR;
    nvs_handle_t verify_handle = 0U;
    error = nvs_open(provider->nvs_namespace, NVS_READONLY, &verify_handle);
    if (error == ESP_OK) {
        operational_record_t verify_record = { 0 };
        size_t record_length = sizeof(verify_record);
        error = nvs_get_blob(verify_handle, OPERATIONAL_RECORD_KEY, &verify_record, &record_length);
        nvs_close(verify_handle);
        if (error == ESP_OK && record_length == sizeof(verify_record) &&
            verify_record.magic == OPERATIONAL_RECORD_MAGIC &&
            verify_record.version == OPERATIONAL_RECORD_VERSION &&
            verify_record.length == OPERATIONAL_TOKEN_LENGTH &&
            commissioning_credential_token_format_valid(verify_record.token, sizeof(verify_record.token))) {
            memcpy(readback, verify_record.token, sizeof(readback));
            result = memcmp(readback, token, length) == 0 ? COMMISSIONING_STORAGE_OK : COMMISSIONING_STORAGE_IO_ERROR;
        } else if (error == ESP_OK) {
            result = COMMISSIONING_STORAGE_INVALID;
        } else {
            result = map_nvs_error(error);
        }
        clear_sensitive(&verify_record, sizeof(verify_record));
    } else {
        result = map_nvs_error(error);
    }
    clear_sensitive(readback, sizeof(readback));
    return result;
}

static commissioning_storage_result_t provider_load(void *context, uint8_t *token, size_t capacity, size_t *length) {
    esp_device_credential_storage_t *provider = context;
    if (length != NULL) *length = 0U;
    if (provider == NULL || !provider->initialized) return COMMISSIONING_STORAGE_UNAVAILABLE;
    if (token == NULL || length == NULL || capacity < OPERATIONAL_TOKEN_LENGTH) return COMMISSIONING_STORAGE_INVALID;

    operational_record_t record = { 0 };
    nvs_handle_t handle = 0U;
    esp_err_t error = nvs_open(provider->nvs_namespace, NVS_READONLY, &handle);
    if (error == ESP_OK) {
        size_t record_length = sizeof(record);
        error = nvs_get_blob(handle, OPERATIONAL_RECORD_KEY, &record, &record_length);
        nvs_close(handle);
        if (error == ESP_OK) {
            if (record_length != sizeof(record) || record.magic != OPERATIONAL_RECORD_MAGIC ||
                record.version != OPERATIONAL_RECORD_VERSION || record.length != OPERATIONAL_TOKEN_LENGTH ||
                !commissioning_credential_token_format_valid(record.token, sizeof(record.token))) {
                clear_sensitive(&record, sizeof(record));
                return COMMISSIONING_STORAGE_INVALID;
            }
            memcpy(token, record.token, sizeof(record.token));
            *length = sizeof(record.token);
        }
    }
    clear_sensitive(&record, sizeof(record));
    return error == ESP_OK ? COMMISSIONING_STORAGE_OK : map_nvs_error(error);
}
#endif

bool esp_device_credential_storage_init(
    esp_device_credential_storage_t *provider,
    const char *nvs_namespace,
    commissioning_credential_storage_t *storage
) {
    if (provider == NULL || nvs_namespace == NULL || storage == NULL ||
        nvs_namespace[0] == '\0' || strlen(nvs_namespace) >= sizeof(provider->nvs_namespace)) return false;
    memset(provider, 0, sizeof(*provider));
    memset(storage, 0, sizeof(*storage));
#if CONFIG_PULSELINK_OPERATIONAL_CREDENTIAL_STORAGE
    memcpy(provider->nvs_namespace, nvs_namespace, strlen(nvs_namespace) + 1U);
    nvs_handle_t handle = 0U;
    if (nvs_open(provider->nvs_namespace, NVS_READWRITE, &handle) != ESP_OK) {
        clear_sensitive(provider, sizeof(*provider));
        return false;
    }
    nvs_close(handle);
    provider->initialized = true;
    storage->context = provider;
    storage->save = provider_save;
    storage->load = provider_load;
    return true;
#else
    (void)nvs_namespace;
    return false;
#endif
}

