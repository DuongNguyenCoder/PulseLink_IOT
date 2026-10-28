package com.pulselink.owner;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class SecureSession {
    private static final String PREFS = "pulselink_owner_session";
    private static final String KEY_ALIAS = "pulselink.owner.session";
    private static final String ACCESS = "access";
    private static final String REFRESH = "refresh";
    private static final String API_BASE = "api_base";
    private final SharedPreferences prefs;

    SecureSession(Context context) {
        prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    synchronized void save(String access, String refresh, String apiBase) {
        prefs.edit().putString(ACCESS, encrypt(access)).putString(REFRESH, encrypt(refresh))
                .putString(API_BASE, apiBase).apply();
    }

    synchronized String accessToken() { return decrypt(prefs.getString(ACCESS, null)); }
    synchronized String refreshToken() { return decrypt(prefs.getString(REFRESH, null)); }
    synchronized String apiBase() { return prefs.getString(API_BASE, null); }
    synchronized void clear() { prefs.edit().remove(ACCESS).remove(REFRESH).apply(); }

    private String encrypt(String value) {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key());
            String iv = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP);
            String body = Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
            return iv + "." + body;
        } catch (Exception error) { throw new IllegalStateException("Secure session unavailable", error); }
    }

    private String decrypt(String value) {
        if (value == null) return null;
        try {
            String[] parts = value.split("\\.", 2);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
            return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
        } catch (Exception error) { return null; }
    }

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        SecretKey existing = (SecretKey) store.getKey(KEY_ALIAS, null);
        if (existing != null) return existing;
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }
}
