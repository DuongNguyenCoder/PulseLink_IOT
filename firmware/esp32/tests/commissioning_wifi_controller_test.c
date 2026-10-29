#include "commissioning_wifi_controller.h"

#include <assert.h>
#include <string.h>

typedef struct { int configure_calls; int connect_calls; int disconnect_calls; bool configure_ok; bool connect_ok; } fake_wifi_t;

static bool configure_station(void *context, const char *ssid, const char *password) {
    fake_wifi_t *fake = context;
    assert(strcmp(ssid, "test-ap") == 0 && strcmp(password, "test-password") == 0);
    fake->configure_calls++;
    return fake->configure_ok;
}
static bool connect_station(void *context) { fake_wifi_t *fake = context; fake->connect_calls++; return fake->connect_ok; }
static void disconnect_station(void *context) { fake_wifi_t *fake = context; fake->disconnect_calls++; }

static commissioning_wifi_controller_t make_controller(
    commissioning_context_t *lifecycle, fake_wifi_t *fake) {
    commissioning_wifi_controller_t controller;
    commissioning_wifi_ops_t ops = { configure_station, connect_station, disconnect_station };
    assert(commissioning_wifi_controller_init(&controller, lifecycle, &ops, fake, 2U, 100U, 400U));
    return controller;
}

static void ready_for_connect(commissioning_context_t *lifecycle) {
    commissioning_init(lifecycle);
    assert(commissioning_begin(lifecycle, 0U, 10000U));
    assert(commissioning_accept_physical(lifecycle, 1U));
    assert(commissioning_transition(lifecycle, COMMISSIONING_RECEIVING_CONFIG));
    assert(commissioning_transition(lifecycle, COMMISSIONING_CONNECTING_TO_WIFI));
}

static void test_success_requires_backend_online(void) {
    commissioning_context_t lifecycle;
    fake_wifi_t fake = { .configure_ok = true, .connect_ok = true };
    commissioning_wifi_controller_t controller;
    ready_for_connect(&lifecycle);
    controller = make_controller(&lifecycle, &fake);
    assert(commissioning_wifi_controller_start(&controller, "test-ap", "test-password", 10U, 1000U));
    uint32_t generation = commissioning_wifi_controller_generation(&controller);
    commissioning_wifi_controller_on_event(&controller, generation, COMMISSIONING_WIFI_EVENT_GOT_IP, 20U);
    assert(commissioning_state(&lifecycle) == COMMISSIONING_WIFI_CONNECTED);
    assert(!commissioning_wifi_controller_mark_backend_online(&controller, generation + 1U));
    assert(commissioning_transition(&lifecycle, COMMISSIONING_REDEEMING));
    assert(commissioning_consume_session(&lifecycle));
    assert(commissioning_transition(&lifecycle, COMMISSIONING_CREDENTIAL_PERSISTING));
    assert(commissioning_wifi_controller_mark_backend_online(&controller, generation));
    assert(commissioning_state(&lifecycle) == COMMISSIONING_ONLINE);
    assert(!commissioning_wifi_controller_is_active(&controller));
}

static void test_stale_event_and_retry_exhaustion(void) {
    commissioning_context_t lifecycle;
    fake_wifi_t fake = { .configure_ok = true, .connect_ok = false };
    commissioning_wifi_controller_t controller;
    ready_for_connect(&lifecycle);
    controller = make_controller(&lifecycle, &fake);
    assert(commissioning_wifi_controller_start(&controller, "test-ap", "test-password", 10U, 1000U));
    uint32_t generation = commissioning_wifi_controller_generation(&controller);
    assert(commissioning_state(&lifecycle) == COMMISSIONING_RETRY_WAIT);
    commissioning_wifi_controller_on_event(&controller, generation - 1U, COMMISSIONING_WIFI_EVENT_GOT_IP, 20U);
    assert(commissioning_state(&lifecycle) == COMMISSIONING_RETRY_WAIT);
    commissioning_wifi_controller_tick(&controller, 110U);
    commissioning_wifi_controller_tick(&controller, 310U);
    commissioning_wifi_controller_tick(&controller, 710U);
    assert(commissioning_state(&lifecycle) == COMMISSIONING_FAILED);
    assert(!commissioning_wifi_controller_is_active(&controller));
}

static void test_cancel_cleans_up(void) {
    commissioning_context_t lifecycle;
    fake_wifi_t fake = { .configure_ok = true, .connect_ok = true };
    commissioning_wifi_controller_t controller;
    ready_for_connect(&lifecycle);
    controller = make_controller(&lifecycle, &fake);
    assert(commissioning_wifi_controller_start(&controller, "test-ap", "test-password", 10U, 1000U));
    assert(commissioning_wifi_controller_cancel(&controller));
    assert(commissioning_state(&lifecycle) == COMMISSIONING_CANCELLED);
    assert(fake.disconnect_calls == 1);
}

static void test_backend_recovery_survives_wifi_disconnect_but_not_stale_success(void) {
    commissioning_context_t lifecycle;
    fake_wifi_t fake = { .configure_ok = true, .connect_ok = true };
    commissioning_wifi_controller_t controller;
    commissioning_init(&lifecycle);
    assert(commissioning_begin_backend_recovery(&lifecycle, 100U));
    controller = make_controller(&lifecycle, &fake);
    assert(commissioning_wifi_controller_start_backend_recovery(&controller, 100U));
    uint32_t generation = commissioning_wifi_controller_generation(&controller);
    assert(commissioning_wifi_controller_is_backend_recovery(&controller));
    commissioning_wifi_controller_on_event(&controller, generation,
        COMMISSIONING_WIFI_EVENT_DISCONNECTED, 200U);
    assert(commissioning_state(&lifecycle) == COMMISSIONING_CREDENTIAL_PERSISTING);
    assert(commissioning_wifi_controller_is_active(&controller));
    assert(!commissioning_wifi_controller_mark_backend_online(&controller, generation + 1U));
    assert(commissioning_wifi_controller_mark_backend_online(&controller, generation));
    assert(commissioning_state(&lifecycle) == COMMISSIONING_ONLINE);
}

int main(void) {
    test_success_requires_backend_online();
    test_stale_event_and_retry_exhaustion();
    test_cancel_cleans_up();
    test_backend_recovery_survives_wifi_disconnect_but_not_stale_success();
    return 0;
}

