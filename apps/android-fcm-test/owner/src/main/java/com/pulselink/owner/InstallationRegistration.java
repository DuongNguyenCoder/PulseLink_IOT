package com.pulselink.owner;

final class InstallationRegistration {
    final String installationId;
    final String platform;
    final String fcmToken;

    private InstallationRegistration(String installationId, String fcmToken) {
        this.installationId = installationId;
        this.platform = "ANDROID";
        this.fcmToken = fcmToken;
    }

    static InstallationRegistration create(String installationId, String fcmToken) {
        if (installationId == null || installationId.isBlank() || fcmToken == null || fcmToken.isBlank()) {
            throw new IllegalArgumentException("Installation registration data is incomplete");
        }
        return new InstallationRegistration(installationId, fcmToken);
    }
}
