#pragma once

#include <stdbool.h>

bool commissioning_http_response_received(bool transport_ok, int status_code);
bool commissioning_http_status_is_permanent_rejection(int status_code);
