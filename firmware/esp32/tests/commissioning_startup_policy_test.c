#include <assert.h>

#include "commissioning_startup_policy.h"

int main(void) {
    assert(commissioning_startup_select_path(false, false, false, false, true) == COMMISSIONING_STARTUP_PATH_COMMISSIONING);
    assert(commissioning_startup_select_path(true, false, false, false, true) == COMMISSIONING_STARTUP_PATH_COMMISSIONING);
    assert(commissioning_startup_select_path(false, true, false, false, true) == COMMISSIONING_STARTUP_PATH_COMMISSIONING);
    assert(commissioning_startup_select_path(true, true, false, false, true) == COMMISSIONING_STARTUP_PATH_BACKEND_RECOVERY);
    assert(commissioning_startup_select_path(true, false, true, false, true) == COMMISSIONING_STARTUP_PATH_CREDENTIAL_REPAIR);
    assert(commissioning_startup_select_path(true, false, true, true, true) == COMMISSIONING_STARTUP_PATH_ERROR);
    assert(commissioning_startup_select_path(true, true, false, true, true) == COMMISSIONING_STARTUP_PATH_ERROR);
    assert(commissioning_startup_select_path(true, false, false, false, false) == COMMISSIONING_STARTUP_PATH_ERROR);
    assert(commissioning_startup_reconfiguration_allowed(true, true, false, true, true, 100U, 30099U, 30000U));
    assert(!commissioning_startup_reconfiguration_allowed(true, true, false, true, true, 100U, 30100U, 30000U));
    assert(!commissioning_startup_reconfiguration_allowed(true, false, false, true, true, 100U, 200U, 30000U));
    assert(!commissioning_startup_reconfiguration_allowed(true, true, true, true, true, 100U, 200U, 30000U));
    assert(!commissioning_startup_reconfiguration_allowed(true, true, false, true, false, 100U, 200U, 30000U));
    assert(commissioning_startup_reconfiguration_state_allowed(COMMISSIONING_ONLINE, false));
    assert(commissioning_startup_reconfiguration_state_allowed(COMMISSIONING_FAILED, false));
    assert(commissioning_startup_reconfiguration_state_allowed(COMMISSIONING_CREDENTIAL_PERSISTING, true));
    assert(!commissioning_startup_reconfiguration_state_allowed(COMMISSIONING_WIFI_CONNECTED, false));
    return 0;
}
