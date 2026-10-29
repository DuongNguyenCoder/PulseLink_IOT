package com.pulselink.owner;

import org.json.JSONObject;
import java.util.Objects;

final class OwnerPushRegistration {
    private OwnerPushRegistration() {}

    static void sync(SecureSession session, String fcmToken) throws Exception {
        String base = session.apiBase();
        String installationId = session.installationId();
        String access = session.accessToken();
        if (base == null || installationId == null || access == null) return;
        ApiClient client = new ApiClient(base);
        try {
            client.registerInstallation(access, installationId, fcmToken);
        } catch (ApiClient.ApiError error) {
            if (error.status != 401) throw error;
            String refreshToken = session.refreshToken();
            if (refreshToken == null) throw error;
            JSONObject tokens = client.refresh(refreshToken).getJSONObject("data");
            if (!Objects.equals(session.accessToken(), access) ||
                    !Objects.equals(session.refreshToken(), refreshToken)) return;
            access = tokens.getString("accessToken");
            session.save(access, tokens.getString("refreshToken"), base, installationId);
            client.registerInstallation(access, installationId, fcmToken);
        }
    }
}
