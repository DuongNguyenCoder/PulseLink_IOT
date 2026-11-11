idf_component_register(
    SRCS "device_event_queue_policy.c" "commissioning_status_policy.c" "main.c" "physical_confirmation.c" "event_button.c" "commissioning_state.c" "commissioning_wifi_mode_policy.c" "commissioning_startup_policy.c" "commissioning_http_response_policy.c" "device_event_http_policy.c" "commissioning_protocol.c" "commissioning_crypto.c" "commissioning_transport.c" "commissioning_credential_storage.c" "commissioning_redeem.c" "commissioning_wifi_controller.c" "commissioning_backend_reachability.c" "commissioning_backend_reachability_http.c" "commissioning_event_gate.c" "device_identity.c" "device_provisioning_payload.c" "esp_device_identity_provider.c" "esp_device_credential_storage.c"
    INCLUDE_DIRS "."
    REQUIRES
        esp_event
        esp_http_client
        esp_http_server
        esp_timer
        esp-tls
        esp_netif
        esp_wifi
        json
        driver
        nvs_flash
        mbedtls
)

# Embed a profile label and a fingerprint of selected non-secret configuration
# fields. Never hash the full sdkconfig: local files may contain credentials.
set(_pulselink_sdkconfig "${SDKCONFIG}")
if(NOT IS_ABSOLUTE "${_pulselink_sdkconfig}")
    get_filename_component(_pulselink_sdkconfig "${_pulselink_sdkconfig}" ABSOLUTE BASE_DIR "${CMAKE_SOURCE_DIR}")
endif()
if(NOT EXISTS "${_pulselink_sdkconfig}")
    set(_pulselink_sdkconfig "${CMAKE_SOURCE_DIR}/sdkconfig")
endif()
if(NOT EXISTS "${_pulselink_sdkconfig}")
    message(FATAL_ERROR "PulseLink build identity cannot read the effective sdkconfig")
endif()

file(STRINGS "${_pulselink_sdkconfig}" _pulselink_identity_config
    REGEX "^(CONFIG_IDF_TARGET|CONFIG_ESPTOOLPY_FLASHSIZE|CONFIG_PARTITION_TABLE_FILENAME|CONFIG_PULSELINK_FIRMWARE_VERSION|CONFIG_PULSELINK_BUILD_PROFILE|CONFIG_PULSELINK_BUTTON_GPIO|CONFIG_PULSELINK_COMMISSIONING_BUTTON_GPIO|CONFIG_PULSELINK_COMMISSIONING_ENABLED|CONFIG_PULSELINK_DEVICE_IDENTITY_NVS_PROVIDER|CONFIG_PULSELINK_OPERATIONAL_CREDENTIAL_STORAGE|CONFIG_NVS_ENCRYPTION|CONFIG_COMPILER_OPTIMIZATION_SIZE)=|^# CONFIG_(PULSELINK_COMMISSIONING_ENABLED|PULSELINK_DEVICE_IDENTITY_NVS_PROVIDER|PULSELINK_OPERATIONAL_CREDENTIAL_STORAGE|NVS_ENCRYPTION) is not set$")
string(JOIN "\n" _pulselink_identity_payload ${_pulselink_identity_config})
string(SHA256 _pulselink_config_fingerprint "${_pulselink_identity_payload}")
if(CONFIG_PULSELINK_BUILD_PROFILE)
    set(_pulselink_build_profile "${CONFIG_PULSELINK_BUILD_PROFILE}")
else()
    set(_pulselink_build_profile "unknown")
endif()

target_compile_definitions(${COMPONENT_LIB} PRIVATE
    PULSELINK_BUILD_PROFILE=\"${_pulselink_build_profile}\"
    PULSELINK_BUILD_CONFIG_FINGERPRINT=\"${_pulselink_config_fingerprint}\"
)
