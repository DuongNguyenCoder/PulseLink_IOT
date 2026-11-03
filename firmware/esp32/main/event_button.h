#pragma once

#include <stdbool.h>
#include <stdint.h>

typedef struct {
    bool raw_pressed;
    bool stable_pressed;
    bool has_enqueued_press;
    uint32_t raw_changed_at_ms;
    uint32_t last_enqueued_at_ms;
} event_button_t;

enum {
    EVENT_BUTTON_STABLE_MS = 50U,
    EVENT_BUTTON_DEBOUNCE_MS = 5000U,
};

/* A button held at initialization is treated as already pressed, never as a new edge. */
void event_button_init(event_button_t *button, bool pressed_at_start, uint32_t now_ms);
/* Returns true once for a debounced press; the caller records success after durable enqueue. */
bool event_button_sample(event_button_t *button, bool pressed, uint32_t now_ms);
void event_button_record_enqueued(event_button_t *button, uint32_t now_ms);
bool button_gpio_assignments_valid(int event_gpio, int commissioning_gpio, bool commissioning_enabled);
