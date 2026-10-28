#pragma once

#include <stdbool.h>
#include <stdint.h>

typedef enum {
    PHYSICAL_CONFIRMATION_IDLE = 0,
    PHYSICAL_CONFIRMATION_WAITING,
    PHYSICAL_CONFIRMATION_ACCEPTED,
    PHYSICAL_CONFIRMATION_EXPIRED,
    PHYSICAL_CONFIRMATION_CANCELLED,
} physical_confirmation_state_t;

typedef struct {
    physical_confirmation_state_t state;
    uint32_t started_at_ms;
    uint32_t raw_changed_at_ms;
    uint32_t press_started_at_ms;
    bool raw_pressed;
    bool stable_pressed;
    bool press_in_progress;
    bool consumed;
} physical_confirmation_t;

enum {
    PHYSICAL_CONFIRMATION_DEBOUNCE_MS = 50U,
    PHYSICAL_CONFIRMATION_LONG_PRESS_MS = 1500U,
    PHYSICAL_CONFIRMATION_WINDOW_MS = 30000U,
};

void physical_confirmation_init(physical_confirmation_t *confirmation);
bool physical_confirmation_start(physical_confirmation_t *confirmation, uint32_t now_ms);
void physical_confirmation_cancel(physical_confirmation_t *confirmation);
void physical_confirmation_sample(
    physical_confirmation_t *confirmation,
    bool pressed,
    uint32_t now_ms
);
void physical_confirmation_sample_level(
    physical_confirmation_t *confirmation,
    int level,
    uint32_t now_ms
);
physical_confirmation_state_t physical_confirmation_state(
    const physical_confirmation_t *confirmation
);
bool physical_confirmation_is_consumed(const physical_confirmation_t *confirmation);
