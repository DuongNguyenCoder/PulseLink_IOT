#include "commissioning_http_response_policy.h"

bool commissioning_http_response_received(bool transport_ok, int status_code) {
    return transport_ok || status_code != 0;
}

bool commissioning_http_status_is_permanent_rejection(int status_code) {
    return status_code == 400 || status_code == 401 || status_code == 403 ||
        status_code == 404 || status_code == 409;
}
