package com.pulselink.owner;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.wifi.WifiNetworkSpecifier;
import android.os.Build;

/** Android 10+ local SoftAP handoff. The network is not treated as trusted. */
final class SoftApConnection implements AutoCloseable {
    interface Listener {
        void onAvailable(Network network);
        void onUnavailable();
        void onLost();
    }

    private final ConnectivityManager connectivity;
    private ConnectivityManager.NetworkCallback callback;

    SoftApConnection(Context context) {
        connectivity = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (connectivity == null) throw new IllegalStateException("Connectivity service unavailable");
    }

    void connect(String ssid, Listener listener) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) throw new UnsupportedOperationException("Android 10 or newer required");
        if (ssid == null || ssid.isEmpty() || listener == null) throw new IllegalArgumentException("SoftAP SSID required");
        close();
        WifiNetworkSpecifier specifier = new WifiNetworkSpecifier.Builder().setSsid(ssid).build();
        NetworkRequest request = new NetworkRequest.Builder()
                .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .setNetworkSpecifier(specifier)
                .build();
        callback = new ConnectivityManager.NetworkCallback() {
            @Override public void onAvailable(Network network) { connectivity.bindProcessToNetwork(network); listener.onAvailable(network); }
            @Override public void onUnavailable() { listener.onUnavailable(); }
            @Override public void onLost(Network network) { listener.onLost(); }
        };
        connectivity.requestNetwork(request, callback, 8_000);
    }

    @Override public void close() {
        if (callback != null) {
            connectivity.unregisterNetworkCallback(callback);
            connectivity.bindProcessToNetwork(null);
            callback = null;
        }
    }
}
