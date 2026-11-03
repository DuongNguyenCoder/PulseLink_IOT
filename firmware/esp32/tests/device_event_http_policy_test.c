#include <assert.h>

#include "device_event_http_policy.h"

int main(void) {
    assert(device_event_http_classify(true, 200) == DEVICE_EVENT_HTTP_ACK);
    assert(device_event_http_classify(true, 201) == DEVICE_EVENT_HTTP_ACK);
    assert(device_event_http_classify(false, 401) == DEVICE_EVENT_HTTP_REJECT);
    assert(device_event_http_classify(false, 403) == DEVICE_EVENT_HTTP_REJECT);
    assert(device_event_http_classify(true, 400) == DEVICE_EVENT_HTTP_REJECT);
    assert(device_event_http_classify(true, 409) == DEVICE_EVENT_HTTP_REJECT);
    assert(device_event_http_classify(false, 0) == DEVICE_EVENT_HTTP_RETRY);
    assert(device_event_http_classify(true, 503) == DEVICE_EVENT_HTTP_RETRY);
    assert(device_event_http_classify(false, 201) == DEVICE_EVENT_HTTP_RETRY);
    return 0;
}
