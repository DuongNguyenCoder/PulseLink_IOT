package com.pulselink.owner;

import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** Waits for Android's validated default Internet network after releasing the device SoftAP binding. */
final class InternetNetworkWaiter {
    interface Registration { void close(); }

    interface Monitor {
        boolean hasInternet();
        Registration observe(Runnable onInternetAvailable);
    }

    private InternetNetworkWaiter() {}

    static boolean await(Monitor monitor, long timeoutMs) throws InterruptedException {
        if (monitor == null || timeoutMs < 0L) throw new IllegalArgumentException("Invalid network wait");
        if (monitor.hasInternet()) return true;
        CountDownLatch ready = new CountDownLatch(1);
        Registration registration = monitor.observe(ready::countDown);
        try {
            if (monitor.hasInternet()) return true;
            return ready.await(timeoutMs, TimeUnit.MILLISECONDS) && monitor.hasInternet();
        } finally {
            registration.close();
        }
    }

    static boolean awaitDefaultInternet(ConnectivityManager connectivity, long timeoutMs) throws InterruptedException {
        if (connectivity == null) throw new IllegalArgumentException("Connectivity service unavailable");
        return await(new Monitor() {
            @Override public boolean hasInternet() {
                Network active = connectivity.getActiveNetwork();
                NetworkCapabilities capabilities = active == null ? null : connectivity.getNetworkCapabilities(active);
                return hasValidatedInternet(capabilities);
            }

            @Override public Registration observe(Runnable onInternetAvailable) {
                ConnectivityManager.NetworkCallback callback = new ConnectivityManager.NetworkCallback() {
                    private void check(NetworkCapabilities capabilities) {
                        if (hasValidatedInternet(capabilities)) onInternetAvailable.run();
                    }

                    @Override public void onAvailable(Network network) {
                        check(connectivity.getNetworkCapabilities(network));
                    }

                    @Override public void onCapabilitiesChanged(Network network, NetworkCapabilities capabilities) {
                        check(capabilities);
                    }
                };
                connectivity.registerDefaultNetworkCallback(callback);
                return () -> connectivity.unregisterNetworkCallback(callback);
            }
        }, timeoutMs);
    }

    static boolean hasValidatedInternet(NetworkCapabilities capabilities) {
        return capabilities != null && isValidatedInternet(
                capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET),
                capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED));
    }

    static boolean isValidatedInternet(boolean hasInternet, boolean isValidated) {
        return hasInternet && isValidated;
    }
}
