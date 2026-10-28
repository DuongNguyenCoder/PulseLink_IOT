#include "physical_confirmation.h"

#include <stddef.h>

static bool elapsed(uint32_t now_ms, uint32_t start_ms, uint32_t duration_ms) {
    return (uint32_t)(now_ms - start_ms) >= duration_ms;
}

void physical_confirmation_init(physical_confirmation_t *confirmation) {
    if (confirmation == NULL) return;
    confirmation->state = PHYSICAL_CONFIRMATION_IDLE;
    confirmation->started_at_ms = 0U;
    confirmation->raw_changed_at_ms = 0U;
    confirmation->press_started_at_ms = 0U;
    confirmation->raw_pressed = false;
    confirmation->stable_pressed = false;
    confirmation->press_in_progress = false;
    confirmation->consumed = false;
}

bool physical_confirmation_start(physical_confirmation_t *confirmation, uint32_t now_ms) {
    if (confirmation == NULL || confirmation->state != PHYSICAL_CONFIRMATION_IDLE) return false;
    confirmation->state = PHYSICAL_CONFIRMATION_WAITING;
    confirmation->started_at_ms = now_ms;
    confirmation->raw_changed_at_ms = now_ms;
    confirmation->press_started_at_ms = 0U;
    confirmation->raw_pressed = false;
    confirmation->stable_pressed = false;
    confirmation->press_in_progress = false;
    confirmation->consumed = false;
    return true;
}

void physical_confirmation_cancel(physical_confirmation_t *confirmation) {
    if (confirmation == NULL) return;
    if (confirmation->state == PHYSICAL_CONFIRMATION_WAITING) {
        confirmation->state = PHYSICAL_CONFIRMATION_CANCELLED;
    }
}

void physical_confirmation_sample(
    physical_confirmation_t *confirmation,
    bool pressed,
    uint32_t now_ms
) {
    if (confirmation == NULL || confirmation->state != PHYSICAL_CONFIRMATION_WAITING) return;
    if (elapsed(now_ms, confirmation->started_at_ms, PHYSICAL_CONFIRMATION_WINDOW_MS)) {
        confirmation->state = PHYSICAL_CONFIRMATION_EXPIRED;
        return;
    }

    if (pressed != confirmation->raw_pressed) {
        confirmation->raw_pressed = pressed;
        confirmation->raw_changed_at_ms = now_ms;
    }
    if (confirmation->raw_pressed == confirmation->stable_pressed ||
        !elapsed(now_ms, confirmation->raw_changed_at_ms, PHYSICAL_CONFIRMATION_DEBOUNCE_MS)) {
        return;
    }

    confirmation->stable_pressed = confirmation->raw_pressed;
    if (confirmation->stable_pressed) {
        confirmation->press_started_at_ms = now_ms;
        confirmation->press_in_progress = true;
        return;
    }

    if (confirmation->press_in_progress &&
        elapsed(now_ms, confirmation->press_started_at_ms, PHYSICAL_CONFIRMATION_LONG_PRESS_MS)) {
        confirmation->state = PHYSICAL_CONFIRMATION_ACCEPTED;
        confirmation->consumed = true;
    }
    confirmation->press_in_progress = false;
}

void physical_confirmation_sample_level(
    physical_confirmation_t *confirmation,
    int level,
    uint32_t now_ms
) {
    // The verified wiring is button-to-GND; the adapter therefore treats low as pressed.
    physical_confirmation_sample(confirmation, level == 0, now_ms);
}

physical_confirmation_state_t physical_confirmation_state(
    const physical_confirmation_t *confirmation
) {
    return confirmation == NULL ? PHYSICAL_CONFIRMATION_CANCELLED : confirmation->state;
}

bool physical_confirmation_is_consumed(const physical_confirmation_t *confirmation) {
    return confirmation != NULL && confirmation->consumed;
}
