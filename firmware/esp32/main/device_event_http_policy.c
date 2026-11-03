#include "device_event_http_policy.h"

device_event_http_decision_t device_event_http_classify(bool transport_ok, int http_status) {
    if (http_status == 400 || http_status == 401 || http_status == 403 || http_status == 409) {
        return DEVICE_EVENT_HTTP_REJECT;
    }
    if (transport_ok && (http_status == 200 || http_status == 201)) {
        return DEVICE_EVENT_HTTP_ACK;
    }
    return DEVICE_EVENT_HTTP_RETRY;
}
