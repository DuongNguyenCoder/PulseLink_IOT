#!/bin/sh
set -eu

common="-std=c17 -Wall -Wextra -Werror -I main -I tests -I tests/nvs_shim -include tests/sdkconfig.h"
passed=0

run_test() {
    name="$1"
    shift
    # Inputs are fixed source paths below; split common compiler flags intentionally.
    # shellcheck disable=SC2086
    cc $common "$@" -o "/tmp/pulselink-$name"
    "/tmp/pulselink-$name"
    passed=$((passed + 1))
    printf 'PASS %s\n' "$name"
}

run_test physical main/physical_confirmation.c tests/physical_confirmation_test.c
run_test identity main/device_identity.c main/device_provisioning_payload.c tests/device_identity_test.c
run_test lifecycle main/commissioning_state.c tests/commissioning_state_test.c
run_test transcript main/commissioning_protocol.c tests/commissioning_protocol_test.c
# shellcheck disable=SC2086
cc $common tests/commissioning_crypto_host_test.c -lcrypto -o /tmp/pulselink-crypto
/tmp/pulselink-crypto
passed=$((passed + 1))
printf 'PASS crypto-interoperability\n'
run_test credential-storage main/commissioning_credential_storage.c tests/commissioning_credential_storage_test.c
run_test wifi-controller main/commissioning_state.c main/commissioning_wifi_controller.c tests/commissioning_wifi_controller_test.c
run_test backend-reachability main/commissioning_state.c main/commissioning_wifi_controller.c main/commissioning_credential_storage.c main/commissioning_backend_reachability.c main/commissioning_event_gate.c tests/commissioning_backend_reachability_test.c
run_test event-gate main/commissioning_state.c main/commissioning_credential_storage.c main/commissioning_event_gate.c tests/commissioning_event_gate_test.c
run_test nvs-credential-provider main/commissioning_credential_storage.c main/esp_device_credential_storage.c tests/esp_device_credential_storage_test.c

test "$passed" -eq 10
printf 'HOST_TEST_RUNNERS_PASS=%s FAIL=0 SKIP=0\n' "$passed"
