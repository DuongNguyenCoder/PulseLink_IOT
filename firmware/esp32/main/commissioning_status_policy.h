#pragma once

#include <stdbool.h>

bool commissioning_status_accepts(
    const char *expected_device_id,
    const char *actual_device_id,
    const char *provisioning_state,
    const char *enrollment_status
);
