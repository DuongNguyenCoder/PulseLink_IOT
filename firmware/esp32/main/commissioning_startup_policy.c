#include "commissioning_startup_policy.h"

commissioning_startup_path_t commissioning_startup_select_path(
    bool station_configuration_present,
    bool operational_credential_present,
    bool operational_credential_invalid,
    bool credential_storage_error,
    bool commissioning_runtime_ready
) {
    if (credential_storage_error || !commissioning_runtime_ready) return COMMISSIONING_STARTUP_PATH_ERROR;
    if (operational_credential_invalid) return COMMISSIONING_STARTUP_PATH_CREDENTIAL_REPAIR;
    if (station_configuration_present && operational_credential_present) {
        return COMMISSIONING_STARTUP_PATH_BACKEND_RECOVERY;
    }
    return COMMISSIONING_STARTUP_PATH_COMMISSIONING;
}

bool commissioning_startup_reconfiguration_allowed(
    bool station_configuration_present,
    bool operational_credential_present,
    bool credential_storage_error,
    bool commissioning_runtime_ready,
    bool physical_gesture_accepted,
    uint32_t window_started_ms,
    uint32_t now_ms,
    uint32_t window_ms
) {
    return station_configuration_present && operational_credential_present &&
        !credential_storage_error && commissioning_runtime_ready &&
        physical_gesture_accepted && window_ms > 0U &&
        (uint32_t)(now_ms - window_started_ms) < window_ms;
}

bool commissioning_startup_reconfiguration_state_allowed(
    commissioning_state_t state,
    bool recovery_controller_active
) {
    return recovery_controller_active || state == COMMISSIONING_FAILED ||
        state == COMMISSIONING_ONLINE;
}
