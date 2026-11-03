#include "commissioning_wifi_mode_policy.h"

bool commissioning_wifi_mode_policy_station_reconnect_allowed(
    commissioning_state_t state,
    bool backend_recovery_requested
) {
    if (backend_recovery_requested) return true;
    switch (state) {
        case COMMISSIONING_IDLE:
        case COMMISSIONING_WAITING_FOR_PHYSICAL_CONFIRMATION:
        case COMMISSIONING_ONLINE:
        case COMMISSIONING_FAILED:
        case COMMISSIONING_EXPIRED:
        case COMMISSIONING_CANCELLED:
            return true;
        case COMMISSIONING_SOFTAP_ACTIVE:
        case COMMISSIONING_RECEIVING_CONFIG:
        case COMMISSIONING_REDEEMING:
        case COMMISSIONING_CREDENTIAL_PERSISTING:
        case COMMISSIONING_CONNECTING_TO_WIFI:
        case COMMISSIONING_WIFI_CONNECTED:
        case COMMISSIONING_RETRY_WAIT:
        default:
            return false;
    }
}
