#include "commissioning_status_policy.h"

#include <string.h>

bool commissioning_status_accepts(
    const char *expected_device_id,
    const char *actual_device_id,
    const char *provisioning_state,
    const char *enrollment_status
) {
    /* Status is bearer-authenticated; Device.deviceKey is the operational token, not the identity public key. */
    return expected_device_id != NULL && actual_device_id != NULL &&
        provisioning_state != NULL && enrollment_status != NULL &&
        strcmp(expected_device_id, actual_device_id) == 0 &&
        strcmp(provisioning_state, "PROVISIONED") == 0 &&
        strcmp(enrollment_status, "ENROLLED") == 0;
}
