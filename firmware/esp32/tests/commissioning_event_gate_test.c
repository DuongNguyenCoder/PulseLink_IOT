#include "commissioning_event_gate.h"

#include <assert.h>
#include <string.h>

typedef struct { uint8_t value[256]; size_t length; commissioning_storage_result_t result; } fake_storage_t;
static commissioning_storage_result_t fake_load(void *context, uint8_t *value, size_t capacity, size_t *length) {
    fake_storage_t *fake = context;
    if (fake->result != COMMISSIONING_STORAGE_OK) return fake->result;
    if (fake->length > capacity) return COMMISSIONING_STORAGE_INVALID;
    memcpy(value, fake->value, fake->length); *length = fake->length; return COMMISSIONING_STORAGE_OK;
}
static commissioning_storage_result_t fake_save(void *context, const uint8_t *value, size_t length) {
    fake_storage_t *fake = context; memcpy(fake->value, value, length); fake->length = length; return COMMISSIONING_STORAGE_OK;
}

static void online(commissioning_context_t *lifecycle) {
    commissioning_init(lifecycle);
    assert(commissioning_begin(lifecycle, 0U, 10000U));
    assert(commissioning_accept_physical(lifecycle, 1U));
    assert(commissioning_transition(lifecycle, COMMISSIONING_RECEIVING_CONFIG));
    assert(commissioning_transition(lifecycle, COMMISSIONING_CONNECTING_TO_WIFI));
    assert(commissioning_transition(lifecycle, COMMISSIONING_WIFI_CONNECTED));
    assert(commissioning_transition(lifecycle, COMMISSIONING_REDEEMING));
    assert(commissioning_transition(lifecycle, COMMISSIONING_CREDENTIAL_PERSISTING));
    assert(commissioning_transition(lifecycle, COMMISSIONING_ONLINE));
}

int main(void) {
    commissioning_context_t lifecycle;
    fake_storage_t fake = { .result = COMMISSIONING_STORAGE_OK };
    commissioning_credential_storage_t storage = { .context = &fake, .save = fake_save, .load = fake_load };
    uint8_t token[256] = { 0 }; size_t length = 0U;
    memcpy(fake.value, "event-token", 11U); fake.length = 11U;

    commissioning_init(&lifecycle);
    assert(commissioning_event_gate_load_token(&lifecycle, &storage, token, sizeof(token), &length) == COMMISSIONING_EVENT_GATE_NOT_ONLINE);
    online(&lifecycle);
    assert(commissioning_event_gate_load_token(&lifecycle, &storage, token, sizeof(token), &length) == COMMISSIONING_EVENT_GATE_OK);
    assert(length == 11U && memcmp(token, "event-token", 11U) == 0);
    fake.result = COMMISSIONING_STORAGE_UNAVAILABLE;
    assert(commissioning_event_gate_load_token(&lifecycle, &storage, token, sizeof(token), &length) == COMMISSIONING_EVENT_GATE_STORAGE_UNAVAILABLE);
    fake.result = COMMISSIONING_STORAGE_INVALID;
    assert(commissioning_event_gate_load_token(&lifecycle, &storage, token, sizeof(token), &length) == COMMISSIONING_EVENT_GATE_STORAGE_INVALID);
    fake.result = COMMISSIONING_STORAGE_IO_ERROR;
    assert(commissioning_event_gate_load_token(&lifecycle, &storage, token, sizeof(token), &length) == COMMISSIONING_EVENT_GATE_STORAGE_IO_ERROR);
    return 0;
}

