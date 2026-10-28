package com.pulselink.owner;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;

/** Encodes only the public commissioning handshake transcript. */
final class CommissioningTranscript {
    private static final byte[] DOMAIN = "pulselink-softap-commissioning-v1".getBytes(StandardCharsets.UTF_8);

    private CommissioningTranscript() {}

    static byte[] build(
            int protocolVersion,
            byte[] sessionId,
            byte[] deviceKeySpki,
            byte[] challenge,
            long expiresAtEpochSeconds,
            byte[] clientContext,
            byte[] clientNonce,
            byte[] deviceNonce,
            byte[] clientEphemeralPublicKey,
            byte[] deviceEphemeralPublicKey) {
        if (protocolVersion <= 0) throw new IllegalArgumentException("protocol version");
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        field(output, DOMAIN);
        u16(output, protocolVersion);
        field(output, sessionId);
        field(output, deviceKeySpki);
        field(output, challenge);
        u64(output, expiresAtEpochSeconds);
        field(output, clientContext);
        field(output, clientNonce);
        field(output, deviceNonce);
        field(output, clientEphemeralPublicKey);
        field(output, deviceEphemeralPublicKey);
        return output.toByteArray();
    }

    private static void field(ByteArrayOutputStream output, byte[] value) {
        if (value == null) throw new IllegalArgumentException("null transcript field");
        if (value.length > 0xffffffffL) throw new IllegalArgumentException("transcript field too large");
        u32(output, value.length);
        output.write(value, 0, value.length);
    }

    private static void u16(ByteArrayOutputStream output, int value) {
        byte[] bytes = ByteBuffer.allocate(2).order(ByteOrder.BIG_ENDIAN).putShort((short) value).array();
        output.write(bytes, 0, bytes.length);
    }

    private static void u32(ByteArrayOutputStream output, long value) {
        byte[] bytes = ByteBuffer.allocate(4).order(ByteOrder.BIG_ENDIAN).putInt((int) value).array();
        output.write(bytes, 0, bytes.length);
    }

    private static void u64(ByteArrayOutputStream output, long value) {
        byte[] bytes = ByteBuffer.allocate(8).order(ByteOrder.BIG_ENDIAN).putLong(value).array();
        output.write(bytes, 0, bytes.length);
    }
}
