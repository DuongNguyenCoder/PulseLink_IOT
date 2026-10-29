idf_component_register(
    SRCS "main.c" "physical_confirmation.c" "commissioning_state.c" "commissioning_protocol.c" "commissioning_crypto.c" "commissioning_transport.c" "commissioning_credential_storage.c" "commissioning_redeem.c" "commissioning_wifi_controller.c" "commissioning_backend_reachability.c" "commissioning_backend_reachability_http.c" "commissioning_event_gate.c" "device_identity.c" "device_provisioning_payload.c" "esp_device_identity_provider.c" "esp_device_credential_storage.c"
    INCLUDE_DIRS "."
    REQUIRES
        esp_event
        esp_http_client
        esp_http_server
        esp-tls
        esp_netif
        esp_wifi
        json
        driver
        nvs_flash
        mbedtls
)
