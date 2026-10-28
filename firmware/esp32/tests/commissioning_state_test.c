#include "commissioning_state.h"

#include <assert.h>
#include <stdint.h>

static void test_happy_path_and_consume_once(void) {
    commissioning_context_t context;
    commissioning_init(&context);
    assert(commissioning_begin(&context, 100U, 30000U));
    assert(commissioning_accept_physical(&context, 200U));
    assert(commissioning_transition(&context, COMMISSIONING_RECEIVING_CONFIG));
    assert(commissioning_transition(&context, COMMISSIONING_CONNECTING_TO_WIFI));
    assert(commissioning_transition(&context, COMMISSIONING_WIFI_CONNECTED));
    assert(commissioning_transition(&context, COMMISSIONING_REDEEMING));
    assert(commissioning_consume_session(&context));
    assert(!commissioning_consume_session(&context));
    assert(commissioning_transition(&context, COMMISSIONING_CREDENTIAL_PERSISTING));
    assert(commissioning_transition(&context, COMMISSIONING_ONLINE));
}

static void test_retry_path_is_bounded_by_terminal_failure(void) {
    commissioning_context_t context;
    commissioning_init(&context);
    assert(commissioning_begin(&context, 0U, 100U));
    assert(commissioning_accept_physical(&context, 1U));
    assert(commissioning_transition(&context, COMMISSIONING_RECEIVING_CONFIG));
    assert(commissioning_transition(&context, COMMISSIONING_CONNECTING_TO_WIFI));
    assert(commissioning_transition(&context, COMMISSIONING_RETRY_WAIT));
    assert(commissioning_transition(&context, COMMISSIONING_CONNECTING_TO_WIFI));
    assert(commissioning_fail(&context));
    assert(!commissioning_transition(&context, COMMISSIONING_ONLINE));
}

static void test_invalid_order_and_cancel(void) {
    commissioning_context_t context;
    commissioning_init(&context);
    assert(!commissioning_accept_physical(&context, 0U));
    assert(commissioning_begin(&context, 0U, 1000U));
    assert(!commissioning_transition(&context, COMMISSIONING_REDEEMING));
    assert(commissioning_cancel(&context));
    assert(!commissioning_accept_physical(&context, 1U));
    assert(!commissioning_begin(&context, 2U, 1000U));
}

static void test_expiry_and_wrap_safe_deadline(void) {
    commissioning_context_t context;
    commissioning_init(&context);
    assert(commissioning_begin(&context, UINT32_MAX - 50U, 100U));
    assert(!commissioning_expire_if_needed(&context, 20U));
    assert(commissioning_expire_if_needed(&context, 50U));
    assert(commissioning_state(&context) == COMMISSIONING_EXPIRED);
    assert(!commissioning_accept_physical(&context, 51U));
}

static void test_failure_is_terminal(void) {
    commissioning_context_t context;
    commissioning_init(&context);
    assert(commissioning_begin(&context, 10U, 1000U));
    assert(commissioning_fail(&context));
    assert(!commissioning_cancel(&context));
    assert(!commissioning_transition(&context, COMMISSIONING_SOFTAP_ACTIVE));
    assert(!commissioning_begin(&context, 20U, 1000U));
}

int main(void) {
    test_happy_path_and_consume_once();
    test_retry_path_is_bounded_by_terminal_failure();
    test_invalid_order_and_cancel();
    test_expiry_and_wrap_safe_deadline();
    test_failure_is_terminal();
    return 0;
}
