#include "commissioning_wifi_controller.h"

#include <string.h>

static void clear_sensitive(void *value, size_t length) {
    volatile uint8_t *bytes = value;
    while (length-- > 0U) *bytes++ = 0U;
}

static bool valid_text(const char *value, size_t max_length) {
    return value != NULL && value[0] != '\0' && strlen(value) < max_length;
}

static void clear_credentials(commissioning_wifi_controller_t *controller) {
    clear_sensitive(controller->ssid, sizeof(controller->ssid));
    clear_sensitive(controller->password, sizeof(controller->password));
}

static void terminal_cleanup(commissioning_wifi_controller_t *controller, bool disconnect) {
    if (disconnect && controller->ops.disconnect != NULL) controller->ops.disconnect(controller->ops_context);
    clear_credentials(controller);
    controller->active = false;
}

static void schedule_retry(commissioning_wifi_controller_t *controller, uint32_t now_ms) {
    if (controller->retry_count >= controller->max_retries ||
        !commissioning_transition(controller->lifecycle, COMMISSIONING_RETRY_WAIT)) {
        commissioning_fail(controller->lifecycle);
        terminal_cleanup(controller, true);
        return;
    }
    controller->retry_count++;
    controller->retry_at_ms = now_ms + controller->retry_backoff_ms;
    if (controller->retry_backoff_ms < controller->retry_backoff_max_ms) {
        controller->retry_backoff_ms *= 2U;
        if (controller->retry_backoff_ms > controller->retry_backoff_max_ms) {
            controller->retry_backoff_ms = controller->retry_backoff_max_ms;
        }
    }
}

static bool attempt_connect(commissioning_wifi_controller_t *controller, uint32_t now_ms) {
    if (controller->ops.configure_station == NULL || controller->ops.connect == NULL ||
        !controller->ops.configure_station(controller->ops_context, controller->ssid, controller->password) ||
        !controller->ops.connect(controller->ops_context)) {
        schedule_retry(controller, now_ms);
        return false;
    }
    return true;
}

bool commissioning_wifi_controller_init(
    commissioning_wifi_controller_t *controller,
    commissioning_context_t *lifecycle,
    const commissioning_wifi_ops_t *ops,
    void *ops_context,
    uint32_t max_retries,
    uint32_t retry_backoff_ms,
    uint32_t retry_backoff_max_ms
) {
    if (controller == NULL || lifecycle == NULL || ops == NULL || ops->configure_station == NULL ||
        ops->connect == NULL || max_retries == 0U || retry_backoff_ms == 0U ||
        retry_backoff_max_ms < retry_backoff_ms) return false;
    memset(controller, 0, sizeof(*controller));
    controller->lifecycle = lifecycle;
    controller->ops = *ops;
    controller->ops_context = ops_context;
    controller->max_retries = max_retries;
    controller->retry_backoff_ms = retry_backoff_ms;
    controller->retry_backoff_max_ms = retry_backoff_max_ms;
    return true;
}

bool commissioning_wifi_controller_start(
    commissioning_wifi_controller_t *controller,
    const char *ssid,
    const char *password,
    uint32_t now_ms,
    uint32_t timeout_ms
) {
    if (controller == NULL || controller->active || timeout_ms == 0U ||
        !valid_text(ssid, sizeof(controller->ssid)) || !valid_text(password, sizeof(controller->password)) ||
        commissioning_state(controller->lifecycle) != COMMISSIONING_CONNECTING_TO_WIFI) return false;
    memcpy(controller->ssid, ssid, strlen(ssid) + 1U);
    memcpy(controller->password, password, strlen(password) + 1U);
    controller->generation++;
    if (controller->generation == 0U) controller->generation++;
    controller->deadline_at_ms = now_ms + timeout_ms;
    controller->retry_at_ms = now_ms;
    controller->retry_count = 0U;
    controller->active = true;
    controller->backend_recovery = false;
    (void)attempt_connect(controller, now_ms);
    return controller->active;
}

bool commissioning_wifi_controller_start_backend_recovery(
    commissioning_wifi_controller_t *controller,
    uint32_t now_ms
) {
    if (controller == NULL || controller->active ||
        commissioning_state(controller->lifecycle) != COMMISSIONING_CREDENTIAL_PERSISTING) return false;
    controller->generation++;
    if (controller->generation == 0U) controller->generation++;
    controller->deadline_at_ms = now_ms + 24U * 60U * 60U * 1000U;
    controller->retry_at_ms = now_ms;
    controller->retry_count = 0U;
    controller->backend_recovery = true;
    controller->active = true;
    clear_credentials(controller);
    return true;
}

void commissioning_wifi_controller_tick(commissioning_wifi_controller_t *controller, uint32_t now_ms) {
    if (controller == NULL || !controller->active) return;
    if ((int32_t)(now_ms - controller->deadline_at_ms) >= 0) {
        commissioning_fail(controller->lifecycle);
        terminal_cleanup(controller, true);
        return;
    }
    if (commissioning_state(controller->lifecycle) == COMMISSIONING_RETRY_WAIT &&
        (uint32_t)(now_ms - controller->retry_at_ms) < 0x80000000U && now_ms >= controller->retry_at_ms) {
        if (!commissioning_transition(controller->lifecycle, COMMISSIONING_CONNECTING_TO_WIFI)) {
            commissioning_fail(controller->lifecycle);
            terminal_cleanup(controller, true);
            return;
        }
        (void)attempt_connect(controller, now_ms);
    }
}

void commissioning_wifi_controller_on_event(
    commissioning_wifi_controller_t *controller,
    uint32_t generation,
    commissioning_wifi_event_t event,
    uint32_t now_ms
) {
    if (controller == NULL || !controller->active || generation != controller->generation) return;
    switch (event) {
        case COMMISSIONING_WIFI_EVENT_GOT_IP:
            if (commissioning_state(controller->lifecycle) == COMMISSIONING_CONNECTING_TO_WIFI) {
                (void)commissioning_transition(controller->lifecycle, COMMISSIONING_WIFI_CONNECTED);
            }
            break;
        case COMMISSIONING_WIFI_EVENT_DISCONNECTED:
        case COMMISSIONING_WIFI_EVENT_AUTH_FAILED:
        case COMMISSIONING_WIFI_EVENT_AP_NOT_FOUND:
            /* Recovery retains the persisted network config; the runtime reconnect task retries it. */
            if (controller->backend_recovery) break;
            if (commissioning_state(controller->lifecycle) == COMMISSIONING_CONNECTING_TO_WIFI ||
                commissioning_state(controller->lifecycle) == COMMISSIONING_WIFI_CONNECTED) {
                schedule_retry(controller, now_ms);
            }
            break;
        default:
            break;
    }
}

bool commissioning_wifi_controller_mark_backend_online(
    commissioning_wifi_controller_t *controller,
    uint32_t generation
) {
    if (controller == NULL || !controller->active || generation != controller->generation ||
        commissioning_state(controller->lifecycle) != COMMISSIONING_CREDENTIAL_PERSISTING ||
        !commissioning_transition(controller->lifecycle, COMMISSIONING_ONLINE)) return false;
    terminal_cleanup(controller, false);
    return true;
}

bool commissioning_wifi_controller_fail(
    commissioning_wifi_controller_t *controller,
    uint32_t generation
) {
    if (controller == NULL || !controller->active || generation != controller->generation ||
        !commissioning_fail(controller->lifecycle)) return false;
    terminal_cleanup(controller, true);
    return true;
}

bool commissioning_wifi_controller_cancel(commissioning_wifi_controller_t *controller) {
    if (controller == NULL || !controller->active || !commissioning_cancel(controller->lifecycle)) return false;
    terminal_cleanup(controller, true);
    return true;
}

uint32_t commissioning_wifi_controller_generation(const commissioning_wifi_controller_t *controller) {
    return controller == NULL ? 0U : controller->generation;
}

bool commissioning_wifi_controller_is_backend_recovery(const commissioning_wifi_controller_t *controller) {
    return controller != NULL && controller->active && controller->backend_recovery;
}

bool commissioning_wifi_controller_is_active(const commissioning_wifi_controller_t *controller) {
    return controller != NULL && controller->active;
}

