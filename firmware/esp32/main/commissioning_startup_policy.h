#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "commissioning_state.h"

typedef enum {
    COMMISSIONING_STARTUP_PATH_ERROR = 0,
    COMMISSIONING_STARTUP_PATH_COMMISSIONING,
    COMMISSIONING_STARTUP_PATH_BACKEND_RECOVERY,
    COMMISSIONING_STARTUP_PATH_CREDENTIAL_REPAIR,
} commissioning_startup_path_t;

commissioning_startup_path_t commissioning_startup_select_path(
    bool station_configuration_present,
    bool operational_credential_present,
    bool operational_credential_invalid,
    bool credential_storage_error,
    bool commissioning_runtime_ready
);

bool commissioning_startup_reconfiguration_allowed(
    bool station_configuration_present,
    bool operational_credential_present,
    bool credential_storage_error,
    bool commissioning_runtime_ready,
    bool physical_gesture_accepted,
    uint32_t window_started_ms,
    uint32_t now_ms,
    uint32_t window_ms
);

bool commissioning_startup_reconfiguration_state_allowed(
    commissioning_state_t state,
    bool recovery_controller_active
);
