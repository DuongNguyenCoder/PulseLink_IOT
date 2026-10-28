#include "commissioning_protocol.h"

#include <assert.h>
#include <stdio.h>
#include <stdint.h>
#include <string.h>

static uint8_t hex_value(char value) {
    if (value >= '0' && value <= '9') return (uint8_t)(value - '0');
    if (value >= 'a' && value <= 'f') return (uint8_t)(value - 'a' + 10);
    if (value >= 'A' && value <= 'F') return (uint8_t)(value - 'A' + 10);
    return 0xffU;
}

static size_t read_fixture(uint8_t *output, size_t capacity) {
    FILE *file = fopen("tests/fixtures/commissioning_transcript_v1.hex", "rb");
    assert(file != NULL);
    size_t length = 0U;
    int high;
    while ((high = fgetc(file)) != EOF) {
        if (high == '\n' || high == '\r' || high == ' ' || high == '\t') continue;
        int low = fgetc(file);
        assert(low != EOF);
        uint8_t high_value = hex_value((char)high);
        uint8_t low_value = hex_value((char)low);
        assert(high_value != 0xffU && low_value != 0xffU);
        assert(length < capacity);
        output[length++] = (uint8_t)((high_value << 4U) | low_value);
    }
    fclose(file);
    return length;
}

static void test_vector(void) {
    const uint8_t session[] = "session-1";
    const uint8_t device[] = { 0x30, 0x01, 0x02 };
    const uint8_t challenge[] = "challenge-1";
    const uint8_t context[] = "owner-app";
    const uint8_t client_nonce[] = { 0x01, 0x02 };
    const uint8_t device_nonce[] = { 0x03, 0x04 };
    const uint8_t client_ephemeral[] = { 0x05, 0x06 };
    const uint8_t device_ephemeral[] = { 0x07, 0x08 };
    uint8_t output[256];
    size_t length = 0U;
    assert(commissioning_protocol_build_transcript(
        output, sizeof(output), 1U,
        session, sizeof(session) - 1U,
        device, sizeof(device),
        challenge, sizeof(challenge) - 1U,
        1700000000U,
        context, sizeof(context) - 1U,
        client_nonce, sizeof(client_nonce),
        device_nonce, sizeof(device_nonce),
        client_ephemeral, sizeof(client_ephemeral),
        device_ephemeral, sizeof(device_ephemeral),
        &length
    ) == COMMISSIONING_PROTOCOL_OK);
    assert(length == 119U);
    assert(output[0] == 0U && output[1] == 0U && output[2] == 0U && output[3] == 33U);
    assert(output[37] == 0U && output[38] == 1U);
    assert(output[length - 2U] == 0x07U && output[length - 1U] == 0x08U);
    uint8_t fixture[256];
    size_t fixture_length = read_fixture(fixture, sizeof(fixture));
    assert(fixture_length == length);
    assert(memcmp(fixture, output, length) == 0);
}

static void invalid_inputs(void) {
    uint8_t output[39];
    size_t length = 0U;
    assert(commissioning_protocol_build_transcript(
        output, sizeof(output), 0U,
        NULL, 0U, NULL, 0U, NULL, 0U, 0U,
        NULL, 0U, NULL, 0U, NULL, 0U, NULL, 0U, NULL, 0U,
        &length
    ) == COMMISSIONING_PROTOCOL_INVALID);
    assert(commissioning_protocol_build_transcript(
        output, sizeof(output), 1U,
        NULL, 0U, NULL, 0U, NULL, 0U, 0U,
        NULL, 0U, NULL, 0U, NULL, 0U, NULL, 0U, NULL, 0U,
        &length
    ) == COMMISSIONING_PROTOCOL_TOO_SMALL);
}

int main(void) {
    test_vector();
    invalid_inputs();
    return 0;
}
