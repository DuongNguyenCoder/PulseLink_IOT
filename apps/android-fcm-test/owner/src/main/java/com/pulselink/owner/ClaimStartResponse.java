package com.pulselink.owner;

import org.json.JSONObject;
import java.util.regex.Pattern;

/** Validates the challenge response before Android starts the SoftAP proof step. */
final class ClaimStartResponse {
    private static final Pattern CHALLENGE = Pattern.compile("[A-Za-z0-9_-]{43}");

    final JSONObject data;
    final JSONObject session;
    final boolean alreadyClaimed;
    final String requestId;

    private ClaimStartResponse(JSONObject data, JSONObject session, boolean alreadyClaimed, String requestId) {
        this.data = data;
        this.session = session;
        this.alreadyClaimed = alreadyClaimed;
        this.requestId = requestId;
    }

    static ClaimStartResponse parse(JSONObject envelope, String expectedDeviceId, String expectedStoreId)
            throws ContractException {
        JSONObject meta = envelope == null ? null : envelope.optJSONObject("meta");
        String requestId = meta == null ? "unavailable" : meta.optString("requestId", "unavailable");
        JSONObject data = envelope == null ? null : envelope.optJSONObject("data");
        if (data == null) throw new ContractException("missing_data", requestId);

        if (data.optBoolean("alreadyClaimed")) {
            JSONObject device = data.optJSONObject("device");
            validateAlreadyClaimed(device == null ? null : device.optString("id"),
                    device == null ? null : device.optString("storeId"),
                    device == null ? null : device.optString("enrollmentStatus"),
                    expectedDeviceId, expectedStoreId, requestId);
            return new ClaimStartResponse(data, null, true, requestId);
        }

        JSONObject session = data.optJSONObject("session");
        validateSession(session == null ? null : session.optString("id"),
                session == null ? null : session.optString("deviceId"),
                session == null ? null : session.optString("storeId"),
                data.optString("challenge"),
                session == null ? null : session.optString("expiresAt"),
                expectedDeviceId, expectedStoreId, requestId);
        return new ClaimStartResponse(data, session, false, requestId);
    }

    static void validateSession(String sessionId, String sessionDeviceId, String sessionStoreId,
            String challenge, String expiresAt, String expectedDeviceId, String expectedStoreId,
            String requestId) throws ContractException {
        if (sessionId == null || sessionId.isBlank()) throw new ContractException("missing_session", requestId);
        if (!expectedDeviceId.equals(sessionDeviceId) || !expectedStoreId.equals(sessionStoreId)) {
            throw new ContractException("claim_context_mismatch", requestId);
        }
        if (challenge == null || !CHALLENGE.matcher(challenge).matches()) {
            throw new ContractException("missing_challenge", requestId);
        }
        if (expiresAt == null || expiresAt.isBlank()) throw new ContractException("missing_expiry", requestId);
    }

    static void validateAlreadyClaimed(String deviceId, String storeId, String enrollmentStatus,
            String expectedDeviceId, String expectedStoreId, String requestId) throws ContractException {
        if (!expectedDeviceId.equals(deviceId) || !expectedStoreId.equals(storeId)
                || !"ENROLLED".equals(enrollmentStatus)) {
            throw new ContractException("invalid_existing_device", requestId);
        }
    }

    static final class ContractException extends Exception {
        final String reason;
        final String requestId;

        ContractException(String reason, String requestId) {
            super("Claim API response did not satisfy the expected contract");
            this.reason = reason;
            this.requestId = requestId;
        }
    }
}
