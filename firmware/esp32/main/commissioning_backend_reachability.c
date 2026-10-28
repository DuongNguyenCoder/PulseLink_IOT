#include "commissioning_backend_reachability.h"

#include <string.h>

static void clear_sensitive(void *value, size_t length) {
    volatile uint8_t *bytes = value;
    while (length-- > 0U) *bytes++ = 0U;
}

bool commissioning_backend_reachability_init(
    commissioning_backend_reachability_t *reachability,
    commissioning_wifi_controller_t *wifi_controller,
    commissioning_credential_storage_t *credential_storage,
    const commissioning_backend_probe_ops_t *ops,
    void *ops_context
) {
    if (reachability == NULL || wifi_controller == NULL || credential_storage == NULL ||
        ops == NULL || ops->start == NULL) return false;
    memset(reachability, 0, sizeof(*reachability));
    reachability->wifi_controller = wifi_controller;
    reachability->credential_storage = credential_storage;
    reachability->ops = *ops;
    reachability->ops_context = ops_context;
    return true;
}

bool commissioning_backend_reachability_start(
    commissioning_backend_reachability_t *reachability,
    uint32_t generation
) {
    uint8_t credential[256] = { 0 };
    size_t credential_length = 0U;
    bool started = false;
    if (reachability == NULL || reachability->pending ||
        !commissioning_wifi_controller_is_active(reachability->wifi_controller) ||
        commissioning_wifi_controller_generation(reachability->wifi_controller) != generation ||
        !commissioning_credential_storage_is_ready(reachability->credential_storage)) return false;
    if (commissioning_credential_storage_load(reachability->credential_storage, credential,
            sizeof(credential), &credential_length) != COMMISSIONING_STORAGE_OK || credential_length == 0U) {
        clear_sensitive(credential, sizeof(credential));
        return false;
    }
    started = reachability->ops.start(reachability->ops_context, credential, credential_length, generation);
    clear_sensitive(credential, sizeof(credential));
    if (started) {
        reachability->generation = generation;
        reachability->pending = true;
    }
    return started;
}

void commissioning_backend_reachability_complete(
    commissioning_backend_reachability_t *reachability,
    uint32_t generation,
    commissioning_backend_probe_result_t result
) {
    if (reachability == NULL || !reachability->pending || generation != reachability->generation ||
        generation != commissioning_wifi_controller_generation(reachability->wifi_controller)) return;
    reachability->pending = false;
    if (result == COMMISSIONING_BACKEND_PROBE_OK) {
        if (!commissioning_wifi_controller_mark_backend_online(reachability->wifi_controller, generation)) {
            (void)commissioning_wifi_controller_fail(reachability->wifi_controller, generation);
        }
    } else {
        (void)commissioning_wifi_controller_fail(reachability->wifi_controller, generation);
    }
}

bool commissioning_backend_reachability_cancel(commissioning_backend_reachability_t *reachability) {
    if (reachability == NULL || !reachability->pending) return false;
    if (reachability->ops.cancel != NULL) reachability->ops.cancel(reachability->ops_context);
    reachability->pending = false;
    return true;
}

bool commissioning_backend_reachability_is_pending(const commissioning_backend_reachability_t *reachability) {
    return reachability != NULL && reachability->pending;
}

