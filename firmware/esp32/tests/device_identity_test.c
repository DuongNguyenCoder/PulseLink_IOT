#include <assert.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include "device_identity.h"
#include "device_provisioning_payload.h"

typedef struct {
    bool present;
    bool corrupt;
    bool revoked;
    unsigned generate_calls;
    unsigned sign_calls;
    uint32_t key_version;
} fake_provider_t;

static device_key_provider_result_t fake_load(
    void *context, uint8_t *public_key, size_t capacity, size_t *length, uint32_t *version
) {
    fake_provider_t *fake = context;
    if (!fake->present) return DEVICE_KEY_PROVIDER_NOT_FOUND;
    if (fake->corrupt || capacity < 3U) return DEVICE_KEY_PROVIDER_CORRUPT;
    public_key[0] = 0x04U;
    public_key[1] = 0x01U;
    public_key[2] = 0x02U;
    *length = 3U;
    *version = fake->key_version;
    return DEVICE_KEY_PROVIDER_OK;
}

static device_key_provider_result_t fake_generate(void *context, uint32_t version) {
    fake_provider_t *fake = context;
    fake->present = true;
    fake->key_version = version;
    fake->generate_calls++;
    return DEVICE_KEY_PROVIDER_OK;
}

static device_key_provider_result_t fake_sign(
    void *context, const uint8_t *message, size_t message_length,
    uint8_t *signature, size_t capacity, size_t *length
) {
    fake_provider_t *fake = context;
    if (capacity < 2U || message == NULL || message_length == 0U) return DEVICE_KEY_PROVIDER_INVALID;
    fake->sign_calls++;
    signature[0] = 0x30U;
    signature[1] = 0x00U;
    *length = 2U;
    return DEVICE_KEY_PROVIDER_OK;
}

static device_key_provider_result_t fake_revoke(void *context) {
    fake_provider_t *fake = context;
    fake->revoked = true;
    fake->present = false;
    return DEVICE_KEY_PROVIDER_OK;
}

static device_key_provider_t provider(fake_provider_t *fake) {
    return (device_key_provider_t){
        .context = fake,
        .load_public_key = fake_load,
        .generate_key = fake_generate,
        .sign_der = fake_sign,
        .revoke = fake_revoke,
    };
}

static void test_canonical_payload(void) {
    char payload[256];
    size_t length = 0U;
    assert(device_provisioning_build_canonical_payload(
        payload, sizeof(payload), "session-1", "device-1", "challenge-1", 1700000000U, &length
    ) == DEVICE_PROVISIONING_PAYLOAD_OK);
    assert(length == strlen("pulselink-provisioning-v1\nsession-1\ndevice-1\nchallenge-1\n1700000000"));
    assert(strcmp(payload, "pulselink-provisioning-v1\nsession-1\ndevice-1\nchallenge-1\n1700000000") == 0);
    assert(device_provisioning_build_canonical_payload(
        payload, 8U, "session-1", "device-1", "challenge-1", 1700000000U, &length
    ) == DEVICE_PROVISIONING_PAYLOAD_TOO_SMALL);
}

int main(void) {
    test_canonical_payload();

    fake_provider_t fake = { 0 };
    device_identity_t identity;
    device_identity_init(&identity, provider(&fake));
    assert(device_identity_load_or_generate(&identity, false, 1U) == DEVICE_KEY_PROVIDER_NOT_FOUND);
    assert(device_identity_state(&identity) == DEVICE_IDENTITY_ERROR);

    device_identity_init(&identity, provider(&fake));
    fake.present = false;
    assert(device_identity_load_or_generate(&identity, true, 1U) == DEVICE_KEY_PROVIDER_OK);
    assert(fake.generate_calls == 1U);
    assert(device_identity_state(&identity) == DEVICE_IDENTITY_READY);
    assert(device_identity_key_version(&identity) == 1U);

    uint8_t public_key[8];
    size_t public_key_length = 0U;
    assert(device_identity_get_public_key(&identity, public_key, sizeof(public_key), &public_key_length) == DEVICE_KEY_PROVIDER_OK);
    assert(public_key_length == 3U);

    const uint8_t message[] = "canonical";
    uint8_t signature[8];
    size_t signature_length = 0U;
    assert(device_identity_sign_der(&identity, message, sizeof(message) - 1U, signature, sizeof(signature), &signature_length) == DEVICE_KEY_PROVIDER_OK);
    assert(signature_length == 2U && fake.sign_calls == 1U);

    assert(device_identity_revoke(&identity) == DEVICE_KEY_PROVIDER_OK);
    assert(device_identity_state(&identity) == DEVICE_IDENTITY_REVOKED);
    assert(device_identity_sign_der(&identity, message, sizeof(message) - 1U, signature, sizeof(signature), &signature_length) == DEVICE_KEY_PROVIDER_INVALID);

    fake.present = true;
    fake.corrupt = true;
    device_identity_init(&identity, provider(&fake));
    assert(device_identity_load_or_generate(&identity, false, 1U) == DEVICE_KEY_PROVIDER_CORRUPT);
    return 0;
}
