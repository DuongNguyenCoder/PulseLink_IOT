#include <assert.h>

#include "commissioning_http_response_policy.h"

int main(void) {
    assert(commissioning_http_response_received(false, 401));
    assert(commissioning_http_response_received(false, 503));
    assert(commissioning_http_response_received(true, 0));
    assert(!commissioning_http_response_received(false, 0));
    assert(commissioning_http_status_is_permanent_rejection(400));
    assert(commissioning_http_status_is_permanent_rejection(401));
    assert(commissioning_http_status_is_permanent_rejection(403));
    assert(commissioning_http_status_is_permanent_rejection(404));
    assert(commissioning_http_status_is_permanent_rejection(409));
    assert(!commissioning_http_status_is_permanent_rejection(429));
    assert(!commissioning_http_status_is_permanent_rejection(503));
    return 0;
}
