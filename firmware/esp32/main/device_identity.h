#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef enum {
    DEVICE_KEY_PROVIDER_OK = 0,
    DEVICE_KEY_PROVIDER_NOT_FOUND,
    DEVICE_KEY_PROVIDER_CORRUPT,
    DEVICE_KEY_PROVIDER_IO_ERROR,
    DEVICE_KEY_PROVIDER_INVALID,
} device_key_provider_result_t;

typedef enum {
    DEVICE_IDENTITY_UNINITIALIZED = 0,
    DEVICE_IDENTITY_READY,
    DEVICE_IDENTITY_REVOKED,
    DEVICE_IDENTITY_ERROR,
} device_identity_state_t;

typedef struct {
    void *context;
    device_key_provider_result_t (*load_public_key)(
        void *context,
        uint8_t *public_key,
        size_t public_key_capacity,
        size_t *public_key_length,
        uint32_t *key_version
    );
    device_key_provider_result_t (*generate_key)(void *context, uint32_t key_version);
    device_key_provider_result_t (*sign_der)(
        void *context,
        const uint8_t *message,
        size_t message_length,
        uint8_t *signature,
        size_t signature_capacity,
        size_t *signature_length
    );
    device_key_provider_result_t (*revoke)(void *context);
} device_key_provider_t;

typedef struct {
    device_key_provider_t provider;
    device_identity_state_t state;
    uint32_t key_version;
} device_identity_t;

void device_identity_init(device_identity_t *identity, device_key_provider_t provider);
device_key_provider_result_t device_identity_load_or_generate(
    device_identity_t *identity,
    bool allow_generation,
    uint32_t initial_key_version
);
device_key_provider_result_t device_identity_get_public_key(
    device_identity_t *identity,
    uint8_t *public_key,
    size_t public_key_capacity,
    size_t *public_key_length
);
device_key_provider_result_t device_identity_sign_der(
    device_identity_t *identity,
    const uint8_t *message,
    size_t message_length,
    uint8_t *signature,
    size_t signature_capacity,
    size_t *signature_length
);
device_key_provider_result_t device_identity_revoke(device_identity_t *identity);
device_identity_state_t device_identity_state(const device_identity_t *identity);
uint32_t device_identity_key_version(const device_identity_t *identity);
