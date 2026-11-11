cmake_minimum_required(VERSION 3.16)

include($ENV{IDF_PATH}/tools/cmake/project.cmake)

file(TO_CMAKE_PATH "${SDKCONFIG}" _pulselink_sdkconfig_path)
if(NOT _pulselink_sdkconfig_path MATCHES "/build/profiles/(default|staging)/sdkconfig$")
    message(FATAL_ERROR
        "Select an isolated PulseLink profile with scripts/Build-FirmwareProfile.ps1 -Profile <default|staging>. "
        "The effective SDKCONFIG must be under build/profiles/<profile>/sdkconfig.")
endif()

project(pulselink_firmware)
