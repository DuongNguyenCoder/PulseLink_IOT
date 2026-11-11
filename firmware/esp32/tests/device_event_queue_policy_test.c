#include "device_event_queue_policy.h"

#include <assert.h>

int main(void) {
    uint8_t states[] = {
        DEVICE_EVENT_QUEUE_EMPTY,
        DEVICE_EVENT_QUEUE_PENDING,
        DEVICE_EVENT_QUEUE_BLOCKED,
        DEVICE_EVENT_QUEUE_BLOCKED,
    };
    device_event_queue_counts_t counts = device_event_queue_count(states, 4U);
    assert(counts.empty == 1U && counts.pending == 1U && counts.blocked == 2U);
    assert(device_event_queue_reactivate_blocked(states, 4U, false) == 0U);
    assert(states[2] == DEVICE_EVENT_QUEUE_BLOCKED && states[3] == DEVICE_EVENT_QUEUE_BLOCKED);
    assert(device_event_queue_reactivate_blocked(states, 4U, true) == 2U);
    counts = device_event_queue_count(states, 4U);
    assert(counts.empty == 1U && counts.pending == 3U && counts.blocked == 0U);
    assert(states[0] == DEVICE_EVENT_QUEUE_EMPTY && states[1] == DEVICE_EVENT_QUEUE_PENDING);
    assert(device_event_queue_reactivate_blocked(NULL, 4U, true) == 0U);
    return 0;
}
