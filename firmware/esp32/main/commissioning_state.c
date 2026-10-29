#include "commissioning_state.h"

#include <stddef.h>

static bool elapsed(uint32_t now_ms, uint32_t start_ms, uint32_t duration_ms) {
    return (uint32_t)(now_ms - start_ms) >= duration_ms;
}

static bool terminal(commissioning_state_t state) {
    return state == COMMISSIONING_ONLINE ||
        state == COMMISSIONING_FAILED ||
        state == COMMISSIONING_EXPIRED ||
        state == COMMISSIONING_CANCELLED;
}

void commissioning_init(commissioning_context_t *context) {
    if (context == NULL) return;
    context->state = COMMISSIONING_IDLE;
    context->started_at_ms = 0U;
    context->deadline_at_ms = 0U;
    context->session_consumed = false;
}

bool commissioning_begin(
    commissioning_context_t *context,
    uint32_t now_ms,
    uint32_t window_ms
) {
    if (context == NULL || context->state != COMMISSIONING_IDLE || window_ms == 0U) return false;
    context->state = COMMISSIONING_WAITING_FOR_PHYSICAL_CONFIRMATION;
    context->started_at_ms = now_ms;
    context->deadline_at_ms = now_ms + window_ms;
    context->session_consumed = false;
    return true;
}

bool commissioning_begin_backend_recovery(commissioning_context_t *context, uint32_t now_ms) {
    if (context == NULL || context->state != COMMISSIONING_IDLE) return false;
    context->state = COMMISSIONING_CREDENTIAL_PERSISTING;
    context->started_at_ms = now_ms;
    context->deadline_at_ms = now_ms + 24U * 60U * 60U * 1000U;
    context->session_consumed = true;
    return true;
}

bool commissioning_expire_if_needed(commissioning_context_t *context, uint32_t now_ms) {
    if (context == NULL || terminal(context->state)) return false;
    if (!elapsed(now_ms, context->started_at_ms, (uint32_t)(context->deadline_at_ms - context->started_at_ms))) {
        return false;
    }
    context->state = COMMISSIONING_EXPIRED;
    context->session_consumed = false;
    return true;
}

bool commissioning_accept_physical(commissioning_context_t *context, uint32_t now_ms) {
    if (context == NULL || context->state != COMMISSIONING_WAITING_FOR_PHYSICAL_CONFIRMATION) return false;
    if (commissioning_expire_if_needed(context, now_ms)) return false;
    context->state = COMMISSIONING_SOFTAP_ACTIVE;
    return true;
}

bool commissioning_transition(commissioning_context_t *context, commissioning_state_t next) {
    if (context == NULL || terminal(context->state)) return false;
    const bool valid =
        (context->state == COMMISSIONING_SOFTAP_ACTIVE && next == COMMISSIONING_RECEIVING_CONFIG) ||
        (context->state == COMMISSIONING_RECEIVING_CONFIG && next == COMMISSIONING_CONNECTING_TO_WIFI) ||
        (context->state == COMMISSIONING_WIFI_CONNECTED && next == COMMISSIONING_REDEEMING) ||
        (context->state == COMMISSIONING_REDEEMING && next == COMMISSIONING_CREDENTIAL_PERSISTING) ||
        (context->state == COMMISSIONING_CREDENTIAL_PERSISTING && next == COMMISSIONING_CONNECTING_TO_WIFI) ||
        (context->state == COMMISSIONING_CONNECTING_TO_WIFI && (next == COMMISSIONING_WIFI_CONNECTED || next == COMMISSIONING_RETRY_WAIT)) ||
        (context->state == COMMISSIONING_CREDENTIAL_PERSISTING && next == COMMISSIONING_ONLINE) ||
        (context->state == COMMISSIONING_WIFI_CONNECTED && next == COMMISSIONING_RETRY_WAIT) ||
        (context->state == COMMISSIONING_RETRY_WAIT && (next == COMMISSIONING_CONNECTING_TO_WIFI || next == COMMISSIONING_FAILED || next == COMMISSIONING_CANCELLED));
    if (!valid) return false;
    context->state = next;
    return true;
}

bool commissioning_consume_session(commissioning_context_t *context) {
    if (context == NULL || context->state != COMMISSIONING_REDEEMING || context->session_consumed) return false;
    context->session_consumed = true;
    return true;
}

bool commissioning_cancel(commissioning_context_t *context) {
    if (context == NULL || terminal(context->state)) return false;
    context->state = COMMISSIONING_CANCELLED;
    context->session_consumed = false;
    return true;
}

bool commissioning_fail(commissioning_context_t *context) {
    if (context == NULL || terminal(context->state)) return false;
    context->state = COMMISSIONING_FAILED;
    context->session_consumed = false;
    return true;
}

commissioning_state_t commissioning_state(const commissioning_context_t *context) {
    return context == NULL ? COMMISSIONING_FAILED : context->state;
}

bool commissioning_session_consumed(const commissioning_context_t *context) {
    return context != NULL && context->session_consumed;
}
