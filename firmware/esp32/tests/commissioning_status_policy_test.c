#include "commissioning_status_policy.h"

#include <assert.h>

int main(void) {
    assert(commissioning_status_accepts("pl-device-1", "pl-device-1", "PROVISIONED", "ENROLLED"));
    assert(!commissioning_status_accepts("pl-device-1", "pl-device-2", "PROVISIONED", "ENROLLED"));
    assert(!commissioning_status_accepts("pl-device-1", "pl-device-1", "READY", "ENROLLED"));
    assert(!commissioning_status_accepts("pl-device-1", "pl-device-1", "PROVISIONED", "UNENROLLED"));
    assert(!commissioning_status_accepts(NULL, "pl-device-1", "PROVISIONED", "ENROLLED"));
    return 0;
}
