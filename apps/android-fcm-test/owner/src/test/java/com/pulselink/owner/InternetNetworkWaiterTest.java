package com.pulselink.owner;

import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public final class InternetNetworkWaiterTest {
    @Test public void returnsImmediatelyWhenDefaultInternetIsReady() throws Exception {
        AtomicBoolean internet = new AtomicBoolean(true);
        assertTrue(InternetNetworkWaiter.await(monitor(internet, false), 0L));
    }

    @Test public void waitsForNetworkCallbackAfterSoftApRelease() throws Exception {
        AtomicBoolean internet = new AtomicBoolean(false);
        assertTrue(InternetNetworkWaiter.await(monitorSignalWithoutPrecheck(internet), 100L));
    }

    @Test public void failsWithinBoundWhenInternetDoesNotReturn() throws Exception {
        AtomicBoolean internet = new AtomicBoolean(false);
        assertFalse(InternetNetworkWaiter.await(monitor(internet, false), 0L));
    }

    @Test public void requiresValidatedInternetAndNotJustAnInternetCapability() {
        assertFalse(InternetNetworkWaiter.isValidatedInternet(true, false));
        assertFalse(InternetNetworkWaiter.isValidatedInternet(false, true));
        assertTrue(InternetNetworkWaiter.isValidatedInternet(true, true));
    }

    private static InternetNetworkWaiter.Monitor monitor(AtomicBoolean internet, boolean signalOnObserve) {
        return new InternetNetworkWaiter.Monitor() {
            @Override public boolean hasInternet() { return internet.get(); }

            @Override public InternetNetworkWaiter.Registration observe(Runnable callback) {
                if (signalOnObserve) {
                    internet.set(true);
                    callback.run();
                }
                return () -> {};
            }
        };
    }

    private static InternetNetworkWaiter.Monitor monitorSignalWithoutPrecheck(AtomicBoolean internet) {
        java.util.concurrent.atomic.AtomicInteger checks = new java.util.concurrent.atomic.AtomicInteger();
        return new InternetNetworkWaiter.Monitor() {
            @Override public boolean hasInternet() { return checks.incrementAndGet() >= 3 && internet.get(); }

            @Override public InternetNetworkWaiter.Registration observe(Runnable callback) {
                internet.set(true);
                callback.run();
                return () -> {};
            }
        };
    }
}
