idf_component_register(
    SRCS "main.c" "physical_confirmation.c" "device_identity.c" "device_provisioning_payload.c" "esp_device_identity_provider.c"
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
        mbedtls
)
