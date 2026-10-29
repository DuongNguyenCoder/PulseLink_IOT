#include "commissioning_credential_storage.h"

#include <string.h>

#include "sdkconfig.h"

#define OPERATIONAL_CREDENTIAL_MAX 256U
#define OPERATIONAL_TOKEN_LENGTH 43U

static void clear_buffer(void *value, size_t length) {
    volatile uint8_t *bytes = value;
    while (length-- > 0U) *bytes++ = 0U;
}

bool commissioning_credential_token_format_valid(const uint8_t *value, size_t length) {
    if (value == NULL || length != OPERATIONAL_TOKEN_LENGTH) return false;
    for (size_t index = 0U; index < length; index++) {
        uint8_t ch = value[index];
        if (!((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') ||
              (ch >= '0' && ch <= '9') || ch == '-' || ch == '_')) return false;
    }
    const char *canonical_last_chars = "AEIMQUYcgkosw048";
    bool canonical = false;
    for (size_t index = 0U; canonical_last_chars[index] != '\0'; index++) {
        if (value[length - 1U] == (uint8_t)canonical_last_chars[index]) canonical = true;
    }
    if (!canonical) return false;
    return true;
}

bool commissioning_credential_storage_is_ready(const commissioning_credential_storage_t *storage) {
    (void)storage;
#if CONFIG_PULSELINK_OPERATIONAL_CREDENTIAL_STORAGE
    return storage != NULL && storage->context != NULL && storage->save != NULL && storage->load != NULL;
#else
    return false;
#endif
}

commissioning_storage_result_t commissioning_credential_storage_save(
    commissioning_credential_storage_t *storage, const uint8_t *value, size_t length) {
    if (value == NULL || length == 0U || length > OPERATIONAL_CREDENTIAL_MAX) return COMMISSIONING_STORAGE_INVALID;
    if (!commissioning_credential_storage_is_ready(storage)) return COMMISSIONING_STORAGE_UNAVAILABLE;
    return storage->save(storage->context, value, length);
}

commissioning_storage_result_t commissioning_credential_storage_load(
    commissioning_credential_storage_t *storage, uint8_t *value, size_t capacity, size_t *length) {
    if (length != NULL) *length = 0U;
    if (value == NULL || length == NULL) return COMMISSIONING_STORAGE_INVALID;
    if (capacity < OPERATIONAL_CREDENTIAL_MAX) {
        clear_buffer(value, capacity);
        return COMMISSIONING_STORAGE_INVALID;
    }
    commissioning_storage_result_t result = COMMISSIONING_STORAGE_UNAVAILABLE;
    if (commissioning_credential_storage_is_ready(storage)) {
        result = storage->load(storage->context, value, capacity, length);
    }
    if (result != COMMISSIONING_STORAGE_OK || *length == 0U || *length > capacity) {
        clear_buffer(value, capacity);
        *length = 0U;
        return result == COMMISSIONING_STORAGE_OK ? COMMISSIONING_STORAGE_INVALID : result;
    }
    return COMMISSIONING_STORAGE_OK;
}
