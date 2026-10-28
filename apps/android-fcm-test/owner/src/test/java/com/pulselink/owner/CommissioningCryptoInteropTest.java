package com.pulselink.owner;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.AlgorithmParameters;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PublicKey;
import java.security.Signature;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.ECParameterSpec;
import java.security.spec.ECPoint;
import java.security.spec.ECPrivateKeySpec;
import java.security.spec.ECPublicKeySpec;
import java.util.HashMap;
import java.util.Map;
import javax.crypto.spec.SecretKeySpec;
import org.junit.Test;

public final class CommissioningCryptoInteropTest {
    @Test
    public void matchesSharedEcdhHkdfAeadAndSignatureFixture() throws Exception {
        Map<String, byte[]> vector = readFixture();
        KeyPair a = fixedPair(vector.get("a_private"), vector.get("a_public"));
        KeyPair b = fixedPair(vector.get("b_private"), vector.get("b_public"));
        assertArrayEquals(vector.get("shared_secret"), CommissioningCrypto.deriveSharedSecret(a, vector.get("b_public")));
        assertArrayEquals(vector.get("shared_secret"), CommissioningCrypto.deriveSharedSecret(b, vector.get("a_public")));
        byte[] key = CommissioningCrypto.hkdfSha256(vector.get("shared_secret"), vector.get("salt"), vector.get("info"), 16);
        assertArrayEquals(vector.get("hkdf_key"), key);
        byte[] sealed = CommissioningCrypto.seal(key, vector.get("nonce"), vector.get("aad"), vector.get("plaintext"));
        byte[] expectedSealed = concat(vector.get("ciphertext"), vector.get("tag"));
        assertArrayEquals(expectedSealed, sealed);
        assertArrayEquals(vector.get("plaintext"), CommissioningCrypto.open(key, vector.get("nonce"), vector.get("aad"), sealed));
        assertTrue(CommissioningCrypto.verifySignature(vector.get("public_key_spki"), vector.get("signature_message"), vector.get("signature_der")));
        byte[] changed = vector.get("signature_message").clone();
        changed[0] ^= 1;
        assertFalse(CommissioningCrypto.verifySignature(vector.get("public_key_spki"), changed, vector.get("signature_der")));
    }

    private static KeyPair fixedPair(byte[] privateBytes, byte[] publicBytes) throws Exception {
        AlgorithmParameters parameters = AlgorithmParameters.getInstance("EC");
        parameters.init(new ECGenParameterSpec("secp256r1"));
        ECParameterSpec spec = parameters.getParameterSpec(ECParameterSpec.class);
        ECPoint point = new ECPoint(new BigInteger(1, slice(publicBytes, 1, 32)), new BigInteger(1, slice(publicBytes, 33, 32)));
        KeyFactory factory = KeyFactory.getInstance("EC");
        return new KeyPair(factory.generatePublic(new ECPublicKeySpec(point, spec)), factory.generatePrivate(new ECPrivateKeySpec(new BigInteger(1, privateBytes), spec)));
    }

    private static Map<String, byte[]> readFixture() throws Exception {
        Path direct = Path.of("..", "..", "..", "firmware", "esp32", "tests", "fixtures", "commissioning_crypto_v1.txt");
        Path fallback = Path.of("firmware", "esp32", "tests", "fixtures", "commissioning_crypto_v1.txt");
        Path path = Files.exists(direct) ? direct : fallback;
        Map<String, byte[]> result = new HashMap<>();
        for (String line : new String(Files.readAllBytes(path), StandardCharsets.US_ASCII).split("\\R")) {
            if (line.isBlank() || line.startsWith("#")) continue;
            String[] parts = line.split("=", 2);
            result.put(parts[0], fromHex(parts[1]));
        }
        return result;
    }

    private static byte[] fromHex(String value) {
        byte[] output = new byte[value.length() / 2];
        for (int i = 0; i < output.length; i++) output[i] = (byte) Integer.parseInt(value.substring(i * 2, i * 2 + 2), 16);
        return output;
    }

    private static byte[] slice(byte[] value, int offset, int length) {
        byte[] output = new byte[length];
        System.arraycopy(value, offset, output, 0, length);
        return output;
    }

    private static byte[] concat(byte[] left, byte[] right) {
        byte[] output = new byte[left.length + right.length];
        System.arraycopy(left, 0, output, 0, left.length);
        System.arraycopy(right, 0, output, left.length, right.length);
        return output;
    }
}
