#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "commissioning_credential_storage.h"
#include "device_identity.h"

typedef enum {
    COMMISSIONING_REDEEM_OK = 0,
    COMMISSIONING_REDEEM_RETRYABLE,
    COMMISSIONING_REDEEM_REJECTED,
    COMMISSIONING_REDEEM_EXPIRED,
    COMMISSIONING_REDEEM_MALFORMED,
    COMMISSIONING_REDEEM_STORAGE_UNAVAILABLE,
    COMMISSIONING_REDEEM_STORAGE_INVALID,
    COMMISSIONING_REDEEM_STORAGE_IO_ERROR,
} commissioning_redeem_result_t;

commissioning_redeem_result_t commissioning_redeem_and_store(
    const char *base_url,
    const char *device_id,
    const char *device_key,
    const char *session_id,
    const char *bootstrap_secret,
    const char *challenge,
    uint32_t expires_at,
    device_identity_t *identity,
    commissioning_credential_storage_t *storage
);
