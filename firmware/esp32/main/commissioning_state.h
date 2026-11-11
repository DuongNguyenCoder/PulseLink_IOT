#pragma once

#include <stdbool.h>
#include <stdint.h>

typedef enum {
    COMMISSIONING_IDLE = 0,
    COMMISSIONING_WAITING_FOR_PHYSICAL_CONFIRMATION,
    COMMISSIONING_SOFTAP_ACTIVE,
    COMMISSIONING_RECEIVING_CONFIG,
    COMMISSIONING_REDEEMING,
    COMMISSIONING_CREDENTIAL_PERSISTING,
    COMMISSIONING_CONNECTING_TO_WIFI,
    COMMISSIONING_WIFI_CONNECTED,
    COMMISSIONING_ONLINE,
    COMMISSIONING_RETRY_WAIT,
    COMMISSIONING_FAILED,
    COMMISSIONING_EXPIRED,
    COMMISSIONING_CANCELLED,
} commissioning_state_t;

typedef struct {
    commissioning_state_t state;
    uint32_t started_at_ms;
    uint32_t deadline_at_ms;
    bool session_consumed;
} commissioning_context_t;

enum {
    /* Bounded SoftAP time starts after physical confirmation and AP startup. */
    COMMISSIONING_PAIRING_WINDOW_MS = 5U * 60U * 1000U,
};

void commissioning_init(commissioning_context_t *context);
bool commissioning_begin(
    commissioning_context_t *context,
    uint32_t now_ms,
    uint32_t window_ms
);
bool commissioning_begin_backend_recovery(commissioning_context_t *context, uint32_t now_ms);
bool commissioning_start_softap_window(
    commissioning_context_t *context,
    uint32_t now_ms,
    uint32_t window_ms
);
bool commissioning_accept_physical(commissioning_context_t *context, uint32_t now_ms);
bool commissioning_transition(commissioning_context_t *context, commissioning_state_t next);
bool commissioning_retry_handshake(commissioning_context_t *context);
bool commissioning_consume_session(commissioning_context_t *context);
bool commissioning_expire_if_needed(commissioning_context_t *context, uint32_t now_ms);
bool commissioning_cancel(commissioning_context_t *context);
bool commissioning_fail(commissioning_context_t *context);
commissioning_state_t commissioning_state(const commissioning_context_t *context);
bool commissioning_session_consumed(const commissioning_context_t *context);
