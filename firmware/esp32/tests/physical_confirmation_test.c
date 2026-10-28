#include <assert.h>
#include <stdbool.h>
#include <stdint.h>

#include "physical_confirmation.h"

static void sample(physical_confirmation_t *confirmation, bool pressed, uint32_t now_ms) {
    physical_confirmation_sample(confirmation, pressed, now_ms);
}

int main(void) {
    physical_confirmation_t confirmation;

    // Invalid call order cannot manufacture an acceptance.
    physical_confirmation_init(&confirmation);
    sample(&confirmation, true, 10U);
    assert(physical_confirmation_state(&confirmation) == PHYSICAL_CONFIRMATION_IDLE);
    assert(physical_confirmation_start(&confirmation, 0U));
    assert(!physical_confirmation_start(&confirmation, 1U));

    // A short press and a release at the debounce boundary are rejected.
    physical_confirmation_init(&confirmation);
    assert(physical_confirmation_start(&confirmation, 0U));

    sample(&confirmation, true, 10U);
    sample(&confirmation, true, 59U);
    sample(&confirmation, true, 60U);
    sample(&confirmation, false, 109U);
    sample(&confirmation, false, 159U);
    assert(physical_confirmation_state(&confirmation) == PHYSICAL_CONFIRMATION_WAITING);

    // Releasing one millisecond before the threshold is rejected permanently.
    physical_confirmation_init(&confirmation);
    assert(physical_confirmation_start(&confirmation, 0U));
    sample(&confirmation, true, 10U);
    sample(&confirmation, true, 60U);
    sample(&confirmation, false, 1509U);
    sample(&confirmation, false, 1559U);
    assert(physical_confirmation_state(&confirmation) == PHYSICAL_CONFIRMATION_WAITING);

    // A long press is accepted only after a stable release and only once.
    physical_confirmation_init(&confirmation);
    assert(physical_confirmation_start(&confirmation, 0U));
    sample(&confirmation, true, 10U);
    sample(&confirmation, true, 60U);
    sample(&confirmation, true, 1560U);
    sample(&confirmation, false, 1600U);
    sample(&confirmation, false, 1660U);
    assert(physical_confirmation_state(&confirmation) == PHYSICAL_CONFIRMATION_ACCEPTED);
    assert(physical_confirmation_is_consumed(&confirmation));
    sample(&confirmation, true, 2000U);
    assert(physical_confirmation_state(&confirmation) == PHYSICAL_CONFIRMATION_ACCEPTED);
    assert(!physical_confirmation_start(&confirmation, 2100U));

    // Expiry is inclusive at the 30-second boundary and is terminal.
    physical_confirmation_init(&confirmation);
    assert(physical_confirmation_start(&confirmation, 0U));
    sample(&confirmation, false, 30000U);
    assert(physical_confirmation_state(&confirmation) == PHYSICAL_CONFIRMATION_EXPIRED);
    assert(!physical_confirmation_start(&confirmation, 30001U));

    // Cancellation is terminal and cannot be reused.
    physical_confirmation_init(&confirmation);
    assert(physical_confirmation_start(&confirmation, 0U));
    physical_confirmation_cancel(&confirmation);
    assert(physical_confirmation_state(&confirmation) == PHYSICAL_CONFIRMATION_CANCELLED);
    assert(!physical_confirmation_start(&confirmation, 1U));

    // Unsigned elapsed arithmetic remains correct across a 32-bit clock wrap.
    physical_confirmation_init(&confirmation);
    const uint32_t start = UINT32_MAX - 95U;
    assert(physical_confirmation_start(&confirmation, start));
    sample(&confirmation, true, start + 10U);
    sample(&confirmation, true, start + 60U);
    sample(&confirmation, false, start + 1560U);
    sample(&confirmation, false, start + 1610U);
    assert(physical_confirmation_state(&confirmation) == PHYSICAL_CONFIRMATION_ACCEPTED);
    return 0;
}
