package com.pulselink.fcmtest

import android.content.Context
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class SecureCredentialStore(context: Context) {
    private val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    init {
        // Remove the legacy raw FCM token written by the original test screen.
        context.getSharedPreferences(LEGACY_PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .remove(LEGACY_FCM_KEY)
            .apply()
    }

    fun save(tokens: AuthTokens) {
        preferences.edit()
            .putString(ACCESS_KEY, encrypt(tokens.accessToken))
            .putString(REFRESH_KEY, encrypt(tokens.refreshToken))
            .apply()
    }

    fun getAccessToken(): String? = decrypt(preferences.getString(ACCESS_KEY, null))

    fun getRefreshToken(): String? = decrypt(preferences.getString(REFRESH_KEY, null))

    fun saveFcmToken(token: String) {
        preferences.edit().putString(FCM_KEY, encrypt(token)).apply()
    }

    fun getFcmToken(): String? = decrypt(preferences.getString(FCM_KEY, null))

    fun clear() {
        preferences.edit().remove(ACCESS_KEY).remove(REFRESH_KEY).apply()
    }

    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val iv = Base64.encodeToString(cipher.iv, Base64.NO_WRAP)
        val ciphertext = Base64.encodeToString(cipher.doFinal(value.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
        return "$iv.$ciphertext"
    }

    private fun decrypt(value: String?): String? {
        if (value.isNullOrBlank()) return null
        return runCatching {
            val parts = value.split('.', limit = 2)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(
                Cipher.DECRYPT_MODE,
                key(),
                GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)),
            )
            String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), Charsets.UTF_8)
        }.getOrNull()
    }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        val existing = store.getKey(KEY_ALIAS, null) as? SecretKey
        if (existing != null) return existing
        return KeyGenerator.getInstance("AES", ANDROID_KEYSTORE).apply {
            init(android.security.keystore.KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                android.security.keystore.KeyProperties.PURPOSE_ENCRYPT or
                    android.security.keystore.KeyProperties.PURPOSE_DECRYPT,
            ).setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE)
                .build())
        }.generateKey()
    }

    companion object {
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val KEY_ALIAS = "pulselink.auth.credentials"
        private const val PREFERENCES = "pulselink_secure_auth"
        private const val LEGACY_PREFERENCES = "pulselink_fcm_test"
        private const val LEGACY_FCM_KEY = "fcm_token"
        private const val ACCESS_KEY = "access_token"
        private const val REFRESH_KEY = "refresh_token"
        private const val FCM_KEY = "fcm_token"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}
