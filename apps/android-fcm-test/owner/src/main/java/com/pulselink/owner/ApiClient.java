package com.pulselink.owner;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

final class ApiClient {
    static final class ApiError extends Exception {
        final int status;
        ApiError(int status, String message) { super(message); this.status = status; }
    }
    private final String base;
    ApiClient(String baseUrl) {
        if (baseUrl == null || !baseUrl.startsWith("https://")) throw new IllegalArgumentException("HTTPS API URL required");
        URI.create(baseUrl);
        base = baseUrl.replaceAll("/+$", "");
    }
    JSONObject signup(String email, String password) throws Exception { return post("/v1/auth/signup", json("email", email, "password", password), null); }
    JSONObject login(String email, String password, String installationId) throws Exception {
        return post("/v1/auth/login", json("email", email, "password", password, "appInstallationId", installationId, "platform", "ANDROID"), null);
    }
    JSONObject refresh(String token) throws Exception { return post("/v1/auth/refresh", json("refreshToken", token), null); }
    void logout(String token) throws Exception { post("/v1/auth/logout", json("refreshToken", token), null); }
    JSONArray stores(String access) throws Exception { return get("/v1/stores", access).optJSONArray("data"); }
    JSONObject createStore(String access, String name, String slug, String timezone) throws Exception {
        JSONObject body = json("name", name, "slug", slug);
        if (!timezone.isBlank()) body.put("timezone", timezone);
        return post("/v1/stores", body, access);
    }
    JSONArray devices(String access, String storeId) throws Exception { return get("/v1/stores/" + path(storeId) + "/devices", access).optJSONArray("data"); }
    JSONObject createDevice(String access, String storeId, String name) throws Exception {
        return post("/v1/stores/" + path(storeId) + "/devices", json("name", name), access);
    }
    JSONObject createProvisioningSession(String access, String storeId, String deviceId, String idempotencyKey) throws Exception {
        JSONObject body = json("deviceId", deviceId, "idempotencyKey", idempotencyKey);
        return post("/v1/stores/" + path(storeId) + "/provisioning-sessions", body, access);
    }
    private JSONObject get(String path, String access) throws Exception { return request("GET", path, null, access); }
    private JSONObject post(String path, JSONObject body, String access) throws Exception { return request("POST", path, body, access); }
    private JSONObject request(String method, String path, JSONObject body, String access) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) URI.create(base + path).toURL().openConnection();
        try {
            connection.setRequestMethod(method); connection.setConnectTimeout(10_000); connection.setReadTimeout(10_000);
            if (access != null) connection.setRequestProperty("Authorization", "Bearer " + access);
            if (body != null) {
                connection.setDoOutput(true); connection.setRequestProperty("Content-Type", "application/json");
                try (var stream = connection.getOutputStream()) {
                    stream.write(body.toString().getBytes(StandardCharsets.UTF_8));
                }
            }
            int status = connection.getResponseCode();
            var stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
            String text = stream == null ? "" : readBody(stream);
            JSONObject response = text.isBlank() ? new JSONObject() : new JSONObject(text);
            if (status < 200 || status >= 300) {
                JSONObject error = response.optJSONObject("error");
                throw new ApiError(status, error == null ? "Request failed" : error.optString("message", "Request failed"));
            }
            return response;
        } catch (ApiError error) { throw error; } catch (IOException error) { throw new ApiError(0, "Network error or timeout"); }
        finally { connection.disconnect(); }
    }
    static String readBody(InputStream stream) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[4096];
        int count;
        while ((count = stream.read(chunk)) != -1) buffer.write(chunk, 0, count);
        return buffer.toString(StandardCharsets.UTF_8.name());
    }
    private static JSONObject json(String... values) throws Exception { JSONObject result = new JSONObject(); for (int i=0;i<values.length;i+=2) result.put(values[i], values[i+1]); return result; }
    private static String path(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8); }
}
