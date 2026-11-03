#pragma once

#include <stdbool.h>

#include "commissioning_state.h"

bool commissioning_wifi_mode_policy_station_reconnect_allowed(
    commissioning_state_t state,
    bool backend_recovery_requested
);
