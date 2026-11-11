#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef enum {
    DEVICE_EVENT_QUEUE_EMPTY = 0,
    DEVICE_EVENT_QUEUE_PENDING = 1,
    DEVICE_EVENT_QUEUE_BLOCKED = 2,
} device_event_queue_slot_state_t;

typedef struct {
    size_t empty;
    size_t pending;
    size_t blocked;
} device_event_queue_counts_t;

device_event_queue_counts_t device_event_queue_count(const uint8_t *states, size_t capacity);
size_t device_event_queue_reactivate_blocked(uint8_t *states, size_t capacity, bool backend_authenticated);
