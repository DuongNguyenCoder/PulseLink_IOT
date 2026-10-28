#include <stdbool.h>
#include <stdio.h>
#include <string.h>
#include <time.h>

#include "cJSON.h"
#include "commissioning_transport.h"
#include "commissioning_redeem.h"
#include "commissioning_credential_storage.h"
#include "commissioning_wifi_controller.h"
#include "commissioning_backend_reachability.h"
#include "commissioning_event_gate.h"
#include "physical_confirmation.h"
#include "commissioning_state.h"
#include "device_identity.h"
#include "esp_device_identity_provider.h"
#include "driver/gpio.h"
#include "esp_crt_bundle.h"
#include "esp_event.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_random.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "nvs.h"
#include "nvs_flash.h"
#include "sdkconfig.h"

static const char *TAG = "pulselink";
static const int WIFI_CONNECTED_BIT = BIT0;
static const int WIFI_RECONNECT_BIT = BIT1;
static EventGroupHandle_t s_wifi_events;
static SemaphoreHandle_t s_queue_mutex;
static TaskHandle_t s_sender_task;
static TaskHandle_t s_http_smoke_task;
static uint32_t s_disconnect_count;

#define EVENT_QUEUE_KEY "events"
#define EVENT_QUEUE_MAX 8U
#define EVENT_ID_LENGTH 37U
#define EVENT_PAYLOAD_LENGTH 128U
#define HTTP_RESPONSE_LIMIT 256U
#define HTTP_TIMEOUT_MS 5000
#define BUTTON_STABLE_MS 50U
#define BUTTON_DEBOUNCE_MS 5000U

typedef enum { EVENT_SLOT_EMPTY = 0, EVENT_SLOT_PENDING = 1, EVENT_SLOT_BLOCKED = 2 } event_slot_state_t;
typedef struct {
    uint8_t state;
    char event_id[EVENT_ID_LENGTH];
    int64_t occurred_at;
    int rssi_dbm;
    char payload[EVENT_PAYLOAD_LENGTH];
} queued_event_t;
typedef struct { uint32_t version; queued_event_t events[EVENT_QUEUE_MAX]; } event_queue_t;
typedef struct { char body[HTTP_RESPONSE_LIMIT + 1U]; size_t length; } http_response_t;
static event_queue_t s_event_queue;

static void clear_sensitive(void *value, size_t length) {
    volatile uint8_t *bytes = value;
    while (length-- > 0U) *bytes++ = 0U;
}

#if CONFIG_PULSELINK_COMMISSIONING_ENABLED
static commissioning_context_t s_commissioning;
static physical_confirmation_t s_physical_confirmation;
static commissioning_transport_t s_commissioning_transport;
static commissioning_wifi_controller_t s_commissioning_wifi;
static device_identity_t s_device_identity;
static esp_device_identity_provider_t s_identity_provider;
static commissioning_credential_storage_t s_credential_storage;
static commissioning_backend_reachability_t s_backend_reachability;
static SemaphoreHandle_t s_commissioning_mutex;
static bool s_redemption_pending;
static bool s_redemption_started;
static char s_pending_ssid[33];
static char s_pending_password[65];
static char s_pending_device_id[128];
static char s_pending_device_key[256];
static char s_pending_bootstrap[128];
static char s_pending_session_id[128];
static char s_pending_challenge[256];
static uint32_t s_pending_expires_at;

static bool commissioning_unused_probe_start(void *context, const uint8_t *credential,
        size_t credential_length, uint32_t generation) {
    (void)context; (void)credential; (void)credential_length; (void)generation;
    return false;
}

static bool commissioning_wifi_configure_station(void *context, const char *ssid, const char *password) {
    (void)context;
    wifi_config_t config = { 0 };
    strlcpy((char *)config.sta.ssid, ssid, sizeof(config.sta.ssid));
    strlcpy((char *)config.sta.password, password, sizeof(config.sta.password));
    config.sta.scan_method = WIFI_FAST_SCAN;
    config.sta.sort_method = WIFI_CONNECT_AP_BY_SIGNAL;
    config.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;
    return esp_wifi_set_mode(WIFI_MODE_STA) == ESP_OK && esp_wifi_set_config(WIFI_IF_STA, &config) == ESP_OK;
}

static bool commissioning_wifi_connect(void *context) {
    (void)context;
    esp_err_t result = esp_wifi_connect();
    return result == ESP_OK || result == ESP_ERR_WIFI_CONN;
}

static void commissioning_wifi_disconnect(void *context) {
    (void)context;
    (void)esp_wifi_disconnect();
}

static void commissioning_wifi_controller_task(void *arg) {
    (void)arg;
    while (true) {
        commissioning_wifi_controller_tick(&s_commissioning_wifi,
            (uint32_t)pdTICKS_TO_MS(xTaskGetTickCount()));
        vTaskDelay(pdMS_TO_TICKS(100));
    }
}

static void clear_commissioning_pending_locked(void) {
    clear_sensitive(s_pending_ssid, sizeof(s_pending_ssid));
    clear_sensitive(s_pending_password, sizeof(s_pending_password));
    clear_sensitive(s_pending_device_id, sizeof(s_pending_device_id));
    clear_sensitive(s_pending_device_key, sizeof(s_pending_device_key));
    clear_sensitive(s_pending_bootstrap, sizeof(s_pending_bootstrap));
    clear_sensitive(s_pending_session_id, sizeof(s_pending_session_id));
    clear_sensitive(s_pending_challenge, sizeof(s_pending_challenge));
    s_pending_expires_at = 0U;
    s_redemption_pending = false;
    s_redemption_started = false;
}

static void commissioning_start_station_task(void *arg) {
    (void)arg;
    char ssid[sizeof(s_pending_ssid)] = { 0 };
    char password[sizeof(s_pending_password)] = { 0 };
    vTaskDelay(pdMS_TO_TICKS(150));
    if (s_commissioning_mutex == NULL || xSemaphoreTake(s_commissioning_mutex, pdMS_TO_TICKS(100)) != pdTRUE) {
        commissioning_fail(&s_commissioning);
        vTaskDelete(NULL);
        return;
    }
    bool pending = s_redemption_pending &&
        commissioning_state(&s_commissioning) == COMMISSIONING_CONNECTING_TO_WIFI;
    if (pending) {
        strlcpy(ssid, s_pending_ssid, sizeof(ssid));
        strlcpy(password, s_pending_password, sizeof(password));
    }
    xSemaphoreGive(s_commissioning_mutex);
    if (!pending) {
        clear_sensitive(ssid, sizeof(ssid));
        clear_sensitive(password, sizeof(password));
        vTaskDelete(NULL);
        return;
    }
    commissioning_transport_stop(&s_commissioning_transport);
    bool started = commissioning_wifi_controller_start(&s_commissioning_wifi, ssid, password,
        (uint32_t)pdTICKS_TO_MS(xTaskGetTickCount()), 60000U);
    clear_sensitive(ssid, sizeof(ssid));
    clear_sensitive(password, sizeof(password));
    if (!started) {
        commissioning_fail(&s_commissioning);
        if (xSemaphoreTake(s_commissioning_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
            clear_commissioning_pending_locked();
            xSemaphoreGive(s_commissioning_mutex);
        }
    }
    vTaskDelete(NULL);
}

static void commissioning_redemption_task(void *arg) {
    (void)arg;
    char device_id[sizeof(s_pending_device_id)] = { 0 };
    char device_key[sizeof(s_pending_device_key)] = { 0 };
    char bootstrap[sizeof(s_pending_bootstrap)] = { 0 };
    char session_id[sizeof(s_pending_session_id)] = { 0 };
    char challenge[sizeof(s_pending_challenge)] = { 0 };
    uint32_t expires_at = 0U;
    bool copied = false;
    if (s_commissioning_mutex != NULL && xSemaphoreTake(s_commissioning_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
        copied = s_redemption_pending && s_redemption_started;
        if (copied) {
            strlcpy(device_id, s_pending_device_id, sizeof(device_id));
            strlcpy(device_key, s_pending_device_key, sizeof(device_key));
            strlcpy(bootstrap, s_pending_bootstrap, sizeof(bootstrap));
            strlcpy(session_id, s_pending_session_id, sizeof(session_id));
            strlcpy(challenge, s_pending_challenge, sizeof(challenge));
            expires_at = s_pending_expires_at;
            clear_commissioning_pending_locked();
        }
        xSemaphoreGive(s_commissioning_mutex);
    }
    if (!copied || commissioning_state(&s_commissioning) != COMMISSIONING_WIFI_CONNECTED ||
        !commissioning_transition(&s_commissioning, COMMISSIONING_REDEEMING)) goto failed;

    commissioning_redeem_result_t result = commissioning_redeem_and_store(
        CONFIG_PULSELINK_REDEMPTION_BASE_URL, device_id, device_key, session_id,
        bootstrap, challenge, expires_at, &s_device_identity, &s_credential_storage);
    if (result != COMMISSIONING_REDEEM_OK || !commissioning_consume_session(&s_commissioning) ||
        !commissioning_transition(&s_commissioning, COMMISSIONING_CREDENTIAL_PERSISTING)) goto failed;

    if (!commissioning_backend_reachability_start_https(&s_backend_reachability,
            CONFIG_PULSELINK_REDEMPTION_BASE_URL, device_id, device_key, 8000U)) goto failed;
    goto cleanup;

failed:
    (void)commissioning_wifi_controller_fail(&s_commissioning_wifi,
        commissioning_wifi_controller_generation(&s_commissioning_wifi));
cleanup:
    clear_sensitive(device_id, sizeof(device_id));
    clear_sensitive(device_key, sizeof(device_key));
    clear_sensitive(bootstrap, sizeof(bootstrap));
    clear_sensitive(session_id, sizeof(session_id));
    clear_sensitive(challenge, sizeof(challenge));
    vTaskDelete(NULL);
}

static bool commissioning_credentials_received(
    const char *ssid, const char *password, const char *device_id, const char *device_key,
    const char *bootstrap_secret, const char *session_id, const char *challenge,
    uint32_t expires_at, void *context) {
    (void)context;
    if (strlen(CONFIG_PULSELINK_REDEMPTION_BASE_URL) == 0U ||
        !commissioning_credential_storage_is_ready(&s_credential_storage) ||
        s_commissioning_mutex == NULL || xSemaphoreTake(s_commissioning_mutex, pdMS_TO_TICKS(100)) != pdTRUE) {
        ESP_LOGW(TAG, "commissioning credentials rejected: redemption/storage unavailable");
        return false;
    }
    if (s_redemption_pending || strlen(ssid) >= sizeof(s_pending_ssid) ||
        strlen(password) >= sizeof(s_pending_password) || strlen(device_id) >= sizeof(s_pending_device_id) ||
        strlen(device_key) >= sizeof(s_pending_device_key) || strlen(bootstrap_secret) >= sizeof(s_pending_bootstrap) ||
        strlen(session_id) >= sizeof(s_pending_session_id) || strlen(challenge) >= sizeof(s_pending_challenge)) {
        xSemaphoreGive(s_commissioning_mutex);
        return false;
    }
    strlcpy(s_pending_ssid, ssid, sizeof(s_pending_ssid));
    strlcpy(s_pending_password, password, sizeof(s_pending_password));
    strlcpy(s_pending_device_id, device_id, sizeof(s_pending_device_id));
    strlcpy(s_pending_device_key, device_key, sizeof(s_pending_device_key));
    strlcpy(s_pending_bootstrap, bootstrap_secret, sizeof(s_pending_bootstrap));
    strlcpy(s_pending_session_id, session_id, sizeof(s_pending_session_id));
    strlcpy(s_pending_challenge, challenge, sizeof(s_pending_challenge));
    s_pending_expires_at = expires_at;
    s_redemption_pending = true;
    xSemaphoreGive(s_commissioning_mutex);
    if (xTaskCreate(commissioning_start_station_task, "commissioning_station", 4096, NULL, 5, NULL) != pdPASS) {
        if (xSemaphoreTake(s_commissioning_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
            clear_commissioning_pending_locked();
            xSemaphoreGive(s_commissioning_mutex);
        }
        return false;
    }
    return true;
}

static void commissioning_gate_task(void *arg) {
    (void)arg;
    uint32_t now = (uint32_t)pdTICKS_TO_MS(xTaskGetTickCount());
    commissioning_begin(&s_commissioning, now, PHYSICAL_CONFIRMATION_WINDOW_MS);
    physical_confirmation_start(&s_physical_confirmation, now);
    while (commissioning_state(&s_commissioning) == COMMISSIONING_WAITING_FOR_PHYSICAL_CONFIRMATION ||
           commissioning_state(&s_commissioning) == COMMISSIONING_SOFTAP_ACTIVE) {
        now = (uint32_t)pdTICKS_TO_MS(xTaskGetTickCount());
        physical_confirmation_sample_level(&s_physical_confirmation,
            gpio_get_level(CONFIG_PULSELINK_COMMISSIONING_BUTTON_GPIO), now);
        if (physical_confirmation_state(&s_physical_confirmation) == PHYSICAL_CONFIRMATION_ACCEPTED) {
            if (commissioning_accept_physical(&s_commissioning, now)) {
                uint8_t mac[6] = { 0 };
                esp_read_mac(mac, ESP_MAC_WIFI_STA);
                char ssid[33];
                snprintf(ssid, sizeof(ssid), "PulseLink-%02X%02X", mac[4], mac[5]);
                if (!commissioning_transport_start_softap(&s_commissioning_transport, ssid)) {
                    commissioning_fail(&s_commissioning);
                    break;
                }
            }
        }
        if (commissioning_expire_if_needed(&s_commissioning, now)) {
            commissioning_transport_stop(&s_commissioning_transport);
            break;
        }
        vTaskDelay(pdMS_TO_TICKS(10));
    }
    vTaskDelete(NULL);
}
#endif

static void set_led(bool on) {
    if (CONFIG_PULSELINK_STATUS_LED_GPIO >= 0) gpio_set_level(CONFIG_PULSELINK_STATUS_LED_GPIO, on ? 1 : 0);
}

static void set_led_error(void) {
    if (CONFIG_PULSELINK_STATUS_LED_GPIO >= 0) {
        gpio_set_level(CONFIG_PULSELINK_STATUS_LED_GPIO, 1);
        vTaskDelay(pdMS_TO_TICKS(100));
        gpio_set_level(CONFIG_PULSELINK_STATUS_LED_GPIO, 0);
    }
}

static esp_err_t queue_save_locked(void) {
    nvs_handle_t handle;
    esp_err_t err = nvs_open("events", NVS_READWRITE, &handle);
    if (err != ESP_OK) return err;
    s_event_queue.version = 1U;
    err = nvs_set_blob(handle, EVENT_QUEUE_KEY, &s_event_queue, sizeof(s_event_queue));
    if (err == ESP_OK) err = nvs_commit(handle);
    nvs_close(handle);
    return err;
}

static esp_err_t queue_load(void) {
    nvs_handle_t handle;
    esp_err_t err = nvs_open("events", NVS_READWRITE, &handle);
    if (err != ESP_OK) return err;
    size_t size = sizeof(s_event_queue);
    err = nvs_get_blob(handle, EVENT_QUEUE_KEY, &s_event_queue, &size);
    if (err == ESP_ERR_NVS_NOT_FOUND) {
        memset(&s_event_queue, 0, sizeof(s_event_queue));
        s_event_queue.version = 1U;
        err = nvs_set_blob(handle, EVENT_QUEUE_KEY, &s_event_queue, sizeof(s_event_queue));
        if (err == ESP_OK) err = nvs_commit(handle);
    } else if (err == ESP_OK && (size != sizeof(s_event_queue) || s_event_queue.version != 1U)) {
        ESP_LOGE(TAG, "event queue format unsupported; preserving NVS contents");
        err = ESP_ERR_INVALID_STATE;
    }
    nvs_close(handle);
    return err;
}

static int queue_find_pending_locked(void) {
    for (size_t i = 0; i < EVENT_QUEUE_MAX; i++) {
        if (s_event_queue.events[i].state == EVENT_SLOT_PENDING) return (int)i;
    }
    return -1;
}

static bool create_event_id(char output[EVENT_ID_LENGTH]) {
    uint8_t bytes[16];
    esp_fill_random(bytes, sizeof(bytes));
    bytes[6] = (uint8_t)((bytes[6] & 0x0fU) | 0x40U);
    bytes[8] = (uint8_t)((bytes[8] & 0x3fU) | 0x80U);
    return snprintf(output, EVENT_ID_LENGTH,
                    "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
                    bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
                    bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15])
           == (int)(EVENT_ID_LENGTH - 1U);
}

static bool utc_timestamp(char output[32], int64_t *epoch) {
    time_t now = time(NULL);
    struct tm utc;
    if (gmtime_r(&now, &utc) == NULL) return false;
    if (strftime(output, 32, "%Y-%m-%dT%H:%M:%S.000Z", &utc) == 0) return false;
    *epoch = (int64_t)now;
    return true;
}

static void current_rssi(int *rssi_dbm) {
    wifi_ap_record_t ap_info;
    *rssi_dbm = 0;
    if (esp_wifi_sta_get_ap_info(&ap_info) == ESP_OK) *rssi_dbm = ap_info.rssi;
}

static bool enqueue_button_event(void) {
    if (xSemaphoreTake(s_queue_mutex, pdMS_TO_TICKS(100)) != pdTRUE) return false;
    int slot = -1;
    for (size_t i = 0; i < EVENT_QUEUE_MAX; i++) {
        if (s_event_queue.events[i].state == EVENT_SLOT_EMPTY) { slot = (int)i; break; }
    }
    if (slot < 0) {
        xSemaphoreGive(s_queue_mutex);
        ESP_LOGW(TAG, "event queue full; retaining existing events");
        set_led_error();
        return false;
    }
    queued_event_t event = { 0 };
    char timestamp[32];
    event.state = EVENT_SLOT_PENDING;
    if (!create_event_id(event.event_id) || !utc_timestamp(timestamp, &event.occurred_at)) {
        xSemaphoreGive(s_queue_mutex);
        ESP_LOGW(TAG, "cannot create event timestamp; event not queued");
        return false;
    }
    current_rssi(&event.rssi_dbm);
    strlcpy(event.payload, "{\"button\":\"main\"}", sizeof(event.payload));
    s_event_queue.events[slot] = event;
    esp_err_t err = queue_save_locked();
    xSemaphoreGive(s_queue_mutex);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "event queue save failed: %s", esp_err_to_name(err));
        return false;
    }
    ESP_LOGI(TAG, "button event queued slot=%d", slot);
    if (s_sender_task != NULL) xTaskNotifyGive(s_sender_task);
    return true;
}

static esp_err_t response_handler(esp_http_client_event_t *event) {
    if (event == NULL || event->user_data == NULL || event->event_id != HTTP_EVENT_ON_DATA || event->data == NULL) return ESP_OK;
    http_response_t *response = (http_response_t *)event->user_data;
    size_t incoming = event->data_len > 0 ? (size_t)event->data_len : 0U;
    size_t available = HTTP_RESPONSE_LIMIT - response->length;
    size_t copied = incoming < available ? incoming : available;
    if (copied > 0U) {
        memcpy(response->body + response->length, event->data, copied);
        response->length += copied;
        response->body[response->length] = '\0';
    }
    return ESP_OK;
}

static void http_smoke_task(void *arg) {
    (void)arg;
    while (true) {
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
        if (strlen(CONFIG_PULSELINK_BACKEND_URL) == 0U) continue;
        http_response_t response = { 0 };
        esp_http_client_config_t config = {
            .url = CONFIG_PULSELINK_BACKEND_URL,
            .method = HTTP_METHOD_GET,
            .timeout_ms = HTTP_TIMEOUT_MS,
            .buffer_size = 512,
            .buffer_size_tx = 512,
            .event_handler = response_handler,
            .user_data = &response,
            .keep_alive_enable = false,
        };
        esp_http_client_handle_t client = esp_http_client_init(&config);
        if (client == NULL) {
            ESP_LOGW(TAG, "HTTP smoke client initialization failed");
            continue;
        }
        esp_err_t err = esp_http_client_perform(client);
        if (err == ESP_OK) {
            ESP_LOGI(TAG, "HTTP smoke status=%d body_bytes=%u", esp_http_client_get_status_code(client), (unsigned)response.length);
        } else {
            ESP_LOGW(TAG, "HTTP smoke request failed: %s", esp_err_to_name(err));
        }
        esp_http_client_cleanup(client);
    }
}

static bool build_event_body(const queued_event_t *event, char **body) {
    cJSON *root = cJSON_CreateObject();
    if (root == NULL) return false;
    char occurred_at[32];
    time_t timestamp = (time_t)event->occurred_at;
    struct tm utc;
    if (gmtime_r(&timestamp, &utc) == NULL || strftime(occurred_at, sizeof(occurred_at), "%Y-%m-%dT%H:%M:%S.000Z", &utc) == 0) {
        cJSON_Delete(root);
        return false;
    }
    cJSON_AddStringToObject(root, "eventId", event->event_id);
    cJSON_AddStringToObject(root, "type", "BUTTON_PRESSED");
    cJSON_AddStringToObject(root, "occurredAt", occurred_at);
    cJSON_AddStringToObject(root, "firmwareVersion", CONFIG_PULSELINK_FIRMWARE_VERSION);
    cJSON_AddNumberToObject(root, "rssiDbm", event->rssi_dbm);
    cJSON *payload = cJSON_Parse(event->payload);
    if (payload == NULL || !cJSON_IsObject(payload)) {
        cJSON_Delete(payload);
        cJSON_Delete(root);
        return false;
    }
    cJSON_AddItemToObject(root, "payload", payload);
    *body = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    return *body != NULL;
}

static esp_err_t send_event(const queued_event_t *event, int *status_code) {
    char redeemed_token[256] = { 0 };
    const char *device_token = CONFIG_PULSELINK_DEVICE_TOKEN;
#if CONFIG_PULSELINK_COMMISSIONING_ENABLED
    size_t redeemed_length = 0U;
    if (commissioning_event_gate_load_token(&s_commissioning, &s_credential_storage,
            (uint8_t *)redeemed_token, sizeof(redeemed_token), &redeemed_length) != COMMISSIONING_EVENT_GATE_OK ||
        redeemed_length == 0U) {
        clear_sensitive(redeemed_token, sizeof(redeemed_token));
        return ESP_ERR_INVALID_STATE;
    }
    redeemed_token[redeemed_length < sizeof(redeemed_token) ? redeemed_length : sizeof(redeemed_token) - 1U] = '\0';
    device_token = redeemed_token;
#endif
    if (strlen(CONFIG_PULSELINK_EVENT_ENDPOINT_URL) == 0U || strlen(device_token) == 0U) {
        clear_sensitive(redeemed_token, sizeof(redeemed_token));
        return ESP_ERR_INVALID_STATE;
    }
    if (strncmp(CONFIG_PULSELINK_EVENT_ENDPOINT_URL, "https://", 8) != 0) {
        ESP_LOGE(TAG, "event endpoint must use HTTPS");
        clear_sensitive(redeemed_token, sizeof(redeemed_token));
        return ESP_ERR_INVALID_ARG;
    }
    char *body = NULL;
    if (!build_event_body(event, &body)) {
        clear_sensitive(redeemed_token, sizeof(redeemed_token));
        return ESP_ERR_NO_MEM;
    }
    http_response_t response = { 0 };
    esp_http_client_config_t config = {
        .url = CONFIG_PULSELINK_EVENT_ENDPOINT_URL,
        .method = HTTP_METHOD_POST,
        .timeout_ms = HTTP_TIMEOUT_MS,
        .buffer_size = 512,
        .buffer_size_tx = 512,
        .event_handler = response_handler,
        .user_data = &response,
        .crt_bundle_attach = esp_crt_bundle_attach,
        .keep_alive_enable = false,
    };
    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (client == NULL) {
        cJSON_free(body);
        clear_sensitive(redeemed_token, sizeof(redeemed_token));
        return ESP_ERR_NO_MEM;
    }
    char authorization[256];
    int auth_length = snprintf(authorization, sizeof(authorization), "Bearer %s", device_token);
    esp_err_t err = ESP_ERR_INVALID_SIZE;
    if (auth_length > 0 && (size_t)auth_length < sizeof(authorization)) {
        esp_http_client_set_header(client, "Authorization", authorization);
        esp_http_client_set_header(client, "Content-Type", "application/json");
        esp_http_client_set_post_field(client, body, (int)strlen(body));
        err = esp_http_client_perform(client);
        *status_code = esp_http_client_get_status_code(client);
    }
    esp_http_client_cleanup(client);
    cJSON_free(body);
    clear_sensitive(redeemed_token, sizeof(redeemed_token));
    return err;
}

static bool mark_event_sent(int slot) {
    if (xSemaphoreTake(s_queue_mutex, pdMS_TO_TICKS(100)) != pdTRUE) return false;
    queued_event_t previous = s_event_queue.events[slot];
    memset(&s_event_queue.events[slot], 0, sizeof(s_event_queue.events[slot]));
    esp_err_t err = queue_save_locked();
    if (err != ESP_OK) s_event_queue.events[slot] = previous;
    xSemaphoreGive(s_queue_mutex);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "event acknowledgement cleanup failed; event retained: %s", esp_err_to_name(err));
        return false;
    }
    return true;
}

static bool block_event(int slot) {
    if (xSemaphoreTake(s_queue_mutex, pdMS_TO_TICKS(100)) != pdTRUE) return false;
    queued_event_t previous = s_event_queue.events[slot];
    s_event_queue.events[slot].state = EVENT_SLOT_BLOCKED;
    esp_err_t err = queue_save_locked();
    if (err != ESP_OK) s_event_queue.events[slot] = previous;
    xSemaphoreGive(s_queue_mutex);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "event block state save failed; event retained as pending: %s", esp_err_to_name(err));
        return false;
    }
    return true;
}

static void event_sender_task(void *arg) {
    (void)arg;
    uint32_t backoff_ms = 1000U;
    while (true) {
        xEventGroupWaitBits(s_wifi_events, WIFI_CONNECTED_BIT, pdFALSE, pdTRUE, portMAX_DELAY);
        int slot = -1;
        queued_event_t event = { 0 };
        if (xSemaphoreTake(s_queue_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
            slot = queue_find_pending_locked();
            if (slot >= 0) event = s_event_queue.events[slot];
            xSemaphoreGive(s_queue_mutex);
        }
        if (slot < 0) { ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(1000)); continue; }
#if CONFIG_PULSELINK_COMMISSIONING_ENABLED
        if (commissioning_state(&s_commissioning) != COMMISSIONING_ONLINE) {
            vTaskDelay(pdMS_TO_TICKS(1000));
            continue;
        }
#endif
        int status_code = 0;
        esp_err_t err = send_event(&event, &status_code);
        if (err == ESP_OK && (status_code == 200 || status_code == 201)) {
            if (mark_event_sent(slot)) {
                backoff_ms = 1000U;
                set_led(true);
                continue;
            }
            vTaskDelay(pdMS_TO_TICKS(backoff_ms + (esp_random() % 500U)));
            if (backoff_ms < 30000U) backoff_ms *= 2U;
            continue;
        }
        if (err == ESP_OK && (status_code == 400 || status_code == 401 || status_code == 403 || status_code == 409)) {
            if (block_event(slot)) {
                ESP_LOGE(TAG, "event rejected status=%d slot=%d; retained as blocked", status_code, slot);
                set_led_error();
            } else {
                vTaskDelay(pdMS_TO_TICKS(backoff_ms + (esp_random() % 500U)));
                if (backoff_ms < 30000U) backoff_ms *= 2U;
            }
            continue;
        }
        ESP_LOGW(TAG, "event temporary failure status=%d err=%s; retrying", status_code, esp_err_to_name(err));
        vTaskDelay(pdMS_TO_TICKS(backoff_ms + (esp_random() % 500U)));
        if (backoff_ms < 30000U) backoff_ms *= 2U;
    }
}

static void button_task(void *arg) {
    (void)arg;
    bool last_raw = gpio_get_level(CONFIG_PULSELINK_BUTTON_GPIO) == 0;
    bool stable = last_raw;
    TickType_t changed_at = xTaskGetTickCount();
    TickType_t last_accepted_press_at = 0;
    bool has_accepted_press = false;
    while (true) {
        bool raw = gpio_get_level(CONFIG_PULSELINK_BUTTON_GPIO) == 0;
        if (raw != last_raw) { last_raw = raw; changed_at = xTaskGetTickCount(); }
        TickType_t now = xTaskGetTickCount();
        if (raw != stable && (now - changed_at) >= pdMS_TO_TICKS(BUTTON_STABLE_MS)) {
            stable = raw;
            if (stable && (!has_accepted_press || (now - last_accepted_press_at) >= pdMS_TO_TICKS(BUTTON_DEBOUNCE_MS))) {
                if (enqueue_button_event()) {
                    last_accepted_press_at = now;
                    has_accepted_press = true;
                }
            }
        }
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}

static void wifi_log_rssi(void) {
    wifi_ap_record_t ap_info;
    if (esp_wifi_sta_get_ap_info(&ap_info) == ESP_OK) ESP_LOGI(TAG, "wifi connected rssi=%d channel=%d", ap_info.rssi, ap_info.primary);
}

static void wifi_event_handler(void *arg, esp_event_base_t event_base, int32_t event_id, void *event_data) {
    (void)arg;
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        xEventGroupSetBits(s_wifi_events, WIFI_RECONNECT_BIT);
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        s_disconnect_count++;
        xEventGroupClearBits(s_wifi_events, WIFI_CONNECTED_BIT);
        xEventGroupSetBits(s_wifi_events, WIFI_RECONNECT_BIT);
#if CONFIG_PULSELINK_COMMISSIONING_ENABLED
        commissioning_wifi_controller_on_event(&s_commissioning_wifi,
            commissioning_wifi_controller_generation(&s_commissioning_wifi),
            COMMISSIONING_WIFI_EVENT_DISCONNECTED,
            (uint32_t)pdTICKS_TO_MS(xTaskGetTickCount()));
#endif
        ESP_LOGW(TAG, "wifi disconnected; reconnect attempt=%lu", (unsigned long)s_disconnect_count);
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        const ip_event_got_ip_t *event = (const ip_event_got_ip_t *)event_data;
        s_disconnect_count = 0;
        xEventGroupSetBits(s_wifi_events, WIFI_CONNECTED_BIT);
#if CONFIG_PULSELINK_COMMISSIONING_ENABLED
        commissioning_wifi_controller_on_event(&s_commissioning_wifi,
            commissioning_wifi_controller_generation(&s_commissioning_wifi),
            COMMISSIONING_WIFI_EVENT_GOT_IP,
            (uint32_t)pdTICKS_TO_MS(xTaskGetTickCount()));
        if (commissioning_state(&s_commissioning) == COMMISSIONING_WIFI_CONNECTED &&
            s_commissioning_mutex != NULL && xSemaphoreTake(s_commissioning_mutex, 0) == pdTRUE) {
            bool start_redemption = s_redemption_pending && !s_redemption_started;
            if (start_redemption) s_redemption_started = true;
            xSemaphoreGive(s_commissioning_mutex);
            if (start_redemption && xTaskCreate(commissioning_redemption_task,
                    "commissioning_redeem", 8192, NULL, 5, NULL) != pdPASS) {
                (void)commissioning_wifi_controller_fail(&s_commissioning_wifi,
                    commissioning_wifi_controller_generation(&s_commissioning_wifi));
            }
        }
#endif
        ESP_LOGI(TAG, "wifi got ip " IPSTR, IP2STR(&event->ip_info.ip));
        wifi_log_rssi();
        if (s_sender_task != NULL) xTaskNotifyGive(s_sender_task);
        if (s_http_smoke_task != NULL) xTaskNotifyGive(s_http_smoke_task);
    }
}

static void wifi_reconnect_task(void *arg) {
    (void)arg;
    uint32_t backoff_ms = 1000U;
    while (true) {
        xEventGroupWaitBits(s_wifi_events, WIFI_RECONNECT_BIT, pdTRUE, pdFALSE, portMAX_DELAY);
        if ((xEventGroupGetBits(s_wifi_events) & WIFI_CONNECTED_BIT) != 0) continue;
        vTaskDelay(pdMS_TO_TICKS(backoff_ms));
        esp_err_t err = esp_wifi_connect();
        if (err != ESP_OK && err != ESP_ERR_WIFI_CONN) ESP_LOGW(TAG, "wifi connect failed: %s", esp_err_to_name(err));
        if (backoff_ms < 30000U) backoff_ms *= 2U;
        if ((xEventGroupGetBits(s_wifi_events) & WIFI_CONNECTED_BIT) != 0) backoff_ms = 1000U;
    }
}

static esp_err_t wifi_start(void) {
    bool configured = strlen(CONFIG_PULSELINK_WIFI_SSID) > 0U;
#if CONFIG_PULSELINK_COMMISSIONING_ENABLED
    configured = false;
#endif
#if !CONFIG_PULSELINK_COMMISSIONING_ENABLED
    if (!configured) return ESP_ERR_INVALID_ARG;
#endif
    s_wifi_events = xEventGroupCreate();
    if (s_wifi_events == NULL) return ESP_ERR_NO_MEM;
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();
    wifi_init_config_t init_config = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&init_config));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_handler, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &wifi_event_handler, NULL));
    if (strlen(CONFIG_PULSELINK_BACKEND_URL) > 0U) xTaskCreate(http_smoke_task, "http_smoke", 4096, NULL, 3, &s_http_smoke_task);
    wifi_config_t wifi_config = { 0 };
    if (configured) {
        strlcpy((char *)wifi_config.sta.ssid, CONFIG_PULSELINK_WIFI_SSID, sizeof(wifi_config.sta.ssid));
        strlcpy((char *)wifi_config.sta.password, CONFIG_PULSELINK_WIFI_PASSWORD, sizeof(wifi_config.sta.password));
    }
    wifi_config.sta.scan_method = WIFI_FAST_SCAN;
    wifi_config.sta.sort_method = WIFI_CONNECT_AP_BY_SIGNAL;
    wifi_config.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    if (configured) ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());
    if (configured) xTaskCreate(wifi_reconnect_task, "wifi_reconnect", 4096, NULL, 5, NULL);
    xTaskCreate(event_sender_task, "event_sender", 8192, NULL, 4, &s_sender_task);
#if CONFIG_PULSELINK_COMMISSIONING_ENABLED
    xTaskCreate(commissioning_wifi_controller_task, "commissioning_wifi", 4096, NULL, 5, NULL);
#endif
    return ESP_OK;
}

void app_main(void) {
#if CONFIG_PULSELINK_COMMISSIONING_ENABLED
    bool commissioning_ready = false;
#endif
    esp_err_t nvs_status = nvs_flash_init();
    if (nvs_status == ESP_ERR_NVS_NO_FREE_PAGES || nvs_status == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_LOGE(TAG, "NVS requires recovery; refusing to erase NVS automatically");
        return;
    }
    ESP_ERROR_CHECK(nvs_status);
    s_queue_mutex = xSemaphoreCreateMutex();
    if (s_queue_mutex == NULL || queue_load() != ESP_OK) {
        ESP_LOGE(TAG, "persistent event queue unavailable; refusing event capture");
        return;
    }
#if CONFIG_PULSELINK_COMMISSIONING_ENABLED
    if (CONFIG_PULSELINK_COMMISSIONING_BUTTON_GPIO < 0) {
        ESP_LOGE(TAG, "commissioning disabled at runtime: button GPIO is unconfigured");
    } else if (!esp_device_identity_provider_init(&s_identity_provider, "identity") ||
               !esp_device_identity_provider_is_available()) {
        ESP_LOGE(TAG, "commissioning disabled at runtime: protected identity provider unavailable");
    } else {
        device_identity_init(&s_device_identity, esp_device_identity_provider_as_provider(&s_identity_provider));
        if (device_identity_load_or_generate(&s_device_identity, false, 1U) != DEVICE_KEY_PROVIDER_OK) {
            ESP_LOGE(TAG, "commissioning disabled at runtime: enrolled identity unavailable");
        } else {
            commissioning_init(&s_commissioning);
            s_commissioning_mutex = xSemaphoreCreateMutex();
            commissioning_wifi_ops_t wifi_ops = {
                .configure_station = commissioning_wifi_configure_station,
                .connect = commissioning_wifi_connect,
                .disconnect = commissioning_wifi_disconnect,
            };
            commissioning_backend_probe_ops_t probe_ops = { .start = commissioning_unused_probe_start };
            if (s_commissioning_mutex == NULL || !commissioning_backend_reachability_init(
                    &s_backend_reachability, &s_commissioning_wifi, &s_credential_storage,
                    &probe_ops, NULL) || !commissioning_wifi_controller_init(&s_commissioning_wifi, &s_commissioning,
                    &wifi_ops, NULL, 3U, 1000U, 8000U)) {
                ESP_LOGE(TAG, "commissioning disabled at runtime: Wi-Fi controller initialization failed");
                return;
            }
            physical_confirmation_init(&s_physical_confirmation);
            if (!commissioning_transport_init(&s_commissioning_transport, &s_commissioning, &s_device_identity, commissioning_credentials_received, NULL)) {
                ESP_LOGE(TAG, "commissioning disabled at runtime: transport initialization failed");
            } else {
                gpio_config_t commissioning_button = {
                    .pin_bit_mask = 1ULL << CONFIG_PULSELINK_COMMISSIONING_BUTTON_GPIO,
                    .mode = GPIO_MODE_INPUT,
                    .pull_up_en = GPIO_PULLUP_ENABLE,
                    .pull_down_en = GPIO_PULLDOWN_DISABLE,
                    .intr_type = GPIO_INTR_DISABLE,
                };
                ESP_ERROR_CHECK(gpio_config(&commissioning_button));
                commissioning_ready = true;
            }
        }
    }
#endif
#if CONFIG_PULSELINK_STATUS_LED_GPIO >= 0
    {
        gpio_config_t led = { .pin_bit_mask = 1ULL << CONFIG_PULSELINK_STATUS_LED_GPIO, .mode = GPIO_MODE_OUTPUT };
        ESP_ERROR_CHECK(gpio_config(&led));
        set_led(false);
    }
#endif
#if CONFIG_PULSELINK_BUTTON_GPIO >= 0
    {
        gpio_config_t button = { .pin_bit_mask = 1ULL << CONFIG_PULSELINK_BUTTON_GPIO, .mode = GPIO_MODE_INPUT, .pull_up_en = GPIO_PULLUP_ENABLE, .pull_down_en = GPIO_PULLDOWN_DISABLE, .intr_type = GPIO_INTR_DISABLE };
        ESP_ERROR_CHECK(gpio_config(&button));
        xTaskCreate(button_task, "button", 3072, NULL, 5, NULL);
    }
#else
    ESP_LOGW(TAG, "button GPIO is unconfigured; event capture is disabled");
#endif
    ESP_LOGI(TAG, "PulseLink firmware %s queue_capacity=%u", CONFIG_PULSELINK_FIRMWARE_VERSION, EVENT_QUEUE_MAX);
    if (wifi_start() != ESP_OK) {
        ESP_LOGW(TAG, "Wi-Fi is not started; queued events remain in NVS");
    }
#if CONFIG_PULSELINK_COMMISSIONING_ENABLED
    else if (commissioning_ready &&
             xTaskCreate(commissioning_gate_task, "commissioning_gate", 6144, NULL, 5, NULL) != pdPASS) {
        ESP_LOGE(TAG, "commissioning gate task could not be started");
    }
#endif
}
