#pragma once

#include <stddef.h>
#include <stdint.h>

#include "commissioning_credential_storage.h"
#include "commissioning_state.h"

typedef enum {
    COMMISSIONING_EVENT_GATE_OK = 0,
    COMMISSIONING_EVENT_GATE_NOT_ONLINE,
    COMMISSIONING_EVENT_GATE_STORAGE_UNAVAILABLE,
    COMMISSIONING_EVENT_GATE_STORAGE_INVALID,
    COMMISSIONING_EVENT_GATE_STORAGE_IO_ERROR,
} commissioning_event_gate_result_t;

commissioning_event_gate_result_t commissioning_event_gate_load_token(
    const commissioning_context_t *lifecycle,
    commissioning_credential_storage_t *storage,
    uint8_t *token,
    size_t capacity,
    size_t *length
);

