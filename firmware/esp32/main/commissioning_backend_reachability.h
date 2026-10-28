#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "commissioning_credential_storage.h"
#include "commissioning_wifi_controller.h"

typedef enum {
    COMMISSIONING_BACKEND_PROBE_OK = 0,
    COMMISSIONING_BACKEND_PROBE_AUTH_FAILURE,
    COMMISSIONING_BACKEND_PROBE_TIMEOUT,
    COMMISSIONING_BACKEND_PROBE_NETWORK_ERROR,
    COMMISSIONING_BACKEND_PROBE_SERVER_ERROR,
    COMMISSIONING_BACKEND_PROBE_MALFORMED,
    COMMISSIONING_BACKEND_PROBE_CANCELLED,
} commissioning_backend_probe_result_t;

typedef bool (*commissioning_backend_probe_start_t)(
    void *context,
    const uint8_t *credential,
    size_t credential_length,
    uint32_t generation
);
typedef void (*commissioning_backend_probe_cancel_t)(void *context);

typedef struct {
    commissioning_backend_probe_start_t start;
    commissioning_backend_probe_cancel_t cancel;
} commissioning_backend_probe_ops_t;

typedef struct {
    commissioning_wifi_controller_t *wifi_controller;
    commissioning_credential_storage_t *credential_storage;
    commissioning_backend_probe_ops_t ops;
    void *ops_context;
    uint32_t generation;
    bool pending;
} commissioning_backend_reachability_t;

bool commissioning_backend_reachability_init(
    commissioning_backend_reachability_t *reachability,
    commissioning_wifi_controller_t *wifi_controller,
    commissioning_credential_storage_t *credential_storage,
    const commissioning_backend_probe_ops_t *ops,
    void *ops_context
);

bool commissioning_backend_reachability_start(
    commissioning_backend_reachability_t *reachability,
    uint32_t generation
);

bool commissioning_backend_reachability_start_https(
    commissioning_backend_reachability_t *reachability,
    const char *base_url,
    const char *expected_device_id,
    const char *expected_device_key,
    uint32_t timeout_ms
);

void commissioning_backend_reachability_complete(
    commissioning_backend_reachability_t *reachability,
    uint32_t generation,
    commissioning_backend_probe_result_t result
);

bool commissioning_backend_reachability_cancel(commissioning_backend_reachability_t *reachability);
bool commissioning_backend_reachability_is_pending(const commissioning_backend_reachability_t *reachability);

