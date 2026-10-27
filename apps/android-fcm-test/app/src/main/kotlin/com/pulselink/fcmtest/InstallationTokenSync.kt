package com.pulselink.fcmtest

enum class InstallationSyncOutcome {
    SYNCED,
    SKIPPED_NOT_AUTHENTICATED,
    SKIPPED_SESSION_CHANGED,
    FAILED_RETRYABLE,
    FAILED,
}

class InstallationTokenSync(
    private val credentials: SecureCredentialStore,
) {
    fun sync(): InstallationSyncOutcome {
        val snapshot = credentials.sessionSnapshot()
        val accessToken = snapshot.accessToken
        val refreshToken = snapshot.refreshToken
        val fcmToken = snapshot.fcmToken
        val apiBase = snapshot.apiBase
        val installationId = snapshot.installationId
        if (accessToken.isNullOrBlank() ||
            refreshToken.isNullOrBlank() ||
            fcmToken.isNullOrBlank() ||
            apiBase.isNullOrBlank() ||
            installationId.isNullOrBlank()
        ) {
            return InstallationSyncOutcome.SKIPPED_NOT_AUTHENTICATED
        }

        if (!credentials.isSameSession(snapshot.sessionGeneration)) {
            return InstallationSyncOutcome.SKIPPED_SESSION_CHANGED
        }

        val client = ApiClient(apiBase)
        try {
            client.registerInstallation(
                accessToken,
                installationId,
                fcmToken,
            )
            return if (credentials.isSameSession(snapshot.sessionGeneration)) {
                InstallationSyncOutcome.SYNCED
            } else {
                InstallationSyncOutcome.SKIPPED_SESSION_CHANGED
            }
        } catch (error: ApiException) {
            if (error.statusCode != 401) return classify(error)
        }

        if (!credentials.isSameSession(snapshot.sessionGeneration)) {
            return InstallationSyncOutcome.SKIPPED_SESSION_CHANGED
        }

        return try {
            val refreshed = client.refresh(refreshToken)
            if (!credentials.isSameSession(snapshot.sessionGeneration)) {
                InstallationSyncOutcome.SKIPPED_SESSION_CHANGED
            } else {
                if (!credentials.saveIfSameSession(refreshed, snapshot.sessionGeneration)) {
                    InstallationSyncOutcome.SKIPPED_SESSION_CHANGED
                } else {
                    client.registerInstallation(
                        refreshed.accessToken,
                        installationId,
                        fcmToken,
                    )
                    InstallationSyncOutcome.SYNCED
                }
            }
        } catch (error: ApiException) {
            classify(error)
        }
    }

    private fun classify(error: ApiException): InstallationSyncOutcome = when {
        error.statusCode == 503 ||
            (error.statusCode == 0 &&
                (error.errorCode == "TIMEOUT" || error.errorCode == "NETWORK_ERROR")) ->
            InstallationSyncOutcome.FAILED_RETRYABLE
        else -> InstallationSyncOutcome.FAILED
    }
}
