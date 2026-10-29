package com.pulselink.owner;

import org.junit.Test;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import static org.junit.Assert.assertEquals;

public final class DeviceClaimTranscriptTest {
    @Test public void encodesCanonicalUtf8NewlineSeparatedClaimContext() {
        String expected = "pulselink-device-claim-v1\npl-0123456789ab\nstore-vector-1"
                + "\nclaim-vector-1\n1\nc3BraS1wdWJsaWMta2V5"
                + "\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n2000000000";
        assertEquals(expected, new String(DeviceClaimTranscript.build("pl-0123456789ab", "store-vector-1",
                "claim-vector-1", 1, "c3BraS1wdWJsaWMta2V5",
                "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", 2_000_000_000L), StandardCharsets.UTF_8));
        byte[] actual = DeviceClaimTranscript.build("pl-0123456789ab", "store-vector-1",
                "claim-vector-1", 1, "c3BraS1wdWJsaWMta2V5",
                "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", 2_000_000_000L);
        assertEquals(readFixtureHex(), toHex(actual));
    }

    private static String readFixtureHex() {
        try {
            Path direct = Path.of("..", "..", "firmware", "esp32", "tests", "fixtures", "device_claim_v1.hex");
            Path ownerProject = Path.of("..", "..", "..", "firmware", "esp32", "tests", "fixtures", "device_claim_v1.hex");
            Path root = Path.of("firmware", "esp32", "tests", "fixtures", "device_claim_v1.hex");
            Path fixture = Files.exists(direct) ? direct : Files.exists(ownerProject) ? ownerProject : root;
            return new String(Files.readAllBytes(fixture), StandardCharsets.US_ASCII).trim();
        } catch (Exception failure) {
            throw new AssertionError("shared claim fixture unavailable", failure);
        }
    }

    private static String toHex(byte[] value) {
        StringBuilder result = new StringBuilder(value.length * 2);
        for (byte item : value) result.append(String.format(java.util.Locale.ROOT, "%02x", item & 0xff));
        return result.toString();
    }
}
