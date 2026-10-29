#pragma once

#include <stdbool.h>

#include "commissioning_credential_storage.h"

typedef struct {
    char nvs_namespace[16];
    bool initialized;
} esp_device_credential_storage_t;

bool esp_device_credential_storage_init(
    esp_device_credential_storage_t *provider,
    const char *nvs_namespace,
    commissioning_credential_storage_t *storage
);

