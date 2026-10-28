#include "commissioning_credential_storage.h"

#include <assert.h>
#include <string.h>

typedef struct {
    uint8_t value[256];
    size_t length;
    commissioning_storage_result_t next_result;
} fake_storage_t;

static commissioning_storage_result_t fake_save(void *context, const uint8_t *value, size_t length) {
    fake_storage_t *fake = context;
    if (fake->next_result != COMMISSIONING_STORAGE_OK) return fake->next_result;
    memcpy(fake->value, value, length);
    fake->length = length;
    return COMMISSIONING_STORAGE_OK;
}

static commissioning_storage_result_t fake_load(void *context, uint8_t *value, size_t capacity, size_t *length) {
    fake_storage_t *fake = context;
    if (fake->next_result != COMMISSIONING_STORAGE_OK) return fake->next_result;
    if (fake->length == 0U || fake->length > capacity) return COMMISSIONING_STORAGE_INVALID;
    memcpy(value, fake->value, fake->length);
    *length = fake->length;
    return COMMISSIONING_STORAGE_OK;
}

int main(void) {
    uint8_t value[256] = "credential";
    uint8_t loaded[256] = { 0 };
    size_t loaded_length = 0U;
    commissioning_credential_storage_t unavailable = { 0 };
    assert(!commissioning_credential_storage_is_ready(&unavailable));
    assert(commissioning_credential_storage_save(&unavailable, value, 10U) == COMMISSIONING_STORAGE_UNAVAILABLE);

    fake_storage_t fake = { .next_result = COMMISSIONING_STORAGE_OK };
    commissioning_credential_storage_t storage = { .context = &fake, .save = fake_save, .load = fake_load };
    assert(commissioning_credential_storage_is_ready(&storage));
    commissioning_credential_storage_t missing_context = { .save = fake_save, .load = fake_load };
    assert(!commissioning_credential_storage_is_ready(&missing_context));
    commissioning_credential_storage_t missing_save = { .context = &fake, .load = fake_load };
    commissioning_credential_storage_t missing_load = { .context = &fake, .save = fake_save };
    assert(!commissioning_credential_storage_is_ready(&missing_save));
    assert(!commissioning_credential_storage_is_ready(&missing_load));
    assert(commissioning_credential_storage_save(&storage, value, 10U) == COMMISSIONING_STORAGE_OK);
    assert(commissioning_credential_storage_load(&storage, loaded, sizeof(loaded), &loaded_length) == COMMISSIONING_STORAGE_OK);
    assert(loaded_length == 10U && memcmp(loaded, value, loaded_length) == 0);

    fake.next_result = COMMISSIONING_STORAGE_IO_ERROR;
    assert(commissioning_credential_storage_save(&storage, (const uint8_t *)"new", 3U) == COMMISSIONING_STORAGE_IO_ERROR);
    loaded_length = 10U;
    assert(commissioning_credential_storage_load(&storage, loaded, sizeof(loaded), &loaded_length) == COMMISSIONING_STORAGE_IO_ERROR);
    assert(loaded_length == 0U);
    loaded_length = 10U;
    assert(commissioning_credential_storage_load(&storage, loaded, sizeof(loaded) - 1U, &loaded_length) == COMMISSIONING_STORAGE_INVALID);
    assert(loaded_length == 0U);
    assert(commissioning_credential_storage_save(&storage, NULL, 1U) == COMMISSIONING_STORAGE_INVALID);
    return 0;
}
