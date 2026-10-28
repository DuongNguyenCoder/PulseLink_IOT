package com.pulselink.owner;

import java.math.BigInteger;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.ECPoint;
import java.security.spec.ECParameterSpec;
import java.security.spec.ECPublicKeySpec;
import java.security.AlgorithmParameters;
import javax.crypto.Cipher;
import javax.crypto.KeyAgreement;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

final class CommissioningCrypto {
    private CommissioningCrypto() {}

    static KeyPair generateEphemeralKeyPair() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
        generator.initialize(new ECGenParameterSpec("secp256r1"));
        return generator.generateKeyPair();
    }

    static byte[] rawPublicKey(KeyPair pair) {
        java.security.interfaces.ECPublicKey publicKey =
                (java.security.interfaces.ECPublicKey) pair.getPublic();
        byte[] output = new byte[65];
        output[0] = 0x04;
        copyFixed(publicKey.getW().getAffineX(), output, 1, 32);
        copyFixed(publicKey.getW().getAffineY(), output, 33, 32);
        return output;
    }

    static byte[] deriveSharedSecret(KeyPair local, byte[] rawPeerPublicKey) throws Exception {
        KeyAgreement agreement = KeyAgreement.getInstance("ECDH");
        agreement.init(local.getPrivate());
        agreement.doPhase(decodeRawPublicKey(rawPeerPublicKey), true);
        return agreement.generateSecret();
    }

    static byte[] hkdfSha256(byte[] input, byte[] salt, byte[] info, int length) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(salt == null ? new byte[32] : salt, "HmacSHA256"));
        byte[] prk = mac.doFinal(input);
        byte[] output = new byte[length];
        byte[] previous = new byte[0];
        int offset = 0;
        for (int counter = 1; offset < length; counter++) {
            mac.init(new SecretKeySpec(prk, "HmacSHA256"));
            mac.update(previous);
            if (info != null) mac.update(info);
            mac.update((byte) counter);
            previous = mac.doFinal();
            int copy = Math.min(previous.length, length - offset);
            System.arraycopy(previous, 0, output, offset, copy);
            offset += copy;
        }
        return output;
    }

    static byte[] seal(byte[] key, byte[] nonce, byte[] aad, byte[] plaintext) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, nonce));
        if (aad != null) cipher.updateAAD(aad);
        return cipher.doFinal(plaintext);
    }

    static byte[] open(byte[] key, byte[] nonce, byte[] aad, byte[] ciphertextAndTag) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, nonce));
        if (aad != null) cipher.updateAAD(aad);
        return cipher.doFinal(ciphertextAndTag);
    }

    static boolean verifySignature(byte[] publicKeySpki, byte[] message, byte[] signatureDer) throws Exception {
        Signature verifier = Signature.getInstance("SHA256withECDSA");
        verifier.initVerify(KeyFactory.getInstance("EC").generatePublic(
                new java.security.spec.X509EncodedKeySpec(publicKeySpki)));
        verifier.update(message);
        return verifier.verify(signatureDer);
    }

    private static PublicKey decodeRawPublicKey(byte[] raw) throws Exception {
        if (raw == null || raw.length != 65 || raw[0] != 0x04) throw new IllegalArgumentException("P-256 point");
        AlgorithmParameters parameters = AlgorithmParameters.getInstance("EC");
        parameters.init(new ECGenParameterSpec("secp256r1"));
        ECParameterSpec spec = parameters.getParameterSpec(ECParameterSpec.class);
        ECPoint point = new ECPoint(
                new BigInteger(1, slice(raw, 1, 32)),
                new BigInteger(1, slice(raw, 33, 32)));
        return KeyFactory.getInstance("EC").generatePublic(new ECPublicKeySpec(point, spec));
    }

    private static void copyFixed(BigInteger value, byte[] output, int offset, int length) {
        byte[] bytes = value.toByteArray();
        int sourceOffset = bytes.length > length ? bytes.length - length : 0;
        int copyLength = Math.min(bytes.length, length);
        System.arraycopy(bytes, sourceOffset, output, offset + length - copyLength, copyLength);
    }

    private static byte[] slice(byte[] input, int offset, int length) {
        byte[] output = new byte[length];
        System.arraycopy(input, offset, output, 0, length);
        return output;
    }
}
