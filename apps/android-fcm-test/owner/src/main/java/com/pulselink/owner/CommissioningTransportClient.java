package com.pulselink.owner;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.Proxy;
import java.net.SocketTimeoutException;
import java.net.URL;
import android.net.Network;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import android.util.Log;
import org.json.JSONObject;

/** Local SoftAP client. It never persists credentials or treats HTTP 200 as online. */
final class CommissioningTransportClient implements AutoCloseable {
    private static final String TAG = "PulseLinkCommissioningHttp";
    private static final int CONNECT_TIMEOUT_MS = 5_000;
    private static final int RESPONSE_TIMEOUT_MS = 20_000;
    private static final int MAX_RESPONSE = 4_096;
    private final SecureRandom random = new SecureRandom();
    private byte[] sessionKey;
    private byte[] transcript;
    private long expiresAt;

    JSONObject requestEnrollmentProof(String baseUrl, JSONObject claimData) throws Exception {
        return requestEnrollmentProof(baseUrl, claimData, null);
    }

    JSONObject requestEnrollmentProof(String baseUrl, JSONObject claimData, Network network) throws Exception {
        if (baseUrl == null || !baseUrl.startsWith("http://") || claimData == null)
            throw new IllegalArgumentException("Local commissioning context required");
        JSONObject session = claimData.getJSONObject("session");
        String deviceId = session.getString("deviceId");
        String storeId = session.getString("storeId");
        String claimSessionId = session.getString("id");
        long expiry = java.time.Instant.parse(session.getString("expiresAt")).getEpochSecond();
        JSONObject request = new JSONObject().put("deviceId", deviceId).put("storeId", storeId)
                .put("claimSessionId", claimSessionId).put("challenge", claimData.getString("challenge"))
                .put("expiresAt", expiry);
        JSONObject response = postJson(baseUrl + "/v1/commissioning/enrollment-proof", request, "claim_proof", network);
        String publicKey = response.getString("publicKeySpkiBase64");
        int keyVersion = response.getInt("keyVersion");
        String challenge = response.getString("challenge");
        long responseExpiry = response.getLong("expiresAt");
        String signature = response.getString("signatureDerBase64");
        if (!deviceId.equals(response.optString("deviceId")) || !storeId.equals(response.optString("storeId"))
                || !claimSessionId.equals(response.optString("claimSessionId"))
                || !claimData.getString("challenge").equals(challenge) || expiry != responseExpiry
                || keyVersion < 1 || responseExpiry <= System.currentTimeMillis() / 1000L)
            throw new SecurityException("Device claim context mismatch");
        byte[] transcript = DeviceClaimTranscript.build(deviceId, storeId, claimSessionId, keyVersion,
                publicKey, challenge, responseExpiry);
        boolean verified;
        try {
            verified = CommissioningCrypto.verifySignature(Base64.getDecoder().decode(publicKey), transcript,
                    Base64.getDecoder().decode(signature));
        } finally {
            java.util.Arrays.fill(transcript, (byte) 0);
        }
        if (!verified) throw new SecurityException("Device claim proof rejected");
        return new JSONObject().put("challenge", challenge).put("publicKeySpkiBase64", publicKey)
                .put("keyVersion", keyVersion).put("expiresAt", responseExpiry)
                .put("signatureDerBase64", signature);
    }

    void handshake(
            String baseUrl,
            String sessionId,
            String deviceKeyBase64,
            String challenge,
            long expiresAtEpochSeconds,
            String clientContext) throws Exception {
        handshake(baseUrl, sessionId, deviceKeyBase64, challenge, expiresAtEpochSeconds, clientContext, null);
    }

    void handshake(String baseUrl, String sessionId, String deviceKeyBase64, String challenge,
                   long expiresAtEpochSeconds, String clientContext, Network network) throws Exception {
        if (baseUrl == null || !baseUrl.startsWith("http://")) throw new IllegalArgumentException("Local commissioning URL required");
        if (sessionId == null || deviceKeyBase64 == null || challenge == null || clientContext == null) throw new IllegalArgumentException("Missing handshake field");
        if (expiresAtEpochSeconds <= System.currentTimeMillis() / 1000L) throw new IllegalArgumentException("Session expired");
        byte[] deviceKey = Base64.getDecoder().decode(deviceKeyBase64);
        byte[] challengeBytes = challenge.getBytes(StandardCharsets.UTF_8);
        byte[] clientNonce = new byte[32];
        random.nextBytes(clientNonce);
        KeyPair ephemeral = CommissioningCrypto.generateEphemeralKeyPair();
        byte[] clientEphemeral = CommissioningCrypto.rawPublicKey(ephemeral);
        JSONObject request = new JSONObject()
                .put("sessionId", sessionId)
                .put("deviceKey", Base64.getEncoder().encodeToString(deviceKey))
                .put("challenge", challenge)
                .put("expiresAt", expiresAtEpochSeconds)
                .put("clientContext", clientContext)
                .put("clientNonce", Base64.getEncoder().encodeToString(clientNonce))
                .put("clientEphemeralPublicKey", Base64.getEncoder().encodeToString(clientEphemeral));
        JSONObject response = postJson(baseUrl + "/v1/commissioning/handshake", request, "handshake", network);
        byte[] responseKey = Base64.getDecoder().decode(response.getString("deviceKey"));
        if (!MessageDigest.isEqual(deviceKey, responseKey)) throw new SecurityException("Device identity mismatch");
        byte[] deviceNonce = Base64.getDecoder().decode(response.getString("deviceNonce"));
        byte[] deviceEphemeral = Base64.getDecoder().decode(response.getString("deviceEphemeralPublicKey"));
        byte[] signature = Base64.getDecoder().decode(response.getString("signature"));
        transcript = CommissioningTranscript.build(1, sessionId.getBytes(StandardCharsets.UTF_8), deviceKey,
                challengeBytes, expiresAtEpochSeconds, clientContext.getBytes(StandardCharsets.UTF_8),
                clientNonce, deviceNonce, clientEphemeral, deviceEphemeral);
        if (!CommissioningCrypto.verifySignature(deviceKey, transcript, signature)) throw new SecurityException("Device proof rejected");
        byte[] shared = CommissioningCrypto.deriveSharedSecret(ephemeral, deviceEphemeral);
        byte[] salt = new byte[clientNonce.length + deviceNonce.length];
        System.arraycopy(clientNonce, 0, salt, 0, clientNonce.length);
        System.arraycopy(deviceNonce, 0, salt, clientNonce.length, deviceNonce.length);
        sessionKey = CommissioningCrypto.hkdfSha256(shared, salt, "pulselink-softap-session-v1".getBytes(StandardCharsets.UTF_8), 16);
        java.util.Arrays.fill(shared, (byte) 0);
        java.util.Arrays.fill(salt, (byte) 0);
        this.expiresAt = expiresAtEpochSeconds;
    }

    void sendCredentials(String baseUrl, String ssid, String password) throws Exception {
        sendCredentials(baseUrl, ssid, password, null, null, null);
    }

    void sendCredentials(String baseUrl, String ssid, String password,
                          String deviceId, String deviceKey, String bootstrapSecret) throws Exception {
        sendCredentials(baseUrl, ssid, password, deviceId, deviceKey, bootstrapSecret, null);
    }

    void sendCredentials(String baseUrl, String ssid, String password, String deviceId,
                         String deviceKey, String bootstrapSecret, Network network) throws Exception {
        if (sessionKey == null || transcript == null || expiresAt <= System.currentTimeMillis() / 1000L) throw new IllegalStateException("Authenticated commissioning session required");
        if (deviceId == null || deviceKey == null || bootstrapSecret == null || bootstrapSecret.length() < 32) throw new IllegalStateException("Redemption context required");
        if (ssid == null || ssid.isEmpty() || ssid.length() > 32 || password == null || password.length() < 8 || password.length() > 64) throw new IllegalArgumentException("Invalid Wi-Fi credentials");
        byte[] nonce = new byte[12];
        random.nextBytes(nonce);
        byte[] plaintext = null;
        byte[] sealed = null;
        byte[] ciphertext = null;
        byte[] tag = null;
        try {
            plaintext = new JSONObject().put("ssid", ssid).put("password", password)
                    .put("deviceId", deviceId).put("deviceKey", deviceKey)
                    .put("bootstrapSecret", bootstrapSecret).toString().getBytes(StandardCharsets.UTF_8);
            sealed = CommissioningCrypto.seal(sessionKey, nonce, transcript, plaintext);
            ciphertext = java.util.Arrays.copyOf(sealed, sealed.length - 16);
            tag = java.util.Arrays.copyOfRange(sealed, sealed.length - 16, sealed.length);
            JSONObject response = postJson(baseUrl + "/v1/commissioning/credentials", new JSONObject()
                    .put("nonce", Base64.getEncoder().encodeToString(nonce))
                    .put("aad", Base64.getEncoder().encodeToString(transcript))
                    .put("ciphertext", Base64.getEncoder().encodeToString(ciphertext))
                    .put("tag", Base64.getEncoder().encodeToString(tag)), "credentials", network);
            if (!"accepted_for_redeem".equals(response.optString("status"))) throw new SecurityException("Credential handoff was not accepted");
        } finally {
            if (plaintext != null) java.util.Arrays.fill(plaintext, (byte) 0);
            if (sealed != null) java.util.Arrays.fill(sealed, (byte) 0);
            if (ciphertext != null) java.util.Arrays.fill(ciphertext, (byte) 0);
            if (tag != null) java.util.Arrays.fill(tag, (byte) 0);
            java.util.Arrays.fill(nonce, (byte) 0);
            close();
        }
    }

    @Override public void close() {
        if (sessionKey != null) java.util.Arrays.fill(sessionKey, (byte) 0);
        if (transcript != null) java.util.Arrays.fill(transcript, (byte) 0);
        sessionKey = null;
        transcript = null;
        expiresAt = 0L;
    }

    private static JSONObject postJson(String url, JSONObject body, String stage, Network network) throws Exception {
        URL target = URI.create(url).toURL();
        HttpURLConnection connection = (HttpURLConnection) (network == null
                ? target.openConnection(Proxy.NO_PROXY) : network.openConnection(target, Proxy.NO_PROXY));
        String phase = "connect";
        try {
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(RESPONSE_TIMEOUT_MS);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("Connection", "close");
            byte[] requestBody = body.toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(requestBody.length);
            Log.i(TAG, "direct local request started stage=" + stage + " proxy=disabled");
            phase = "write_request";
            try (OutputStream output = connection.getOutputStream()) {
                output.write(requestBody);
                output.flush();
            }
            phase = "response_headers";
            int status = connection.getResponseCode();
            Log.i(TAG, "local response received stage=" + stage + " status=" + status);
            InputStream stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
            phase = "response_body";
            String text = stream == null ? "" : readBounded(stream);
            if (status < 200 || status >= 300) throw new IllegalStateException("Commissioning request rejected");
            return new JSONObject(text);
        } catch (SocketTimeoutException timeout) {
            Log.w(TAG, "direct local request timed out stage=" + stage + " phase=" + phase);
            throw new CommissioningRequestTimeout(stage, phase, timeout);
        } finally {
            connection.disconnect();
        }
    }

    private static String readBounded(InputStream stream) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[512];
        int total = 0;
        int read;
        while ((read = stream.read(buffer)) != -1) {
            total += read;
            if (total > MAX_RESPONSE) throw new IllegalStateException("Commissioning response too large");
            output.write(buffer, 0, read);
        }
        return output.toString(StandardCharsets.UTF_8.name());
    }
}
