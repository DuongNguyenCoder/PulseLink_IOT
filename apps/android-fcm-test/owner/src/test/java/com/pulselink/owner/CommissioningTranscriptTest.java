package com.pulselink.owner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertThrows;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.Test;

public final class CommissioningTranscriptTest {
    @Test
    public void matchesLengthAndBoundaryVector() {
        byte[] transcript = CommissioningTranscript.build(
                1,
                "session-1".getBytes(StandardCharsets.UTF_8),
                new byte[] {0x30, 0x01, 0x02},
                "challenge-1".getBytes(StandardCharsets.UTF_8),
                1700000000L,
                "owner-app".getBytes(StandardCharsets.UTF_8),
                new byte[] {0x01, 0x02},
                new byte[] {0x03, 0x04},
                new byte[] {0x05, 0x06},
                new byte[] {0x07, 0x08});
        assertEquals(119, transcript.length);
        assertEquals(0, transcript[0]);
        assertEquals(0, transcript[1]);
        assertEquals(0, transcript[2]);
        assertEquals(33, transcript[3]);
        assertEquals(0x07, transcript[transcript.length - 2]);
        assertEquals(0x08, transcript[transcript.length - 1]);
        assertArrayEquals(readSharedFixture(), transcript);
    }

    private static byte[] readSharedFixture() {
        try {
            Path direct = Path.of("..", "..", "firmware", "esp32", "tests", "fixtures", "commissioning_transcript_v1.hex");
            Path ownerProject = Path.of("..", "..", "..", "firmware", "esp32", "tests", "fixtures", "commissioning_transcript_v1.hex");
            Path root = Path.of("firmware", "esp32", "tests", "fixtures", "commissioning_transcript_v1.hex");
            Path fixture = Files.exists(direct) ? direct : Files.exists(ownerProject) ? ownerProject : root;
            String hex = new String(Files.readAllBytes(fixture), StandardCharsets.US_ASCII).replaceAll("\\s+", "");
            byte[] output = new byte[hex.length() / 2];
            for (int i = 0; i < output.length; i++) output[i] = (byte) Integer.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
            return output;
        } catch (Exception error) {
            throw new AssertionError("shared transcript fixture unavailable", error);
        }
    }

    @Test
    public void rejectsInvalidVersionAndNullField() {
        assertThrows(IllegalArgumentException.class, () -> CommissioningTranscript.build(
                0, new byte[0], new byte[0], new byte[0], 0L,
                new byte[0], new byte[0], new byte[0], new byte[0], new byte[0]));
        assertThrows(IllegalArgumentException.class, () -> CommissioningTranscript.build(
                1, null, new byte[0], new byte[0], 0L,
                new byte[0], new byte[0], new byte[0], new byte[0], new byte[0]));
    }
}
