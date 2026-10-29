#include "commissioning_backend_reachability.h"

#include <assert.h>
#include <string.h>

typedef struct { uint8_t credential[256]; size_t length; int starts; int cancels; bool start_ok; } fake_storage_t;
static commissioning_storage_result_t fake_save(void *context, const uint8_t *value, size_t length) {
    fake_storage_t *fake = context; memcpy(fake->credential, value, length); fake->length = length; return COMMISSIONING_STORAGE_OK;
}
static commissioning_storage_result_t fake_load(void *context, uint8_t *value, size_t capacity, size_t *length) {
    fake_storage_t *fake = context; if (fake->length > capacity || fake->length == 0U) return COMMISSIONING_STORAGE_INVALID;
    memcpy(value, fake->credential, fake->length); *length = fake->length; return COMMISSIONING_STORAGE_OK;
}
typedef struct { int starts; int cancels; bool start_ok; } fake_probe_t;
static bool probe_start(void *context, const uint8_t *credential, size_t length, uint32_t generation) {
    fake_probe_t *probe = context; probe->starts++; assert(length == 10U && generation != 0U);
    assert(memcmp(credential, "test-token", 10U) == 0); return probe->start_ok;
}
static void probe_cancel(void *context) { ((fake_probe_t *)context)->cancels++; }

static bool wifi_configure(void *context, const char *ssid, const char *password) { (void)context; (void)ssid; (void)password; return true; }
static bool wifi_connect(void *context) { (void)context; return true; }

int main(void) {
    commissioning_context_t lifecycle;
    commissioning_wifi_controller_t wifi;
    commissioning_credential_storage_t storage;
    fake_storage_t fake_storage = { 0 };
    fake_probe_t probe = { .start_ok = true };
    commissioning_wifi_ops_t wifi_ops = { wifi_configure, wifi_connect, NULL };
    commissioning_backend_probe_ops_t probe_ops = { probe_start, probe_cancel };
    commissioning_backend_reachability_t reachability;

    commissioning_init(&lifecycle);
    assert(commissioning_begin(&lifecycle, 0U, 10000U));
    assert(commissioning_accept_physical(&lifecycle, 1U));
    assert(commissioning_transition(&lifecycle, COMMISSIONING_RECEIVING_CONFIG));
    assert(commissioning_transition(&lifecycle, COMMISSIONING_CONNECTING_TO_WIFI));
    assert(commissioning_wifi_controller_init(&wifi, &lifecycle, &wifi_ops, NULL, 2U, 1U, 4U));
    assert(commissioning_wifi_controller_start(&wifi, "ssid", "password", 10U, 1000U));
    uint32_t generation = commissioning_wifi_controller_generation(&wifi);
    commissioning_wifi_controller_on_event(&wifi, generation, COMMISSIONING_WIFI_EVENT_GOT_IP, 20U);
    assert(commissioning_state(&lifecycle) == COMMISSIONING_WIFI_CONNECTED);
    assert(commissioning_transition(&lifecycle, COMMISSIONING_REDEEMING));
    assert(commissioning_consume_session(&lifecycle));
    assert(commissioning_transition(&lifecycle, COMMISSIONING_CREDENTIAL_PERSISTING));

    memcpy(fake_storage.credential, "test-token", 10U); fake_storage.length = 10U;
    storage.context = &fake_storage; storage.save = fake_save; storage.load = fake_load;
    commissioning_backend_probe_ops_t unavailable_ops = { 0 };
    assert(!commissioning_backend_reachability_init(&reachability, &wifi, &storage, &unavailable_ops, NULL));
    assert(commissioning_backend_reachability_init(&reachability, &wifi, &storage, &probe_ops, &probe));
    assert(commissioning_backend_reachability_start(&reachability, generation));
    assert(probe.starts == 1 && commissioning_backend_reachability_is_pending(&reachability));
    commissioning_backend_reachability_complete(&reachability, generation + 1U, COMMISSIONING_BACKEND_PROBE_OK);
    assert(commissioning_state(&lifecycle) == COMMISSIONING_CREDENTIAL_PERSISTING);
    commissioning_backend_reachability_complete(&reachability, generation, COMMISSIONING_BACKEND_PROBE_AUTH_FAILURE);
    assert(commissioning_state(&lifecycle) == COMMISSIONING_FAILED);

    commissioning_init(&lifecycle);
    assert(commissioning_begin(&lifecycle, 0U, 10000U));
    assert(commissioning_accept_physical(&lifecycle, 1U));
    assert(commissioning_transition(&lifecycle, COMMISSIONING_RECEIVING_CONFIG));
    assert(commissioning_transition(&lifecycle, COMMISSIONING_CONNECTING_TO_WIFI));
    assert(commissioning_wifi_controller_init(&wifi, &lifecycle, &wifi_ops, NULL, 2U, 1U, 4U));
    assert(commissioning_wifi_controller_start(&wifi, "ssid", "password", 10U, 1000U));
    generation = commissioning_wifi_controller_generation(&wifi);
    commissioning_wifi_controller_on_event(&wifi, generation, COMMISSIONING_WIFI_EVENT_GOT_IP, 20U);
    assert(commissioning_transition(&lifecycle, COMMISSIONING_REDEEMING));
    assert(commissioning_consume_session(&lifecycle));
    assert(commissioning_transition(&lifecycle, COMMISSIONING_CREDENTIAL_PERSISTING));
    assert(commissioning_backend_reachability_init(&reachability, &wifi, &storage, &probe_ops, &probe));
    probe.start_ok = true;
    assert(commissioning_backend_reachability_start(&reachability, generation));
    commissioning_backend_reachability_complete(&reachability, generation, COMMISSIONING_BACKEND_PROBE_OK);
    assert(commissioning_state(&lifecycle) == COMMISSIONING_ONLINE);

    commissioning_init(&lifecycle);
    assert(commissioning_begin_backend_recovery(&lifecycle, 100U));
    assert(commissioning_wifi_controller_init(&wifi, &lifecycle, &wifi_ops, NULL, 2U, 1U, 4U));
    assert(commissioning_wifi_controller_start_backend_recovery(&wifi, 100U));
    generation = commissioning_wifi_controller_generation(&wifi);
    assert(commissioning_backend_reachability_init(&reachability, &wifi, &storage, &probe_ops, &probe));
    assert(commissioning_backend_reachability_start(&reachability, generation));
    commissioning_backend_reachability_complete(&reachability, generation, COMMISSIONING_BACKEND_PROBE_NETWORK_ERROR);
    assert(commissioning_state(&lifecycle) == COMMISSIONING_CREDENTIAL_PERSISTING);
    assert(commissioning_wifi_controller_is_active(&wifi));
    assert(commissioning_backend_reachability_start(&reachability, generation));
    commissioning_backend_reachability_complete(&reachability, generation, COMMISSIONING_BACKEND_PROBE_OK);
    assert(commissioning_state(&lifecycle) == COMMISSIONING_ONLINE);

    commissioning_init(&lifecycle);
    assert(commissioning_begin_backend_recovery(&lifecycle, 100U));
    assert(commissioning_wifi_controller_init(&wifi, &lifecycle, &wifi_ops, NULL, 2U, 1U, 4U));
    assert(commissioning_wifi_controller_start_backend_recovery(&wifi, 100U));
    generation = commissioning_wifi_controller_generation(&wifi);
    assert(commissioning_backend_reachability_init(&reachability, &wifi, &storage, &probe_ops, &probe));
    assert(commissioning_backend_reachability_start(&reachability, generation));
    commissioning_backend_reachability_complete(&reachability, generation, COMMISSIONING_BACKEND_PROBE_NETWORK_ERROR);
    assert(commissioning_state(&lifecycle) == COMMISSIONING_CREDENTIAL_PERSISTING);
    assert(commissioning_wifi_controller_is_active(&wifi));
    assert(commissioning_backend_reachability_start(&reachability, generation));
    commissioning_backend_reachability_complete(&reachability, generation, COMMISSIONING_BACKEND_PROBE_OK);
    assert(commissioning_state(&lifecycle) == COMMISSIONING_ONLINE);

    commissioning_init(&lifecycle);
    assert(commissioning_begin_backend_recovery(&lifecycle, 100U));
    assert(commissioning_wifi_controller_init(&wifi, &lifecycle, &wifi_ops, NULL, 2U, 1U, 4U));
    assert(commissioning_wifi_controller_start_backend_recovery(&wifi, 100U));
    generation = commissioning_wifi_controller_generation(&wifi);
    assert(commissioning_backend_reachability_init(&reachability, &wifi, &storage, &probe_ops, &probe));
    assert(commissioning_backend_reachability_start(&reachability, generation));
    commissioning_backend_reachability_complete(&reachability, generation, COMMISSIONING_BACKEND_PROBE_AUTH_FAILURE);
    assert(commissioning_state(&lifecycle) == COMMISSIONING_FAILED);
    assert(!commissioning_wifi_controller_is_active(&wifi));

    return 0;
}

