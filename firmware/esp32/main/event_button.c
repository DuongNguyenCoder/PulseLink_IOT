#include "event_button.h"

#include <stddef.h>

static bool elapsed(uint32_t now_ms, uint32_t start_ms, uint32_t duration_ms) {
    return (uint32_t)(now_ms - start_ms) >= duration_ms;
}

void event_button_init(event_button_t *button, bool pressed_at_start, uint32_t now_ms) {
    if (button == NULL) return;
    button->raw_pressed = pressed_at_start;
    button->stable_pressed = pressed_at_start;
    button->has_enqueued_press = false;
    button->raw_changed_at_ms = now_ms;
    button->last_enqueued_at_ms = 0U;
}

bool event_button_sample(event_button_t *button, bool pressed, uint32_t now_ms) {
    if (button == NULL) return false;
    if (pressed != button->raw_pressed) {
        button->raw_pressed = pressed;
        button->raw_changed_at_ms = now_ms;
    }
    if (button->raw_pressed == button->stable_pressed ||
        !elapsed(now_ms, button->raw_changed_at_ms, EVENT_BUTTON_STABLE_MS)) {
        return false;
    }

    button->stable_pressed = button->raw_pressed;
    if (!button->stable_pressed) return false;
    return !button->has_enqueued_press ||
        elapsed(now_ms, button->last_enqueued_at_ms, EVENT_BUTTON_DEBOUNCE_MS);
}

void event_button_record_enqueued(event_button_t *button, uint32_t now_ms) {
    if (button == NULL) return;
    button->last_enqueued_at_ms = now_ms;
    button->has_enqueued_press = true;
}

bool button_gpio_assignments_valid(int event_gpio, int commissioning_gpio, bool commissioning_enabled) {
    if (event_gpio < -1 || event_gpio > 48 || commissioning_gpio < -1 || commissioning_gpio > 48) return false;
    if (!commissioning_enabled) return true;
    if (commissioning_gpio < 0) return false;
    return event_gpio < 0 || event_gpio != commissioning_gpio;
}
