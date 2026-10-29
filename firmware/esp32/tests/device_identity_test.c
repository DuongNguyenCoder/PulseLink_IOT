#include <assert.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
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

static void test_claim_payload_and_device_id(void) {
    const char *challenge = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    char payload[512];
    size_t length = 100U;
    assert(device_provisioning_build_claim_payload(payload, sizeof(payload), "pl-0123456789ab",
        "store-1", "claim-1", 7U, "MFkw-test-key", challenge, 1793200000U, &length) == DEVICE_PROVISIONING_PAYLOAD_OK);
    assert(strcmp(payload, "pulselink-device-claim-v1\npl-0123456789ab\nstore-1\nclaim-1\n7\nMFkw-test-key\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n1793200000") == 0);
    assert(device_provisioning_build_claim_payload(payload, sizeof(payload), "pl-0123456789ab",
        "store-vector-1", "claim-vector-1", 1U, "c3BraS1wdWJsaWMta2V5",
        challenge, 2000000000U, &length) == DEVICE_PROVISIONING_PAYLOAD_OK);
    FILE *fixture = fopen("tests/fixtures/device_claim_v1.hex", "rb");
    assert(fixture != NULL);
    char fixture_hex[512];
    size_t fixture_length = fread(fixture_hex, 1U, sizeof(fixture_hex) - 1U, fixture);
    assert(fclose(fixture) == 0);
    while (fixture_length > 0U && (fixture_hex[fixture_length - 1U] == '\n' || fixture_hex[fixture_length - 1U] == '\r')) fixture_length--;
    fixture_hex[fixture_length] = '\0';
    assert(length * 2U == fixture_length);
    for (size_t i = 0U; i < length; ++i) {
        char actual[3];
        (void)snprintf(actual, sizeof(actual), "%02x", (unsigned char)payload[i]);
        assert(actual[0] == fixture_hex[i * 2U] && actual[1] == fixture_hex[i * 2U + 1U]);
    }
    uint8_t mac[6] = { 0x02U, 0x11U, 0x22U, 0x33U, 0x44U, 0x55U };
    char device_id[16];
    assert(device_provisioning_build_device_id(mac, device_id, sizeof(device_id)));
    assert(strcmp(device_id, "pl-021122334455") == 0);
    assert(device_provisioning_build_claim_payload(payload, sizeof(payload), "bad\nid", "store-1",
        "claim-1", 7U, "key", challenge, 1793200000U, &length) == DEVICE_PROVISIONING_PAYLOAD_INVALID);
    assert(length == 0U);
}

static void test_canonical_enrollment_payload_vector(void) {
    static const char expected_hex[] =
        "70756c73656c696e6b2d6465766963652d656e726f6c6c6d656e742d76310a"
        "6465766963652d656e726f6c6c6d656e742d766563746f722d310a370a"
        "4d466b77457759484b6f5a497a6a3043415159494b6f5a497a6a304441516344"
        "516741456c706b644b2f47543455432f6777555041635753656a333541353472"
        "4d546438684d764f374361634374785478756877314d7a6752615253496b5244"
        "6a353333572f4d6e696f775855754966766f304957774f7637413d3d0a"
        "4141414141414141414141414141414141414141414141414141414141414141"
        "41414141414141414141410a31373933323030303030";
    char payload[512];
    size_t payload_length = 99U;
    assert(device_provisioning_build_enrollment_payload(
        payload, sizeof(payload), "device-enrollment-vector-1", 7U,
        "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAElpkdK/GT4UC/gwUPAcWSej35A54rMTd8hMvO7CacCtxTxuhw1MzgRaRSIkRDj533W/MniowXUuIfvo0IWwOv7A==",
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", 1793200000U, &payload_length
    ) == DEVICE_PROVISIONING_PAYLOAD_OK);

    FILE *fixture = fopen("tests/fixtures/device_enrollment_v1.hex", "rb");
    assert(fixture != NULL);
    char fixture_hex[sizeof(expected_hex)];
    size_t fixture_length = fread(fixture_hex, 1U, sizeof(fixture_hex) - 1U, fixture);
    assert(fclose(fixture) == 0);
    while (fixture_length > 0U && (fixture_hex[fixture_length - 1U] == '\n' || fixture_hex[fixture_length - 1U] == '\r')) fixture_length--;
    fixture_hex[fixture_length] = '\0';
    assert(strcmp(fixture_hex, expected_hex) == 0);
    assert(payload_length * 2U == strlen(fixture_hex));
    for (size_t i = 0U; i < payload_length; ++i) {
        char actual[3];
        (void)snprintf(actual, sizeof(actual), "%02x", (unsigned char)payload[i]);
        assert(actual[0] == fixture_hex[i * 2U] && actual[1] == fixture_hex[i * 2U + 1U]);
    }
    assert(device_provisioning_build_enrollment_payload(
        payload, sizeof(payload), "bad\ndevice", 7U,
        "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAElpkdK/GT4UC/gwUPAcWSej35A54rMTd8hMvO7CacCtxTxuhw1MzgRaRSIkRDj533W/MniowXUuIfvo0IWwOv7A==",
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", 1793200000U, &payload_length
    ) == DEVICE_PROVISIONING_PAYLOAD_INVALID);
    assert(payload_length == 0U);
}

int main(void) {
    test_canonical_payload();
    test_claim_payload_and_device_id();
    test_canonical_enrollment_payload_vector();

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
    unsigned generate_calls_before_corrupt_load = fake.generate_calls;
    assert(device_identity_load_or_generate(&identity, true, 1U) == DEVICE_KEY_PROVIDER_CORRUPT);
    assert(fake.generate_calls == generate_calls_before_corrupt_load);
    return 0;
}
