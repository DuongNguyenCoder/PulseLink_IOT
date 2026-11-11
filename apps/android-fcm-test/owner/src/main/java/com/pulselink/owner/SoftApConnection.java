package com.pulselink.owner;

import android.content.Context;
import android.util.Log;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.wifi.WifiNetworkSpecifier;
import android.os.Build;
import java.net.InetAddress;
import java.util.ArrayList;
import java.util.List;

/** Android 10+ local SoftAP handoff. The network is not treated as trusted. */
final class SoftApConnection implements AutoCloseable {
    private static final String TAG = "PulseLinkSoftAp";
    private static final int NETWORK_REQUEST_TIMEOUT_MS = 30_000;

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
        Log.i(TAG, "SoftAP network request started; waiting for Android approval and IPv4 readiness");
        WifiNetworkSpecifier specifier = new WifiNetworkSpecifier.Builder().setSsid(ssid).build();
        NetworkRequest request = new NetworkRequest.Builder()
                .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .setNetworkSpecifier(specifier)
                .build();
        callback = new ConnectivityManager.NetworkCallback() {
            private Network availableNetwork;
            private LinkProperties latestLinkProperties;
            private boolean ready;
            private boolean terminal;

            @Override public void onAvailable(Network network) {
                availableNetwork = network;
                Log.i(TAG, "Android reported requested Wi-Fi network available");
                notifyReadyIfPossible(network);
            }

            @Override public void onLinkPropertiesChanged(Network network, LinkProperties properties) {
                if (terminal || properties == null) return;
                latestLinkProperties = properties;
                notifyReadyIfPossible(network);
            }

            private void notifyReadyIfPossible(Network network) {
                if (ready || terminal || availableNetwork == null || !availableNetwork.equals(network)
                        || latestLinkProperties == null) return;
                List<InetAddress> addresses = new ArrayList<>();
                for (LinkAddress linkAddress : latestLinkProperties.getLinkAddresses()) addresses.add(linkAddress.getAddress());
                if (!SoftApNetworkReadiness.hasIpv4Address(addresses)) return;
                ready = true;
                connectivity.bindProcessToNetwork(network);
                Log.i(TAG, "Requested Wi-Fi network has IPv4; ready for local commissioning HTTP");
                listener.onAvailable(network);
            }

            @Override public void onUnavailable() {
                if (terminal) return;
                terminal = true;
                Log.w(TAG, "Android did not provide the requested Wi-Fi network; request timed out or was denied");
                listener.onUnavailable();
            }

            @Override public void onLost(Network network) {
                if (terminal) return;
                terminal = true;
                Log.w(TAG, "Android lost the requested Wi-Fi network");
                if (ready) listener.onLost();
                else listener.onUnavailable();
            }
        };
        connectivity.requestNetwork(request, callback, NETWORK_REQUEST_TIMEOUT_MS);
    }

    @Override public void close() {
        if (callback != null) {
            connectivity.unregisterNetworkCallback(callback);
            connectivity.bindProcessToNetwork(null);
            callback = null;
        }
    }

    boolean releaseAndAwaitInternet(long timeoutMs) throws InterruptedException {
        close();
        return InternetNetworkWaiter.awaitDefaultInternet(connectivity, timeoutMs);
    }
}
