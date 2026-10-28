#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "commissioning_state.h"

typedef enum {
    COMMISSIONING_WIFI_EVENT_GOT_IP = 0,
    COMMISSIONING_WIFI_EVENT_DISCONNECTED,
    COMMISSIONING_WIFI_EVENT_AUTH_FAILED,
    COMMISSIONING_WIFI_EVENT_AP_NOT_FOUND,
} commissioning_wifi_event_t;

typedef struct {
    bool (*configure_station)(void *context, const char *ssid, const char *password);
    bool (*connect)(void *context);
    void (*disconnect)(void *context);
} commissioning_wifi_ops_t;

typedef struct {
    commissioning_context_t *lifecycle;
    commissioning_wifi_ops_t ops;
    void *ops_context;
    char ssid[33];
    char password[65];
    uint32_t generation;
    uint32_t deadline_at_ms;
    uint32_t retry_at_ms;
    uint32_t retry_count;
    uint32_t max_retries;
    uint32_t retry_backoff_ms;
    uint32_t retry_backoff_max_ms;
    bool active;
} commissioning_wifi_controller_t;

bool commissioning_wifi_controller_init(
    commissioning_wifi_controller_t *controller,
    commissioning_context_t *lifecycle,
    const commissioning_wifi_ops_t *ops,
    void *ops_context,
    uint32_t max_retries,
    uint32_t retry_backoff_ms,
    uint32_t retry_backoff_max_ms
);

bool commissioning_wifi_controller_start(
    commissioning_wifi_controller_t *controller,
    const char *ssid,
    const char *password,
    uint32_t now_ms,
    uint32_t timeout_ms
);

void commissioning_wifi_controller_tick(
    commissioning_wifi_controller_t *controller,
    uint32_t now_ms
);

void commissioning_wifi_controller_on_event(
    commissioning_wifi_controller_t *controller,
    uint32_t generation,
    commissioning_wifi_event_t event,
    uint32_t now_ms
);

bool commissioning_wifi_controller_mark_backend_online(
    commissioning_wifi_controller_t *controller,
    uint32_t generation
);
bool commissioning_wifi_controller_fail(
    commissioning_wifi_controller_t *controller,
    uint32_t generation
);

bool commissioning_wifi_controller_cancel(commissioning_wifi_controller_t *controller);
uint32_t commissioning_wifi_controller_generation(const commissioning_wifi_controller_t *controller);
bool commissioning_wifi_controller_is_active(const commissioning_wifi_controller_t *controller);

