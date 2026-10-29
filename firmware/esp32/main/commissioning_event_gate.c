#include "commissioning_event_gate.h"

commissioning_event_gate_result_t commissioning_event_gate_load_token(
    const commissioning_context_t *lifecycle,
    commissioning_credential_storage_t *storage,
    uint8_t *token,
    size_t capacity,
    size_t *length
) {
    if (length != NULL) *length = 0U;
    if (token != NULL) {
        volatile uint8_t *bytes = token;
        for (size_t index = 0U; index < capacity; index++) bytes[index] = 0U;
    }
    if (lifecycle == NULL || commissioning_state(lifecycle) != COMMISSIONING_ONLINE) {
        return COMMISSIONING_EVENT_GATE_NOT_ONLINE;
    }
    commissioning_storage_result_t result = commissioning_credential_storage_load(
        storage, token, capacity, length);
    switch (result) {
        case COMMISSIONING_STORAGE_OK: return COMMISSIONING_EVENT_GATE_OK;
        case COMMISSIONING_STORAGE_UNAVAILABLE: return COMMISSIONING_EVENT_GATE_STORAGE_UNAVAILABLE;
        case COMMISSIONING_STORAGE_INVALID: return COMMISSIONING_EVENT_GATE_STORAGE_INVALID;
        case COMMISSIONING_STORAGE_IO_ERROR: return COMMISSIONING_EVENT_GATE_STORAGE_IO_ERROR;
        default: return COMMISSIONING_EVENT_GATE_STORAGE_IO_ERROR;
    }
}

