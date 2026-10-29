#include "esp_device_credential_storage.h"

#include <assert.h>
#include <string.h>

#include "nvs.h"

static uint8_t s_committed[512];
static uint8_t s_staged[512];
static size_t s_committed_length;
static size_t s_staged_length;
static bool s_has_value;
static bool s_fail_set;
static bool s_fail_commit;
static bool s_fail_get;

esp_err_t nvs_open(const char *name, nvs_open_mode_t mode, nvs_handle_t *handle) {
    (void)mode;
    if (name == NULL || handle == NULL) return ESP_FAIL;
    *handle = 1U;
    return ESP_OK;
}
void nvs_close(nvs_handle_t handle) { (void)handle; }
esp_err_t nvs_set_blob(nvs_handle_t handle, const char *key, const void *value, size_t length) {
    (void)handle; (void)key;
    if (s_fail_set) return ESP_FAIL;
    if (value == NULL || length > sizeof(s_staged)) return ESP_ERR_NVS_INVALID_LENGTH;
    memcpy(s_staged, value, length);
    s_staged_length = length;
    return ESP_OK;
}
esp_err_t nvs_get_blob(nvs_handle_t handle, const char *key, void *value, size_t *length) {
    (void)handle; (void)key;
    if (s_fail_get) return ESP_FAIL;
    if (!s_has_value) return ESP_ERR_NVS_NOT_FOUND;
    if (length == NULL) return ESP_FAIL;
    if (value == NULL || *length < s_committed_length) {
        *length = s_committed_length;
        return ESP_ERR_NVS_INVALID_LENGTH;
    }
    memcpy(value, s_committed, s_committed_length);
    *length = s_committed_length;
    return ESP_OK;
}
esp_err_t nvs_commit(nvs_handle_t handle) {
    (void)handle;
    if (s_fail_commit) return ESP_FAIL;
    memcpy(s_committed, s_staged, s_staged_length);
    s_committed_length = s_staged_length;
    s_has_value = true;
    return ESP_OK;
}

int main(void) {
    esp_device_credential_storage_t provider;
    commissioning_credential_storage_t storage;
    uint8_t loaded[256];
    size_t length = 55U;
    const uint8_t token[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopA";
    assert(sizeof(token) - 1U == 43U);
    memset(loaded, 0xA5, sizeof(loaded));
    assert(esp_device_credential_storage_init(&provider, "opcred", &storage));
    assert(commissioning_credential_storage_is_ready(&storage));

    assert(commissioning_credential_storage_load(&storage, loaded, sizeof(loaded), &length) == COMMISSIONING_STORAGE_UNAVAILABLE);
    assert(length == 0U);
    for (size_t index = 0U; index < sizeof(loaded); index++) assert(loaded[index] == 0U);
    assert(commissioning_credential_storage_save(&storage, token, sizeof(token) - 2U) == COMMISSIONING_STORAGE_INVALID);
    assert(commissioning_credential_token_format_valid(token, sizeof(token) - 1U));

    assert(commissioning_credential_storage_save(&storage, token, sizeof(token) - 1U) == COMMISSIONING_STORAGE_OK);
    memset(loaded, 0, sizeof(loaded));
    assert(commissioning_credential_storage_load(&storage, loaded, sizeof(loaded), &length) == COMMISSIONING_STORAGE_OK);
    assert(length == sizeof(token) - 1U && memcmp(loaded, token, length) == 0);

    s_fail_commit = true;
    assert(commissioning_credential_storage_save(&storage, token, sizeof(token) - 1U) == COMMISSIONING_STORAGE_IO_ERROR);
    s_fail_commit = false;
    s_fail_get = true;
    memset(loaded, 0xA5, sizeof(loaded));
    length = 55U;
    assert(commissioning_credential_storage_load(&storage, loaded, sizeof(loaded), &length) == COMMISSIONING_STORAGE_IO_ERROR);
    assert(length == 0U);
    for (size_t index = 0U; index < sizeof(loaded); index++) assert(loaded[index] == 0U);
    s_fail_get = false;

    s_committed[0] ^= 0xFFU;
    memset(loaded, 0xA5, sizeof(loaded));
    length = 55U;
    assert(commissioning_credential_storage_load(&storage, loaded, sizeof(loaded), &length) == COMMISSIONING_STORAGE_INVALID);
    assert(length == 0U);
    for (size_t index = 0U; index < sizeof(loaded); index++) assert(loaded[index] == 0U);
    return 0;
}
