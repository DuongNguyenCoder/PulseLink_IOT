#pragma once

#include <stdbool.h>

#include "device_identity.h"

typedef struct {
    const char *nvs_namespace;
} esp_device_identity_provider_t;

bool esp_device_identity_provider_init(
    esp_device_identity_provider_t *provider,
    const char *nvs_namespace
);
bool esp_device_identity_provider_is_available(void);
device_key_provider_t esp_device_identity_provider_as_provider(
    esp_device_identity_provider_t *provider
);
