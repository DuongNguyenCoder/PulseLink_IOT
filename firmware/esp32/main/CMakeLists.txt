idf_component_register(
    SRCS "main.c"
    INCLUDE_DIRS "."
    REQUIRES
        esp_event
        esp_http_client
        esp-tls
        esp_netif
        esp_wifi
        json
        driver
        nvs_flash
)
