package com.pulselink.owner;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.assertEquals;

public final class CommissioningLifecycleTest {
    @Test
    public void requiresOrderedStatesAndReachesOnlineOnlyAfterRedemption() {
        CommissioningLifecycle lifecycle = new CommissioningLifecycle();
        assertTrue(lifecycle.start(1000, 30_000));
        assertFalse(lifecycle.transition(CommissioningLifecycle.State.ONLINE, 1001));
        assertTrue(lifecycle.transition(CommissioningLifecycle.State.CONNECTING_TO_DEVICE, 1001));
        assertTrue(lifecycle.transition(CommissioningLifecycle.State.AUTHENTICATING_DEVICE, 1002));
        assertTrue(lifecycle.transition(CommissioningLifecycle.State.SENDING_CONFIGURATION, 1003));
        assertTrue(lifecycle.transition(CommissioningLifecycle.State.DEVICE_CONNECTING_WIFI, 1004));
        assertTrue(lifecycle.transition(CommissioningLifecycle.State.REDEEMING, 1005));
        assertTrue(lifecycle.transition(CommissioningLifecycle.State.ONLINE, 1006));
    }

    @Test
    public void expiryCancelAndFailureAreTerminal() {
        CommissioningLifecycle expired = new CommissioningLifecycle();
        assertTrue(expired.start(0, 10));
        assertTrue(expired.expire(10));
        assertEquals(CommissioningLifecycle.State.EXPIRED, expired.state());
        assertFalse(expired.cancel());

        CommissioningLifecycle cancelled = new CommissioningLifecycle();
        assertTrue(cancelled.start(0, 100));
        assertTrue(cancelled.cancel());
        assertFalse(cancelled.fail());

        CommissioningLifecycle failed = new CommissioningLifecycle();
        assertTrue(failed.start(0, 100));
        assertTrue(failed.fail());
        assertFalse(failed.transition(CommissioningLifecycle.State.CONNECTING_TO_DEVICE, 1));
    }
}
