#include <assert.h>
#include <stdbool.h>
#include <stdint.h>

#include "commissioning_state.h"
#include "event_button.h"
#include "physical_confirmation.h"

typedef struct {
    event_button_t event_button;
    physical_confirmation_t commissioning_button;
    unsigned event_count;
    unsigned softap_count;
    unsigned pending_events;
    commissioning_context_t lifecycle;
} input_fixture_t;

static void fixture_init(input_fixture_t *fixture, bool event_pressed, bool commissioning_pressed) {
    event_button_init(&fixture->event_button, event_pressed, 0U);
    physical_confirmation_init(&fixture->commissioning_button);
    commissioning_init(&fixture->lifecycle);
    assert(commissioning_begin(&fixture->lifecycle, 0U, COMMISSIONING_PAIRING_WINDOW_MS));
    assert(physical_confirmation_start_level(&fixture->commissioning_button, commissioning_pressed, 0U));
    fixture->event_count = 0U;
    fixture->softap_count = 0U;
    fixture->pending_events = 1U; /* Existing durable events must not be cleared by commissioning. */
}

static void sample_event(input_fixture_t *fixture, bool pressed, uint32_t now_ms) {
    if (event_button_sample(&fixture->event_button, pressed, now_ms)) {
        fixture->event_count++;
        fixture->pending_events++;
        event_button_record_enqueued(&fixture->event_button, now_ms);
    }
}

static void sample_commissioning(input_fixture_t *fixture, bool pressed, uint32_t now_ms) {
    physical_confirmation_sample(&fixture->commissioning_button, pressed, now_ms);
    if (physical_confirmation_state(&fixture->commissioning_button) == PHYSICAL_CONFIRMATION_ACCEPTED &&
        commissioning_accept_physical(&fixture->lifecycle, now_ms)) {
        fixture->softap_count++;
    }
    (void)commissioning_expire_if_needed(&fixture->lifecycle, now_ms);
}

static void test_event_short_and_long_press_enqueue_once(void) {
    event_button_t button;
    event_button_init(&button, false, 0U);
    assert(!event_button_sample(&button, true, 100U));
    assert(!event_button_sample(&button, true, 149U));
    assert(event_button_sample(&button, true, 150U));
    event_button_record_enqueued(&button, 150U);
    assert(!event_button_sample(&button, true, 2000U));
    assert(!event_button_sample(&button, false, 2100U));
}

static void test_event_debounce_and_failed_enqueue_retry_policy(void) {
    event_button_t button;
    event_button_init(&button, false, 0U);
    assert(!event_button_sample(&button, true, 0U));
    assert(event_button_sample(&button, true, 50U));
    event_button_record_enqueued(&button, 50U);
    assert(!event_button_sample(&button, false, 100U));
    assert(!event_button_sample(&button, false, 150U));
    assert(!event_button_sample(&button, true, 200U));
    assert(!event_button_sample(&button, true, 250U)); /* Debounced; this edge is consumed once. */
    assert(!event_button_sample(&button, false, 300U));
    assert(!event_button_sample(&button, false, 350U));
    assert(!event_button_sample(&button, true, 5049U));
    assert(event_button_sample(&button, true, 5099U));
}

static void test_event_button_low_at_boot_does_not_emit_until_repress(void) {
    event_button_t button;
    event_button_init(&button, true, 0U);
    assert(!event_button_sample(&button, true, 50U));
    assert(!event_button_sample(&button, false, 100U));
    assert(!event_button_sample(&button, false, 150U));
    assert(!event_button_sample(&button, true, 200U));
    assert(event_button_sample(&button, true, 250U));
}

static void test_commissioning_short_press_is_rejected(void) {
    physical_confirmation_t button;
    physical_confirmation_init(&button);
    assert(physical_confirmation_start_level(&button, false, 0U));
    physical_confirmation_sample(&button, true, 100U);
    physical_confirmation_sample(&button, true, 150U);
    physical_confirmation_sample(&button, false, 300U);
    physical_confirmation_sample(&button, false, 350U);
    assert(physical_confirmation_state(&button) == PHYSICAL_CONFIRMATION_WAITING);
}

static void test_commissioning_long_press_release_is_accepted_once(void) {
    input_fixture_t fixture;
    fixture_init(&fixture, false, false);
    sample_commissioning(&fixture, true, 100U);
    sample_commissioning(&fixture, true, 150U);
    sample_commissioning(&fixture, true, 1650U);
    sample_commissioning(&fixture, false, 1700U);
    sample_commissioning(&fixture, false, 1750U);
    sample_commissioning(&fixture, false, 1800U);
    assert(fixture.softap_count == 1U);
    assert(commissioning_state(&fixture.lifecycle) == COMMISSIONING_SOFTAP_ACTIVE);
}

static void test_commissioning_button_does_not_enqueue_event_or_clear_pending(void) {
    input_fixture_t fixture;
    fixture_init(&fixture, false, false);
    /* GPIO4 remains released while only the separate GPIO5 commissioning input changes. */
    sample_event(&fixture, false, 100U);
    sample_commissioning(&fixture, true, 100U);
    sample_event(&fixture, false, 150U);
    sample_commissioning(&fixture, true, 150U);
    sample_commissioning(&fixture, true, 1650U);
    sample_event(&fixture, false, 1700U);
    sample_commissioning(&fixture, false, 1700U);
    sample_commissioning(&fixture, false, 1750U);
    assert(fixture.event_count == 0U);
    assert(fixture.pending_events == 1U);
    assert(fixture.softap_count == 1U);
}

static void test_event_button_does_not_confirm_commissioning(void) {
    input_fixture_t fixture;
    fixture_init(&fixture, false, false);
    sample_event(&fixture, true, 10U);
    sample_event(&fixture, true, 60U);
    sample_commissioning(&fixture, false, 100U);
    assert(fixture.event_count == 1U);
    assert(fixture.softap_count == 0U);
    assert(commissioning_state(&fixture.lifecycle) == COMMISSIONING_WAITING_FOR_PHYSICAL_CONFIRMATION);
}

static void test_interleaved_buttons_remain_independent(void) {
    input_fixture_t fixture;
    fixture_init(&fixture, false, false);
    sample_event(&fixture, true, 10U);
    sample_event(&fixture, true, 60U);
    sample_commissioning(&fixture, true, 100U);
    sample_commissioning(&fixture, true, 150U);
    sample_commissioning(&fixture, true, 1650U);
    sample_event(&fixture, false, 1700U);
    sample_commissioning(&fixture, false, 1700U);
    sample_commissioning(&fixture, false, 1750U);
    assert(fixture.event_count == 1U);
    assert(fixture.softap_count == 1U);
    assert(fixture.pending_events == 2U);
}

static void test_commissioning_button_low_at_start_requires_release_then_new_hold(void) {
    physical_confirmation_t button;
    physical_confirmation_init(&button);
    assert(physical_confirmation_start_level(&button, true, 0U));
    physical_confirmation_sample(&button, true, 1000U);
    physical_confirmation_sample(&button, false, 1100U);
    physical_confirmation_sample(&button, false, 1150U);
    assert(physical_confirmation_state(&button) == PHYSICAL_CONFIRMATION_WAITING);
    physical_confirmation_sample(&button, true, 1200U);
    physical_confirmation_sample(&button, true, 1250U);
    physical_confirmation_sample(&button, false, 2800U);
    physical_confirmation_sample(&button, false, 2850U);
    assert(physical_confirmation_state(&button) == PHYSICAL_CONFIRMATION_ACCEPTED);
}

static void test_expiry_and_terminal_lifecycle_prevent_softap(void) {
    input_fixture_t fixture;
    fixture_init(&fixture, false, false);
    sample_commissioning(&fixture, true, 29900U);
    sample_commissioning(&fixture, true, 29950U);
    sample_commissioning(&fixture, false, 29970U);
    sample_commissioning(&fixture, false, 30000U);
    assert(fixture.softap_count == 0U);
    assert(physical_confirmation_state(&fixture.commissioning_button) == PHYSICAL_CONFIRMATION_EXPIRED);
    sample_commissioning(&fixture, false, COMMISSIONING_PAIRING_WINDOW_MS);
    assert(commissioning_state(&fixture.lifecycle) == COMMISSIONING_EXPIRED);

    physical_confirmation_t confirmation;
    commissioning_context_t terminal_lifecycle;
    physical_confirmation_init(&confirmation);
    commissioning_init(&terminal_lifecycle);
    assert(commissioning_begin(&terminal_lifecycle, 0U, COMMISSIONING_PAIRING_WINDOW_MS));
    assert(physical_confirmation_start(&confirmation, 0U));
    assert(commissioning_fail(&terminal_lifecycle));
    physical_confirmation_sample(&confirmation, true, 100U);
    physical_confirmation_sample(&confirmation, true, 150U);
    physical_confirmation_sample(&confirmation, false, 1700U);
    physical_confirmation_sample(&confirmation, false, 1750U);
    assert(physical_confirmation_state(&confirmation) == PHYSICAL_CONFIRMATION_ACCEPTED);
    assert(!commissioning_accept_physical(&terminal_lifecycle, 1750U));
}

static void test_gpio_assignment_validation(void) {
    assert(button_gpio_assignments_valid(4, 5, true));
    assert(!button_gpio_assignments_valid(4, 4, true));
    assert(button_gpio_assignments_valid(-1, 5, true));
    assert(!button_gpio_assignments_valid(4, -1, true));
    assert(button_gpio_assignments_valid(-1, -1, false));
    assert(!button_gpio_assignments_valid(49, 5, true));
}

int main(void) {
    test_event_short_and_long_press_enqueue_once();
    test_event_debounce_and_failed_enqueue_retry_policy();
    test_event_button_low_at_boot_does_not_emit_until_repress();
    test_commissioning_short_press_is_rejected();
    test_commissioning_long_press_release_is_accepted_once();
    test_commissioning_button_does_not_enqueue_event_or_clear_pending();
    test_event_button_does_not_confirm_commissioning();
    test_interleaved_buttons_remain_independent();
    test_commissioning_button_low_at_start_requires_release_then_new_hold();
    test_expiry_and_terminal_lifecycle_prevent_softap();
    test_gpio_assignment_validation();
    return 0;
}
