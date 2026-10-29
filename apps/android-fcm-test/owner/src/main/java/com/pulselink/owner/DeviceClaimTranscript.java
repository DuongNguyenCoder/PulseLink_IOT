package com.pulselink.owner;

import java.nio.charset.StandardCharsets;

/** Canonical first-claim proof bytes; protocol peers encode the same UTF-8 lines. */
final class DeviceClaimTranscript {
    private DeviceClaimTranscript() {}

    static byte[] build(String deviceId, String storeId, String claimSessionId, int keyVersion,
                        String publicKeySpkiBase64, String challenge, long expiresAt) {
        if (deviceId == null || storeId == null || claimSessionId == null || keyVersion < 1
                || publicKeySpkiBase64 == null || challenge == null || expiresAt < 1) {
            throw new IllegalArgumentException("Invalid claim proof context");
        }
        return ("pulselink-device-claim-v1\n" + deviceId + "\n" + storeId + "\n"
                + claimSessionId + "\n" + keyVersion + "\n" + publicKeySpkiBase64 + "\n"
                + challenge + "\n" + expiresAt).getBytes(StandardCharsets.UTF_8);
    }
}
