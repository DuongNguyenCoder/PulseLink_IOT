#include "commissioning_redeem.h"

#include <stdio.h>
#include <string.h>
#include <time.h>

#include "cJSON.h"
#include "commissioning_protocol.h"
#include "device_provisioning_payload.h"
#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "mbedtls/base64.h"

#define REDEEM_BODY_LIMIT 768U
#define REDEEM_RESPONSE_LIMIT 768U
#define REDEEM_TOKEN_LIMIT 256U

typedef struct {
    char body[REDEEM_RESPONSE_LIMIT];
    size_t length;
} redeem_response_t;

static void clear_bytes(void *value, size_t length) {
    volatile uint8_t *bytes = value;
    while (length-- > 0U) *bytes++ = 0U;
}

static esp_err_t response_handler(esp_http_client_event_t *event) {
    if (event == NULL || event->user_data == NULL || event->event_id != HTTP_EVENT_ON_DATA || event->data == NULL) return ESP_OK;
    redeem_response_t *response = event->user_data;
    size_t incoming = event->data_len > 0 ? (size_t)event->data_len : 0U;
    size_t available = sizeof(response->body) - 1U - response->length;
    size_t copied = incoming < available ? incoming : available;
    if (copied > 0U) {
        memcpy(response->body + response->length, event->data, copied);
        response->length += copied;
        response->body[response->length] = '\0';
    }
    return ESP_OK;
}

static bool safe_component(const char *value, size_t max_length) {
    if (value == NULL || value[0] == '\0' || strlen(value) >= max_length) return false;
    for (const char *cursor = value; *cursor != '\0'; cursor++) {
        if (!(('a' <= *cursor && *cursor <= 'z') || ('A' <= *cursor && *cursor <= 'Z') ||
              ('0' <= *cursor && *cursor <= '9') || *cursor == '-' || *cursor == '_')) return false;
    }
    return true;
}

static commissioning_redeem_result_t map_status(int status) {
    if (status == 401 || status == 403 || status == 404 || status == 409) return COMMISSIONING_REDEEM_REJECTED;
    if (status == 400) return COMMISSIONING_REDEEM_MALFORMED;
    if (status >= 500 || status == 0) return COMMISSIONING_REDEEM_RETRYABLE;
    return COMMISSIONING_REDEEM_MALFORMED;
}

commissioning_redeem_result_t commissioning_redeem_and_store(
    const char *base_url, const char *device_id, const char *device_key,
    const char *session_id, const char *bootstrap_secret, const char *challenge,
    uint32_t expires_at, device_identity_t *identity,
    commissioning_credential_storage_t *storage) {
    if (base_url == NULL || strncmp(base_url, "https://", 8U) != 0 ||
        !safe_component(device_id, 128U) || !safe_component(session_id, 128U) ||
        device_key == NULL || device_key[0] == '\0' || bootstrap_secret == NULL ||
        bootstrap_secret[0] == '\0' || challenge == NULL || challenge[0] == '\0' ||
        identity == NULL || device_identity_state(identity) != DEVICE_IDENTITY_READY) return COMMISSIONING_REDEEM_REJECTED;
    if (expires_at <= (uint32_t)time(NULL)) return COMMISSIONING_REDEEM_EXPIRED;
    if (!commissioning_credential_storage_is_ready(storage)) return COMMISSIONING_REDEEM_STORAGE_UNAVAILABLE;

    char canonical[512];
    size_t canonical_length = 0U;
    if (device_provisioning_build_canonical_payload(canonical, sizeof(canonical), session_id,
            device_key, challenge, expires_at, &canonical_length) != DEVICE_PROVISIONING_PAYLOAD_OK) {
        clear_bytes(canonical, sizeof(canonical));
        return COMMISSIONING_REDEEM_MALFORMED;
    }
    uint8_t signature[160];
    size_t signature_length = 0U;
    if (device_identity_sign_der(identity, (const uint8_t *)canonical, canonical_length,
            signature, sizeof(signature), &signature_length) != DEVICE_KEY_PROVIDER_OK) {
        clear_bytes(canonical, sizeof(canonical));
        return COMMISSIONING_REDEEM_REJECTED;
    }
    clear_bytes(canonical, sizeof(canonical));
    char signature_base64[256];
    size_t encoded_length = 0U;
    if (mbedtls_base64_encode((unsigned char *)signature_base64, sizeof(signature_base64), &encoded_length,
            signature, signature_length) != 0 || encoded_length >= sizeof(signature_base64)) {
        clear_bytes(signature, sizeof(signature));
        return COMMISSIONING_REDEEM_MALFORMED;
    }
    signature_base64[encoded_length] = '\0';
    char url[512];
    int url_length = snprintf(url, sizeof(url), "%s/v1/devices/%s/provisioning-sessions/%s/redeem",
        base_url, device_id, session_id);
    if (url_length <= 0 || (size_t)url_length >= sizeof(url)) {
        clear_bytes(signature, sizeof(signature)); clear_bytes(signature_base64, sizeof(signature_base64));
        return COMMISSIONING_REDEEM_MALFORMED;
    }
    cJSON *request_body = cJSON_CreateObject();
    if (request_body == NULL) {
        clear_bytes(signature, sizeof(signature)); clear_bytes(signature_base64, sizeof(signature_base64));
        return COMMISSIONING_REDEEM_MALFORMED;
    }
    cJSON_AddStringToObject(request_body, "bootstrapSecret", bootstrap_secret);
    cJSON_AddStringToObject(request_body, "challenge", challenge);
    cJSON_AddStringToObject(request_body, "signature", signature_base64);
    char *serialized = cJSON_PrintUnformatted(request_body);
    cJSON_Delete(request_body);
    if (serialized == NULL || strlen(serialized) >= REDEEM_BODY_LIMIT) {
        if (serialized != NULL) { clear_bytes(serialized, strlen(serialized)); cJSON_free(serialized); }
        clear_bytes(signature, sizeof(signature)); clear_bytes(signature_base64, sizeof(signature_base64));
        return COMMISSIONING_REDEEM_MALFORMED;
    }
    redeem_response_t response = { 0 };
    esp_http_client_config_t config = {
        .url = url, .method = HTTP_METHOD_POST, .timeout_ms = 8000,
        .buffer_size = 1024, .buffer_size_tx = 1024,
        .event_handler = response_handler, .user_data = &response,
        .crt_bundle_attach = esp_crt_bundle_attach, .keep_alive_enable = false,
    };
    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (client == NULL) {
        clear_bytes(serialized, strlen(serialized)); cJSON_free(serialized); clear_bytes(signature, sizeof(signature)); clear_bytes(signature_base64, sizeof(signature_base64));
        return COMMISSIONING_REDEEM_RETRYABLE;
    }
    esp_http_client_set_header(client, "Content-Type", "application/json");
    esp_http_client_set_post_field(client, serialized, (int)strlen(serialized));
    esp_err_t request_result = esp_http_client_perform(client);
    int status = esp_http_client_get_status_code(client);
    esp_http_client_cleanup(client);
    clear_bytes(serialized, strlen(serialized));
    cJSON_free(serialized);
    clear_bytes(signature, sizeof(signature)); clear_bytes(signature_base64, sizeof(signature_base64));
    if (request_result != ESP_OK) return COMMISSIONING_REDEEM_RETRYABLE;
    if (status < 200 || status >= 300) return map_status(status);
    cJSON *response_root = cJSON_ParseWithLength(response.body, response.length);
    cJSON *data = response_root == NULL ? NULL : cJSON_GetObjectItemCaseSensitive(response_root, "data");
    cJSON *token = data == NULL ? NULL : cJSON_GetObjectItemCaseSensitive(data, "operationalToken");
    char token_copy[REDEEM_TOKEN_LIMIT];
    bool valid = cJSON_IsString(token) && token->valuestring != NULL &&
        strlen(token->valuestring) > 0U && strlen(token->valuestring) < sizeof(token_copy);
    if (valid) strlcpy(token_copy, token->valuestring, sizeof(token_copy));
    if (response_root != NULL) cJSON_Delete(response_root);
    clear_bytes(response.body, sizeof(response.body));
    if (!valid || !commissioning_credential_token_format_valid((const uint8_t *)token_copy, strlen(token_copy))) {
        clear_bytes(token_copy, sizeof(token_copy));
        return COMMISSIONING_REDEEM_MALFORMED;
    }
    commissioning_storage_result_t stored = commissioning_credential_storage_save(
        storage, (const uint8_t *)token_copy, strlen(token_copy));
    clear_bytes(token_copy, sizeof(token_copy));
    if (stored == COMMISSIONING_STORAGE_OK) return COMMISSIONING_REDEEM_OK;
    if (stored == COMMISSIONING_STORAGE_INVALID) return COMMISSIONING_REDEEM_STORAGE_INVALID;
    if (stored == COMMISSIONING_STORAGE_IO_ERROR) return COMMISSIONING_REDEEM_STORAGE_IO_ERROR;
    return COMMISSIONING_REDEEM_STORAGE_UNAVAILABLE;
}
