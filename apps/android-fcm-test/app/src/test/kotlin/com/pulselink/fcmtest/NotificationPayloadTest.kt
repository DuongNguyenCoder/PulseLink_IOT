package com.pulselink.fcmtest

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NotificationPayloadTest {
    @Test
    fun acceptsTheBackendEventPayload() {
        val payload = NotificationPayload.fromData(
            mapOf(
                "eventId" to "0199aabb-ccdd-7eef-8123-456789abcdef",
                "eventType" to "BUTTON_PRESSED",
            ),
        )

        assertEquals("0199aabb-ccdd-7eef-8123-456789abcdef", payload?.eventId)
        assertEquals("BUTTON_PRESSED", payload?.eventType)
    }

    @Test
    fun rejectsMissingOrUnsupportedPayloadFields() {
        assertNull(NotificationPayload.fromData(mapOf("eventType" to "BUTTON_PRESSED")))
        assertNull(NotificationPayload.fromData(mapOf("eventId" to "not-an-id", "eventType" to "BUTTON_PRESSED")))
        assertNull(
            NotificationPayload.fromData(
                mapOf(
                    "eventId" to "0199aabb-ccdd-7eef-8123-456789abcdef",
                    "eventType" to "UNKNOWN_EVENT",
                ),
            ),
        )
    }
}
