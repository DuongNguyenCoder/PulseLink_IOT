#include "device_event_queue_policy.h"

device_event_queue_counts_t device_event_queue_count(const uint8_t *states, size_t capacity) {
    device_event_queue_counts_t counts = { 0 };
    if (states == NULL) return counts;
    for (size_t index = 0; index < capacity; index++) {
        if (states[index] == DEVICE_EVENT_QUEUE_EMPTY) counts.empty++;
        else if (states[index] == DEVICE_EVENT_QUEUE_PENDING) counts.pending++;
        else if (states[index] == DEVICE_EVENT_QUEUE_BLOCKED) counts.blocked++;
    }
    return counts;
}

size_t device_event_queue_reactivate_blocked(uint8_t *states, size_t capacity, bool backend_authenticated) {
    if (states == NULL || !backend_authenticated) return 0U;
    size_t reactivated = 0U;
    for (size_t index = 0; index < capacity; index++) {
        if (states[index] == DEVICE_EVENT_QUEUE_BLOCKED) {
            states[index] = DEVICE_EVENT_QUEUE_PENDING;
            reactivated++;
        }
    }
    return reactivated;
}
