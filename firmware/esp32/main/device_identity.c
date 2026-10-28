#include "device_identity.h"

#include <stddef.h>

static bool provider_is_complete(const device_key_provider_t *provider) {
    return provider != NULL && provider->load_public_key != NULL &&
        provider->generate_key != NULL && provider->sign_der != NULL &&
        provider->revoke != NULL;
}

void device_identity_init(device_identity_t *identity, device_key_provider_t provider) {
    if (identity == NULL) return;
    identity->provider = provider;
    identity->state = DEVICE_IDENTITY_UNINITIALIZED;
    identity->key_version = 0U;
}

static device_key_provider_result_t load_identity(device_identity_t *identity) {
    uint8_t public_key[128];
    size_t public_key_length = 0U;
    uint32_t key_version = 0U;
    device_key_provider_result_t result = identity->provider.load_public_key(
        identity->provider.context,
        public_key,
        sizeof(public_key),
        &public_key_length,
        &key_version
    );
    if (result != DEVICE_KEY_PROVIDER_OK || public_key_length == 0U || key_version == 0U) {
        identity->state = DEVICE_IDENTITY_ERROR;
        return result == DEVICE_KEY_PROVIDER_OK ? DEVICE_KEY_PROVIDER_CORRUPT : result;
    }
    identity->key_version = key_version;
    identity->state = DEVICE_IDENTITY_READY;
    return DEVICE_KEY_PROVIDER_OK;
}

device_key_provider_result_t device_identity_load_or_generate(
    device_identity_t *identity,
    bool allow_generation,
    uint32_t initial_key_version
) {
    if (identity == NULL || !provider_is_complete(&identity->provider) || initial_key_version == 0U) {
        return DEVICE_KEY_PROVIDER_INVALID;
    }
    device_key_provider_result_t result = load_identity(identity);
    if (result != DEVICE_KEY_PROVIDER_NOT_FOUND || !allow_generation) return result;
    result = identity->provider.generate_key(identity->provider.context, initial_key_version);
    if (result != DEVICE_KEY_PROVIDER_OK) {
        identity->state = DEVICE_IDENTITY_ERROR;
        return result;
    }
    return load_identity(identity);
}

device_key_provider_result_t device_identity_get_public_key(
    device_identity_t *identity,
    uint8_t *public_key,
    size_t public_key_capacity,
    size_t *public_key_length
) {
    if (identity == NULL || identity->state != DEVICE_IDENTITY_READY ||
        public_key == NULL || public_key_length == NULL) return DEVICE_KEY_PROVIDER_INVALID;
    uint32_t loaded_version = 0U;
    device_key_provider_result_t result = identity->provider.load_public_key(
        identity->provider.context,
        public_key,
        public_key_capacity,
        public_key_length,
        &loaded_version
    );
    if (result == DEVICE_KEY_PROVIDER_OK && loaded_version != identity->key_version) {
        identity->state = DEVICE_IDENTITY_ERROR;
        return DEVICE_KEY_PROVIDER_CORRUPT;
    }
    return result;
}

device_key_provider_result_t device_identity_sign_der(
    device_identity_t *identity,
    const uint8_t *message,
    size_t message_length,
    uint8_t *signature,
    size_t signature_capacity,
    size_t *signature_length
) {
    if (identity == NULL || identity->state != DEVICE_IDENTITY_READY ||
        message == NULL || message_length == 0U || signature == NULL ||
        signature_length == NULL) return DEVICE_KEY_PROVIDER_INVALID;
    return identity->provider.sign_der(
        identity->provider.context,
        message,
        message_length,
        signature,
        signature_capacity,
        signature_length
    );
}

device_key_provider_result_t device_identity_revoke(device_identity_t *identity) {
    if (identity == NULL || identity->state != DEVICE_IDENTITY_READY) return DEVICE_KEY_PROVIDER_INVALID;
    device_key_provider_result_t result = identity->provider.revoke(identity->provider.context);
    if (result == DEVICE_KEY_PROVIDER_OK) identity->state = DEVICE_IDENTITY_REVOKED;
    return result;
}

device_identity_state_t device_identity_state(const device_identity_t *identity) {
    return identity == NULL ? DEVICE_IDENTITY_ERROR : identity->state;
}

uint32_t device_identity_key_version(const device_identity_t *identity) {
    return identity == NULL ? 0U : identity->key_version;
}
