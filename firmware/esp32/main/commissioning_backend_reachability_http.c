#include "commissioning_backend_reachability.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "cJSON.h"
#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#define STATUS_RESPONSE_LIMIT 768U
#define STATUS_ID_LIMIT 128U
#define STATUS_KEY_LIMIT 256U

typedef struct {
    char body[STATUS_RESPONSE_LIMIT + 1U];
    size_t length;
} status_response_t;

typedef struct {
    commissioning_backend_reachability_t *reachability;
    char url[512];
    char device_id[STATUS_ID_LIMIT];
    char device_key[STATUS_KEY_LIMIT];
    char credential[256];
    uint32_t generation;
    uint32_t timeout_ms;
    bool check_device_key;
} status_probe_task_t;

static void clear_sensitive(void *value, size_t length) {
    volatile uint8_t *bytes = value;
    while (length-- > 0U) *bytes++ = 0U;
}

static esp_err_t status_response_handler(esp_http_client_event_t *event) {
    if (event == NULL || event->user_data == NULL || event->event_id != HTTP_EVENT_ON_DATA ||
        event->data == NULL || event->data_len <= 0) return ESP_OK;
    status_response_t *response = event->user_data;
    size_t incoming = (size_t)event->data_len;
    size_t available = sizeof(response->body) - 1U - response->length;
    size_t copied = incoming < available ? incoming : available;
    if (copied > 0U) {
        memcpy(response->body + response->length, event->data, copied);
        response->length += copied;
        response->body[response->length] = '\0';
    }
    return ESP_OK;
}

static commissioning_backend_probe_result_t classify_response(
    const status_response_t *response,
    int status,
    const char *expected_device_id,
    const char *expected_device_key
) {
    if (status == 401 || status == 403) return COMMISSIONING_BACKEND_PROBE_AUTH_FAILURE;
    if (status == 408 || status == 0) return COMMISSIONING_BACKEND_PROBE_TIMEOUT;
    if (status >= 500) return COMMISSIONING_BACKEND_PROBE_SERVER_ERROR;
    if (status != 200) return COMMISSIONING_BACKEND_PROBE_MALFORMED;
    cJSON *root = cJSON_ParseWithLength(response->body, response->length);
    cJSON *data = root == NULL ? NULL : cJSON_GetObjectItemCaseSensitive(root, "data");
    cJSON *device_id = data == NULL ? NULL : cJSON_GetObjectItemCaseSensitive(data, "deviceId");
    cJSON *device_key = data == NULL ? NULL : cJSON_GetObjectItemCaseSensitive(data, "deviceKey");
    cJSON *provisioning = data == NULL ? NULL : cJSON_GetObjectItemCaseSensitive(data, "provisioningState");
    cJSON *enrollment = data == NULL ? NULL : cJSON_GetObjectItemCaseSensitive(data, "enrollmentStatus");
    bool valid = cJSON_IsString(device_id) && cJSON_IsString(device_key) &&
        cJSON_IsString(provisioning) && cJSON_IsString(enrollment) &&
        strcmp(device_id->valuestring, expected_device_id) == 0 &&
        (expected_device_key == NULL || strcmp(device_key->valuestring, expected_device_key) == 0) &&
        strcmp(provisioning->valuestring, "PROVISIONED") == 0 &&
        strcmp(enrollment->valuestring, "ENROLLED") == 0;
    if (root != NULL) cJSON_Delete(root);
    return valid ? COMMISSIONING_BACKEND_PROBE_OK : COMMISSIONING_BACKEND_PROBE_MALFORMED;
}

static void status_probe_task(void *argument) {
    status_probe_task_t *task = argument;
    status_response_t response = { 0 };
    esp_http_client_config_t config = {
        .url = task->url,
        .method = HTTP_METHOD_GET,
        .timeout_ms = task->timeout_ms,
        .buffer_size = 1024,
        .buffer_size_tx = 512,
        .event_handler = status_response_handler,
        .user_data = &response,
        .crt_bundle_attach = esp_crt_bundle_attach,
        .keep_alive_enable = false,
    };
    commissioning_backend_probe_result_t result = COMMISSIONING_BACKEND_PROBE_NETWORK_ERROR;
    char authorization[320] = { 0 };
    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (client != NULL) {
        int authorization_length = snprintf(authorization, sizeof(authorization), "Bearer %s", task->credential);
        if (authorization_length > 0 && (size_t)authorization_length < sizeof(authorization)) {
            esp_http_client_set_header(client, "Authorization", authorization);
            esp_err_t request_result = esp_http_client_perform(client);
            int status = esp_http_client_get_status_code(client);
            if (request_result == ESP_OK) {
                result = classify_response(&response, status, task->device_id,
                    task->check_device_key ? task->device_key : NULL);
            } else {
                result = COMMISSIONING_BACKEND_PROBE_NETWORK_ERROR;
            }
        } else {
            result = COMMISSIONING_BACKEND_PROBE_MALFORMED;
        }
        esp_http_client_cleanup(client);
    }
    clear_sensitive(authorization, sizeof(authorization));
    clear_sensitive(task->credential, sizeof(task->credential));
    clear_sensitive(response.body, sizeof(response.body));
    commissioning_backend_reachability_complete(task->reachability, task->generation, result);
    clear_sensitive(task, sizeof(*task));
    free(task);
    vTaskDelete(NULL);
}

bool commissioning_backend_reachability_start_https(
    commissioning_backend_reachability_t *reachability,
    const char *base_url,
    const char *expected_device_id,
    const char *expected_device_key,
    uint32_t timeout_ms
) {
    if (reachability == NULL || base_url == NULL || strncmp(base_url, "https://", 8U) != 0 ||
        expected_device_id == NULL || expected_device_id[0] == '\0' || strlen(expected_device_id) >= STATUS_ID_LIMIT ||
        (expected_device_key != NULL && (expected_device_key[0] == '\0' || strlen(expected_device_key) >= STATUS_KEY_LIMIT)) ||
        timeout_ms == 0U || reachability->pending ||
        !commissioning_wifi_controller_is_active(reachability->wifi_controller) ||
        !commissioning_credential_storage_is_ready(reachability->credential_storage)) return false;
    status_probe_task_t *task = calloc(1, sizeof(*task));
    if (task == NULL) return false;
    size_t credential_length = 0U;
    if (commissioning_credential_storage_load(reachability->credential_storage,
            (uint8_t *)task->credential, sizeof(task->credential), &credential_length) != COMMISSIONING_STORAGE_OK ||
        credential_length == 0U || credential_length >= sizeof(task->credential)) {
        clear_sensitive(task, sizeof(*task));
        free(task);
        return false;
    }
    task->credential[credential_length] = '\0';
    int url_length = snprintf(task->url, sizeof(task->url), "%s/v1/device-status", base_url);
    int device_id_length = snprintf(task->device_id, sizeof(task->device_id), "%s", expected_device_id);
    int device_key_length = expected_device_key == NULL ? 0 :
        snprintf(task->device_key, sizeof(task->device_key), "%s", expected_device_key);
    if (url_length <= 0 || (size_t)url_length >= sizeof(task->url) ||
        device_id_length <= 0 || (size_t)device_id_length >= sizeof(task->device_id) ||
        device_key_length < 0 || (size_t)device_key_length >= sizeof(task->device_key)) {
        clear_sensitive(task, sizeof(*task));
        free(task);
        return false;
    }
    task->reachability = reachability;
    task->check_device_key = expected_device_key != NULL;
    task->generation = commissioning_wifi_controller_generation(reachability->wifi_controller);
    task->timeout_ms = timeout_ms;
    reachability->generation = task->generation;
    reachability->pending = true;
    if (xTaskCreate(status_probe_task, "backend_status", 6144, task, 4, NULL) != pdPASS) {
        reachability->pending = false;
        clear_sensitive(task, sizeof(*task));
        free(task);
        return false;
    }
    return true;
}

