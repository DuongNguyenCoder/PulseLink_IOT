#include "commissioning_credential_storage.h"

#include "sdkconfig.h"

#define OPERATIONAL_CREDENTIAL_MAX 256U

bool commissioning_credential_storage_is_ready(const commissioning_credential_storage_t *storage) {
    (void)storage;
#if CONFIG_PULSELINK_OPERATIONAL_CREDENTIAL_STORAGE && CONFIG_NVS_ENCRYPTION
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
    if (value == NULL || length == NULL || capacity < OPERATIONAL_CREDENTIAL_MAX) return COMMISSIONING_STORAGE_INVALID;
    if (!commissioning_credential_storage_is_ready(storage)) return COMMISSIONING_STORAGE_UNAVAILABLE;
    return storage->load(storage->context, value, capacity, length);
}
