package com.pulselink.owner;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.security.KeyPair;
import java.security.Signature;
import java.util.Arrays;
import javax.crypto.AEADBadTagException;
import org.junit.Test;

public final class CommissioningCryptoTest {
    @Test
    public void ecdhAndAesGcmRoundTripAndTamperRejection() throws Exception {
        KeyPair alice = CommissioningCrypto.generateEphemeralKeyPair();
        KeyPair bob = CommissioningCrypto.generateEphemeralKeyPair();
        byte[] aliceSecret = CommissioningCrypto.deriveSharedSecret(alice, CommissioningCrypto.rawPublicKey(bob));
        byte[] bobSecret = CommissioningCrypto.deriveSharedSecret(bob, CommissioningCrypto.rawPublicKey(alice));
        assertArrayEquals(aliceSecret, bobSecret);
        byte[] key = CommissioningCrypto.hkdfSha256(aliceSecret, new byte[] {1, 2}, "pulselink-softap-session-v1".getBytes(), 16);
        byte[] nonce = new byte[12];
        byte[] aad = "transcript".getBytes();
        byte[] ciphertext = CommissioningCrypto.seal(key, nonce, aad, "wifi-config".getBytes());
        assertArrayEquals("wifi-config".getBytes(), CommissioningCrypto.open(key, nonce, aad, ciphertext));
        ciphertext[ciphertext.length - 1] ^= 1;
        try {
            CommissioningCrypto.open(key, nonce, aad, ciphertext);
            assertTrue("tampered ciphertext must fail", false);
        } catch (AEADBadTagException expected) {
            assertTrue(true);
        }
    }

    @Test
    public void deviceSignatureVerificationRejectsChangedMessage() throws Exception {
        KeyPair device = CommissioningCrypto.generateEphemeralKeyPair();
        byte[] message = "transcript".getBytes();
        Signature signer = Signature.getInstance("SHA256withECDSA");
        signer.initSign(device.getPrivate());
        signer.update(message);
        byte[] signature = signer.sign();
        assertTrue(CommissioningCrypto.verifySignature(device.getPublic().getEncoded(), message, signature));
        assertFalse(CommissioningCrypto.verifySignature(device.getPublic().getEncoded(), "changed".getBytes(), signature));
    }
}
