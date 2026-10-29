package com.pulselink.owner;

import java.net.URI;
import java.util.regex.Pattern;

/** Parses identity-only QR payloads. A valid ID never proves enrollment or ownership. */
final class DeviceQrIdentity {
    private static final Pattern DEVICE_ID = Pattern.compile("[A-Za-z0-9_-]{8,128}");

    private DeviceQrIdentity() {}

    static String parse(String rawValue) {
        if (rawValue == null) return null;
        String value = rawValue.trim();
        if (value.startsWith("pulselink://device/v1/")) {
            try {
                URI uri = URI.create(value);
                if (!"pulselink".equals(uri.getScheme()) || !"device".equals(uri.getHost())
                        || uri.getRawQuery() != null || uri.getRawFragment() != null) return null;
                value = uri.getPath().substring("/v1/".length());
                if (value.contains("/")) return null;
            } catch (RuntimeException invalidUri) {
                return null;
            }
        }
        return DEVICE_ID.matcher(value).matches() ? value : null;
    }

    static String softApSsid(String deviceId) {
        String parsed = parse(deviceId);
        if (parsed == null || !parsed.startsWith("pl-") || parsed.length() != 15) return null;
        return "PulseLink-" + parsed.substring(parsed.length() - 4).toUpperCase(java.util.Locale.ROOT);
    }
}
