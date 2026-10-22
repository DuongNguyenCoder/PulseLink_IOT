#include <stdbool.h>
#include <stdio.h>
#include <string.h>
#include <time.h>

#include "cJSON.h"
#include "driver/gpio.h"
#include "esp_crt_bundle.h"
#include "esp_event.h"
#include "esp_http_client.h"
#include "esp_log.h"
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
    if (strlen(CONFIG_PULSELINK_EVENT_ENDPOINT_URL) == 0U || strlen(CONFIG_PULSELINK_DEVICE_TOKEN) == 0U) return ESP_ERR_INVALID_STATE;
    if (strncmp(CONFIG_PULSELINK_EVENT_ENDPOINT_URL, "https://", 8) != 0) {
        ESP_LOGE(TAG, "event endpoint must use HTTPS");
        return ESP_ERR_INVALID_ARG;
    }
    char *body = NULL;
    if (!build_event_body(event, &body)) return ESP_ERR_NO_MEM;
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
    if (client == NULL) { cJSON_free(body); return ESP_ERR_NO_MEM; }
    char authorization[256];
    int auth_length = snprintf(authorization, sizeof(authorization), "Bearer %s", CONFIG_PULSELINK_DEVICE_TOKEN);
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
        ESP_LOGW(TAG, "wifi disconnected; reconnect attempt=%lu", (unsigned long)s_disconnect_count);
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        const ip_event_got_ip_t *event = (const ip_event_got_ip_t *)event_data;
        s_disconnect_count = 0;
        xEventGroupSetBits(s_wifi_events, WIFI_CONNECTED_BIT);
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
    if (strlen(CONFIG_PULSELINK_WIFI_SSID) == 0U) return ESP_ERR_INVALID_ARG;
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
    strlcpy((char *)wifi_config.sta.ssid, CONFIG_PULSELINK_WIFI_SSID, sizeof(wifi_config.sta.ssid));
    strlcpy((char *)wifi_config.sta.password, CONFIG_PULSELINK_WIFI_PASSWORD, sizeof(wifi_config.sta.password));
    wifi_config.sta.scan_method = WIFI_FAST_SCAN;
    wifi_config.sta.sort_method = WIFI_CONNECT_AP_BY_SIGNAL;
    wifi_config.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());
    xTaskCreate(wifi_reconnect_task, "wifi_reconnect", 4096, NULL, 5, NULL);
    xTaskCreate(event_sender_task, "event_sender", 8192, NULL, 4, &s_sender_task);
    return ESP_OK;
}

void app_main(void) {
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
    if (wifi_start() != ESP_OK) ESP_LOGW(TAG, "Wi-Fi is not started; queued events remain in NVS");
}
