#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "commissioning_state.h"
#include "device_identity.h"

typedef bool (*commissioning_credentials_callback_t)(
    const char *ssid,
    const char *password,
    const char *device_id,
    const char *device_key,
    const char *bootstrap_secret,
    const char *session_id,
    const char *challenge,
    uint32_t expires_at,
    void *context
);

typedef struct commissioning_transport commissioning_transport_t;

bool commissioning_transport_init(
    commissioning_transport_t *transport,
    commissioning_context_t *lifecycle,
    device_identity_t *identity,
    commissioning_credentials_callback_t credentials_callback,
    void *callback_context
);

bool commissioning_transport_start(commissioning_transport_t *transport);
bool commissioning_transport_start_softap(commissioning_transport_t *transport, const char *ssid);
void commissioning_transport_stop(commissioning_transport_t *transport);
bool commissioning_transport_is_running(const commissioning_transport_t *transport);

struct commissioning_transport {
    void *server;
    commissioning_context_t *lifecycle;
    device_identity_t *identity;
    commissioning_credentials_callback_t credentials_callback;
    void *callback_context;
    uint8_t session_key[16];
    uint8_t transcript[1024];
    size_t transcript_length;
    char session_id[128];
    char challenge[256];
    uint32_t expires_at;
    bool handshake_complete;
    bool running;
};
