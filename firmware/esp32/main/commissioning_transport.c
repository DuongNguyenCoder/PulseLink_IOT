#include "commissioning_transport.h"

#include <string.h>
#include <time.h>

#include "cJSON.h"
#include "commissioning_crypto.h"
#include "commissioning_protocol.h"
#include "device_provisioning_payload.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_random.h"
#include "esp_wifi.h"
#include "mbedtls/base64.h"

#define TRANSPORT_TAG "pulselink-commissioning"
#define REQUEST_LIMIT 4096U
#define MAX_FIELD 768U
#define MAX_CREDENTIALS 512U
#define SESSION_ID_LIMIT 128U
#define CHALLENGE_LIMIT 256U
#define DEVICE_ID_LIMIT 128U

static void clear_bytes(void *value, size_t length);
static bool request_body(httpd_req_t *request, char *body, size_t capacity);
static bool json_string(cJSON *root, const char *name, char *output, size_t capacity);
static bool json_expiry(cJSON *root, uint32_t *output);
static bool response_json(httpd_req_t *request, cJSON *root, const char *type);
static bool response_error(httpd_req_t *request, int status, const char *message);
static bool b64_string(const uint8_t *value, size_t length, char *output, size_t capacity);

static esp_err_t enrollment_proof_handler(httpd_req_t *request) {
    commissioning_transport_t *transport = request->user_ctx;
    char body[REQUEST_LIMIT + 1U];
    if (transport == NULL || !transport->running || transport->identity == NULL ||
        commissioning_state(transport->lifecycle) != COMMISSIONING_SOFTAP_ACTIVE ||
        device_identity_state(transport->identity) != DEVICE_IDENTITY_READY ||
        !request_body(request, body, sizeof(body)))
        return response_error(request, 409, "commissioning_window_required") ? ESP_OK : ESP_FAIL;
    cJSON *root = cJSON_ParseWithLength(body, strlen(body));
    if (root == NULL) return response_error(request, 400, "invalid_json") ? ESP_OK : ESP_FAIL;
    char requested_id[DEVICE_ID_LIMIT], device_id[16], store_id[SESSION_ID_LIMIT];
    char session_id[SESSION_ID_LIMIT], challenge[CHALLENGE_LIMIT];
    uint32_t expires_at = 0U;
    uint8_t mac[6], public_key[160], signature[128];
    size_t public_key_length = 0U, signature_length = 0U;
    char public_key_b64[256], signature_b64[192], payload[2048];
    size_t payload_length = 0U;
    time_t now = time(NULL);
    bool valid = json_string(root, "deviceId", requested_id, sizeof(requested_id)) &&
        json_string(root, "storeId", store_id, sizeof(store_id)) &&
        json_string(root, "claimSessionId", session_id, sizeof(session_id)) &&
        json_string(root, "challenge", challenge, sizeof(challenge)) &&
        json_expiry(root, &expires_at) && expires_at > (uint32_t)now &&
        expires_at <= (uint32_t)now + 300U &&
        esp_read_mac(mac, ESP_MAC_WIFI_STA) == ESP_OK &&
        device_provisioning_build_device_id(mac, device_id, sizeof(device_id)) &&
        strcmp(requested_id, device_id) == 0 &&
        device_identity_get_public_key(transport->identity, public_key, sizeof(public_key), &public_key_length) == DEVICE_KEY_PROVIDER_OK &&
        b64_string(public_key, public_key_length, public_key_b64, sizeof(public_key_b64)) &&
        device_provisioning_build_claim_payload(payload, sizeof(payload), device_id, store_id,
            session_id, device_identity_key_version(transport->identity), public_key_b64,
            challenge, expires_at, &payload_length) == DEVICE_PROVISIONING_PAYLOAD_OK &&
        device_identity_sign_der(transport->identity, (const uint8_t *)payload, payload_length,
            signature, sizeof(signature), &signature_length) == DEVICE_KEY_PROVIDER_OK &&
        b64_string(signature, signature_length, signature_b64, sizeof(signature_b64));
    cJSON_Delete(root);
    clear_bytes(payload, sizeof(payload));
    clear_bytes(signature, sizeof(signature));
    clear_bytes(public_key, sizeof(public_key));
    if (!valid) return response_error(request, 401, "device_claim_proof_unavailable") ? ESP_OK : ESP_FAIL;
    cJSON *response = cJSON_CreateObject();
    if (response == NULL) return response_error(request, 503, "response_unavailable") ? ESP_OK : ESP_FAIL;
    cJSON_AddStringToObject(response, "deviceId", device_id);
    cJSON_AddStringToObject(response, "storeId", store_id);
    cJSON_AddStringToObject(response, "claimSessionId", session_id);
    cJSON_AddStringToObject(response, "publicKeySpkiBase64", public_key_b64);
    cJSON_AddNumberToObject(response, "keyVersion", device_identity_key_version(transport->identity));
    cJSON_AddStringToObject(response, "challenge", challenge);
    cJSON_AddNumberToObject(response, "expiresAt", expires_at);
    cJSON_AddStringToObject(response, "signatureDerBase64", signature_b64);
    bool sent = response_json(request, response, "application/json");
    cJSON_Delete(response);
    clear_bytes(signature_b64, sizeof(signature_b64));
    return sent ? ESP_OK : ESP_FAIL;
}

static void clear_bytes(void *value, size_t length) {
    volatile uint8_t *bytes = value;
    while (length-- > 0U) *bytes++ = 0U;
}

static bool decode_base64(const char *value, uint8_t *output, size_t capacity, size_t *length) {
    if (value == NULL || output == NULL || length == NULL) return false;
    size_t input_length = strlen(value);
    if (input_length == 0U || input_length > MAX_FIELD) return false;
    size_t decoded = 0U;
    int result = mbedtls_base64_decode(output, capacity, &decoded,
        (const unsigned char *)value, input_length);
    if (result != 0) return false;
    *length = decoded;
    return true;
}

static bool request_body(httpd_req_t *request, char *body, size_t capacity) {
    if (request == NULL || body == NULL || request->content_len == 0U ||
        request->content_len >= capacity || request->content_len > REQUEST_LIMIT) return false;
    size_t received = 0U;
    while (received < request->content_len) {
        int read = httpd_req_recv(request, body + received, request->content_len - received);
        if (read <= 0) return false;
        received += (size_t)read;
    }
    body[received] = '\0';
    return true;
}

static bool json_string(cJSON *root, const char *name, char *output, size_t capacity) {
    cJSON *item = cJSON_GetObjectItemCaseSensitive(root, name);
    if (!cJSON_IsString(item) || item->valuestring == NULL ||
        strlen(item->valuestring) >= capacity) return false;
    strlcpy(output, item->valuestring, capacity);
    return true;
}

static bool json_expiry(cJSON *root, uint32_t *output) {
    cJSON *item = cJSON_GetObjectItemCaseSensitive(root, "expiresAt");
    if (!cJSON_IsNumber(item) || item->valuedouble < 1.0 || item->valuedouble > 4294967295.0 ||
        item->valuedouble != (double)(uint32_t)item->valuedouble) return false;
    *output = (uint32_t)item->valuedouble;
    return true;
}

static bool json_base64_field(cJSON *root, const char *name, uint8_t *output, size_t capacity, size_t *length) {
    cJSON *item = cJSON_GetObjectItemCaseSensitive(root, name);
    return cJSON_IsString(item) && item->valuestring != NULL &&
        decode_base64(item->valuestring, output, capacity, length);
}

static bool response_json(httpd_req_t *request, cJSON *root, const char *type) {
    char *serialized = cJSON_PrintUnformatted(root);
    if (serialized == NULL) return false;
    httpd_resp_set_type(request, type);
    esp_err_t result = httpd_resp_send(request, serialized, HTTPD_RESP_USE_STRLEN);
    cJSON_free(serialized);
    return result == ESP_OK;
}

static bool response_error(httpd_req_t *request, int status, const char *message) {
    cJSON *root = cJSON_CreateObject();
    if (root == NULL) return false;
    cJSON_AddStringToObject(root, "error", message);
    httpd_resp_set_status(request, status == 400 ? "400 Bad Request" :
        status == 401 ? "401 Unauthorized" : status == 409 ? "409 Conflict" : "503 Service Unavailable");
    bool sent = response_json(request, root, "application/json");
    cJSON_Delete(root);
    return sent;
}

static bool b64_string(const uint8_t *value, size_t length, char *output, size_t capacity) {
    size_t written = 0U;
    if (mbedtls_base64_encode((unsigned char *)output, capacity, &written, value, length) != 0) return false;
    return written < capacity;
}

static esp_err_t handshake_handler(httpd_req_t *request) {
    commissioning_transport_t *transport = request->user_ctx;
    char body[REQUEST_LIMIT + 1U];
    if (transport == NULL || !transport->running || transport->lifecycle == NULL ||
        commissioning_state(transport->lifecycle) != COMMISSIONING_SOFTAP_ACTIVE ||
        transport->identity == NULL || device_identity_state(transport->identity) != DEVICE_IDENTITY_READY ||
        !request_body(request, body, sizeof(body))) return response_error(request, 400, "invalid_request") ? ESP_OK : ESP_FAIL;

    cJSON *root = cJSON_ParseWithLength(body, strlen(body));
    if (root == NULL) return response_error(request, 400, "invalid_json") ? ESP_OK : ESP_FAIL;
    char session_id[SESSION_ID_LIMIT], challenge[CHALLENGE_LIMIT], context[SESSION_ID_LIMIT];
    uint32_t expires_at = 0U;
    uint8_t client_nonce[32], client_ephemeral[65], enrolled_key[160];
    size_t client_nonce_length = 0U, client_ephemeral_length = 0U, enrolled_key_length = 0U;
    bool valid = json_string(root, "sessionId", session_id, sizeof(session_id)) &&
        json_string(root, "challenge", challenge, sizeof(challenge)) &&
        json_string(root, "clientContext", context, sizeof(context)) &&
        json_expiry(root, &expires_at) &&
        json_base64_field(root, "clientNonce", client_nonce, sizeof(client_nonce), &client_nonce_length) &&
        json_base64_field(root, "clientEphemeralPublicKey", client_ephemeral, sizeof(client_ephemeral), &client_ephemeral_length) &&
        json_base64_field(root, "deviceKey", enrolled_key, sizeof(enrolled_key), &enrolled_key_length);
    if (!valid || client_nonce_length != 32U || client_ephemeral_length != 65U || client_ephemeral[0] != 0x04U) {
        cJSON_Delete(root);
        return response_error(request, 400, "invalid_handshake") ? ESP_OK : ESP_FAIL;
    }
    time_t now = time(NULL);
    if (expires_at <= (uint32_t)now) {
        cJSON_Delete(root);
        return response_error(request, 409, "session_expired") ? ESP_OK : ESP_FAIL;
    }
    uint8_t own_key[160], device_nonce[32], device_ephemeral_public[65], shared[32], salt[64], signature[160];
    size_t own_key_length = 0U, device_ephemeral_length = 0U, shared_length = 0U, signature_length = 0U;
    bool ok = device_identity_get_public_key(transport->identity, own_key, sizeof(own_key), &own_key_length) == DEVICE_KEY_PROVIDER_OK &&
        own_key_length == enrolled_key_length && memcmp(own_key, enrolled_key, own_key_length) == 0;
    if (ok) {
        esp_fill_random(device_nonce, sizeof(device_nonce));
        commissioning_ephemeral_key_t ephemeral = { 0 };
        ok = commissioning_crypto_ephemeral_generate(&ephemeral) &&
            commissioning_crypto_ephemeral_public_key(&ephemeral, device_ephemeral_public, sizeof(device_ephemeral_public), &device_ephemeral_length);
        if (ok) {
            ok = commissioning_protocol_build_transcript(
                transport->transcript, sizeof(transport->transcript), 1U,
                (const uint8_t *)session_id, strlen(session_id), own_key, own_key_length,
                (const uint8_t *)challenge, strlen(challenge), expires_at,
                (const uint8_t *)context, strlen(context), client_nonce, sizeof(client_nonce),
                device_nonce, sizeof(device_nonce), client_ephemeral, client_ephemeral_length,
                device_ephemeral_public, device_ephemeral_length, &transport->transcript_length
            ) == COMMISSIONING_PROTOCOL_OK &&
            commissioning_crypto_ephemeral_shared_secret(&ephemeral, client_ephemeral, client_ephemeral_length, shared, sizeof(shared), &shared_length);
            if (ok) {
                memcpy(salt, client_nonce, sizeof(client_nonce));
                memcpy(salt + sizeof(client_nonce), device_nonce, sizeof(device_nonce));
                static const uint8_t info[] = "pulselink-softap-session-v1";
                ok = commissioning_crypto_hkdf_sha256(shared, shared_length, salt, sizeof(salt), info, sizeof(info) - 1U, transport->session_key, sizeof(transport->session_key));
            }
            if (ok) ok = device_identity_sign_der(transport->identity, transport->transcript, transport->transcript_length, signature, sizeof(signature), &signature_length) == DEVICE_KEY_PROVIDER_OK;
        }
        commissioning_crypto_ephemeral_free(&ephemeral);
    }
    clear_bytes(shared, sizeof(shared));
    clear_bytes(salt, sizeof(salt));
    cJSON_Delete(root);
    if (!ok || signature_length == 0U) {
        clear_bytes(transport->session_key, sizeof(transport->session_key));
        return response_error(request, 401, "identity_verification_failed") ? ESP_OK : ESP_FAIL;
    }
    transport->expires_at = expires_at;
    strlcpy(transport->session_id, session_id, sizeof(transport->session_id));
    strlcpy(transport->challenge, challenge, sizeof(transport->challenge));
    transport->handshake_complete = true;
    if (!commissioning_transition(transport->lifecycle, COMMISSIONING_RECEIVING_CONFIG)) {
        transport->handshake_complete = false;
        clear_bytes(transport->session_key, sizeof(transport->session_key));
        return response_error(request, 409, "invalid_state") ? ESP_OK : ESP_FAIL;
    }
    cJSON *response = cJSON_CreateObject();
    char encoded[1024];
    ok = response != NULL && b64_string(own_key, own_key_length, encoded, sizeof(encoded));
    if (ok) cJSON_AddStringToObject(response, "deviceKey", encoded);
    ok = ok && b64_string(device_nonce, sizeof(device_nonce), encoded, sizeof(encoded));
    if (ok) cJSON_AddStringToObject(response, "deviceNonce", encoded);
    ok = ok && b64_string(device_ephemeral_public, device_ephemeral_length, encoded, sizeof(encoded));
    if (ok) cJSON_AddStringToObject(response, "deviceEphemeralPublicKey", encoded);
    ok = ok && b64_string(signature, signature_length, encoded, sizeof(encoded));
    if (ok) cJSON_AddStringToObject(response, "signature", encoded);
    if (!ok) { cJSON_Delete(response); return response_error(request, 503, "response_unavailable") ? ESP_OK : ESP_FAIL; }
    bool sent = response_json(request, response, "application/json");
    cJSON_Delete(response);
    clear_bytes(signature, sizeof(signature));
    clear_bytes(device_nonce, sizeof(device_nonce));
    clear_bytes(device_ephemeral_public, sizeof(device_ephemeral_public));
    return sent ? ESP_OK : ESP_FAIL;
}

static esp_err_t credentials_handler(httpd_req_t *request) {
    commissioning_transport_t *transport = request->user_ctx;
    char body[REQUEST_LIMIT + 1U];
    if (transport == NULL || !transport->running || !transport->handshake_complete ||
        commissioning_state(transport->lifecycle) != COMMISSIONING_RECEIVING_CONFIG || !request_body(request, body, sizeof(body)))
        return response_error(request, 409, "handshake_required") ? ESP_OK : ESP_FAIL;
    time_t now = time(NULL);
    if (transport->expires_at <= (uint32_t)now) return response_error(request, 409, "session_expired") ? ESP_OK : ESP_FAIL;
    if (!commissioning_transition(transport->lifecycle, COMMISSIONING_CONNECTING_TO_WIFI))
        return response_error(request, 409, "invalid_state") ? ESP_OK : ESP_FAIL;
    cJSON *root = cJSON_ParseWithLength(body, strlen(body));
    if (root == NULL) {
        (void)commissioning_fail(transport->lifecycle);
        return response_error(request, 400, "invalid_json") ? ESP_OK : ESP_FAIL;
    }
    uint8_t nonce[12], aad[1024], ciphertext[MAX_CREDENTIALS], tag[16], plaintext[MAX_CREDENTIALS + 1U];
    size_t nonce_length = 0U, aad_length = 0U, ciphertext_length = 0U, tag_length = 0U;
    cJSON *nonce_item = cJSON_GetObjectItem(root, "nonce");
    cJSON *aad_item = cJSON_GetObjectItem(root, "aad");
    cJSON *cipher_item = cJSON_GetObjectItem(root, "ciphertext");
    cJSON *tag_item = cJSON_GetObjectItem(root, "tag");
    bool ok = cJSON_IsString(nonce_item) && cJSON_IsString(aad_item) && cJSON_IsString(cipher_item) && cJSON_IsString(tag_item) &&
        decode_base64(nonce_item->valuestring, nonce, sizeof(nonce), &nonce_length) &&
        decode_base64(aad_item->valuestring, aad, sizeof(aad), &aad_length) &&
        decode_base64(cipher_item->valuestring, ciphertext, sizeof(ciphertext), &ciphertext_length) &&
        decode_base64(tag_item->valuestring, tag, sizeof(tag), &tag_length) && nonce_length == 12U && tag_length == 16U &&
        aad_length == transport->transcript_length && memcmp(aad, transport->transcript, aad_length) == 0 &&
        commissioning_crypto_aes128_gcm_decrypt(transport->session_key, nonce, aad, aad_length, ciphertext, ciphertext_length, tag, plaintext);
    if (ok) {
        plaintext[ciphertext_length] = '\0';
        cJSON *credentials = cJSON_ParseWithLength((char *)plaintext, ciphertext_length);
        char ssid[33], password[65], device_id[DEVICE_ID_LIMIT], device_key[MAX_FIELD], bootstrap_secret[MAX_FIELD];
        ok = credentials != NULL && json_string(credentials, "ssid", ssid, sizeof(ssid)) &&
            json_string(credentials, "password", password, sizeof(password)) && strlen(ssid) > 0U &&
            strlen(password) >= 8U && transport->credentials_callback != NULL;
        if (ok) {
            ok = json_string(credentials, "deviceId", device_id, sizeof(device_id)) &&
                json_string(credentials, "deviceKey", device_key, sizeof(device_key)) &&
                json_string(credentials, "bootstrapSecret", bootstrap_secret, sizeof(bootstrap_secret)) &&
                strlen(device_id) > 0U && strlen(device_key) > 0U && strlen(bootstrap_secret) >= 32U &&
                transport->credentials_callback(ssid, password, device_id, device_key,
                    bootstrap_secret, transport->session_id, transport->challenge,
                    transport->expires_at, transport->callback_context);
        }
        clear_bytes(device_id, sizeof(device_id));
        clear_bytes(device_key, sizeof(device_key));
        clear_bytes(bootstrap_secret, sizeof(bootstrap_secret));
        clear_bytes(password, sizeof(password));
        if (credentials != NULL) cJSON_Delete(credentials);
        clear_bytes(ssid, sizeof(ssid));
    }
    clear_bytes(plaintext, sizeof(plaintext));
    clear_bytes(transport->session_key, sizeof(transport->session_key));
    transport->handshake_complete = false;
    cJSON_Delete(root);
    if (!ok) {
        (void)commissioning_fail(transport->lifecycle);
        return response_error(request, 400, "credential_rejected") ? ESP_OK : ESP_FAIL;
    }
    httpd_resp_set_type(request, "application/json");
    return httpd_resp_sendstr(request, "{\"status\":\"accepted_for_redeem\"}");
}

bool commissioning_transport_init(commissioning_transport_t *transport, commissioning_context_t *lifecycle, device_identity_t *identity, commissioning_credentials_callback_t credentials_callback, void *callback_context) {
    if (transport == NULL || lifecycle == NULL || identity == NULL || credentials_callback == NULL) return false;
    memset(transport, 0, sizeof(*transport));
    transport->lifecycle = lifecycle;
    transport->identity = identity;
    transport->credentials_callback = credentials_callback;
    transport->callback_context = callback_context;
    return true;
}

static bool start_server(commissioning_transport_t *transport) {
    if (transport == NULL || transport->running || transport->lifecycle == NULL || transport->identity == NULL ||
        commissioning_state(transport->lifecycle) != COMMISSIONING_SOFTAP_ACTIVE || device_identity_state(transport->identity) != DEVICE_IDENTITY_READY) return false;
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.max_uri_handlers = 3;
    config.max_open_sockets = 1;
    config.max_req_hdr_len = 512;
    config.max_uri_handlers = 3;
    httpd_handle_t server = NULL;
    if (httpd_start(&server, &config) != ESP_OK) return false;
    httpd_uri_t handshake = { .uri = "/v1/commissioning/handshake", .method = HTTP_POST, .handler = handshake_handler, .user_ctx = transport };
    httpd_uri_t credentials = { .uri = "/v1/commissioning/credentials", .method = HTTP_POST, .handler = credentials_handler, .user_ctx = transport };
    httpd_uri_t enrollment_proof = { .uri = "/v1/commissioning/enrollment-proof", .method = HTTP_POST, .handler = enrollment_proof_handler, .user_ctx = transport };
    if (httpd_register_uri_handler(server, &handshake) != ESP_OK || httpd_register_uri_handler(server, &credentials) != ESP_OK ||
        httpd_register_uri_handler(server, &enrollment_proof) != ESP_OK) {
        httpd_stop(server);
        return false;
    }
    transport->server = server;
    transport->running = true;
    return true;
}

bool commissioning_transport_start(commissioning_transport_t *transport) {
    return start_server(transport);
}

bool commissioning_transport_start_softap(commissioning_transport_t *transport, const char *ssid) {
    if (transport == NULL || ssid == NULL || strlen(ssid) == 0U || strlen(ssid) > 32U) return false;
    // main.c owns esp_netif, the default event loop, and the Wi-Fi driver.
    // Reinitializing those here races the already-running Station owner.
    if (esp_netif_create_default_wifi_ap() == NULL) return false;
    wifi_config_t config = { 0 };
    strlcpy((char *)config.ap.ssid, ssid, sizeof(config.ap.ssid));
    config.ap.ssid_len = strlen(ssid);
    config.ap.channel = 1;
    config.ap.max_connection = 1;
    config.ap.authmode = WIFI_AUTH_OPEN;
    if (esp_wifi_set_mode(WIFI_MODE_AP) != ESP_OK ||
        esp_wifi_set_config(WIFI_IF_AP, &config) != ESP_OK ||
        !commissioning_transport_start(transport)) {
        (void)esp_wifi_set_mode(WIFI_MODE_STA);
        return false;
    }
    return true;
}

void commissioning_transport_stop(commissioning_transport_t *transport) {
    if (transport == NULL) return;
    if (transport->server != NULL) httpd_stop((httpd_handle_t)transport->server);
    // Keep the single driver initialized by main.c and return its mode to STA.
    (void)esp_wifi_set_mode(WIFI_MODE_STA);
    transport->server = NULL;
    transport->running = false;
    transport->handshake_complete = false;
    clear_bytes(transport->session_key, sizeof(transport->session_key));
    clear_bytes(transport->transcript, sizeof(transport->transcript));
    transport->transcript_length = 0U;
    clear_bytes(transport->session_id, sizeof(transport->session_id));
    clear_bytes(transport->challenge, sizeof(transport->challenge));
}

bool commissioning_transport_is_running(const commissioning_transport_t *transport) {
    return transport != NULL && transport->running;
}
