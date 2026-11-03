#include "commissioning_wifi_mode_policy.h"

#include <assert.h>

int main(void) {
    assert(!commissioning_wifi_mode_policy_station_reconnect_allowed(COMMISSIONING_SOFTAP_ACTIVE, false));
    assert(!commissioning_wifi_mode_policy_station_reconnect_allowed(COMMISSIONING_RECEIVING_CONFIG, false));
    assert(!commissioning_wifi_mode_policy_station_reconnect_allowed(COMMISSIONING_CONNECTING_TO_WIFI, false));
    assert(!commissioning_wifi_mode_policy_station_reconnect_allowed(COMMISSIONING_REDEEMING, false));
    assert(!commissioning_wifi_mode_policy_station_reconnect_allowed(COMMISSIONING_RETRY_WAIT, false));
    assert(commissioning_wifi_mode_policy_station_reconnect_allowed(COMMISSIONING_WAITING_FOR_PHYSICAL_CONFIRMATION, false));
    assert(commissioning_wifi_mode_policy_station_reconnect_allowed(COMMISSIONING_ONLINE, false));
    assert(commissioning_wifi_mode_policy_station_reconnect_allowed(COMMISSIONING_CREDENTIAL_PERSISTING, true));
    return 0;
}
