#pragma once

#include <stdbool.h>

typedef enum {
    DEVICE_EVENT_HTTP_ACK = 0,
    DEVICE_EVENT_HTTP_REJECT,
    DEVICE_EVENT_HTTP_RETRY,
} device_event_http_decision_t;

device_event_http_decision_t device_event_http_classify(bool transport_ok, int http_status);
