package com.pulselink.fcmtest

import java.util.UUID

data class NotificationPayload(
    val eventId: String,
    val eventType: String,
) {
    companion object {
        private const val MAX_EVENT_ID_LENGTH = 36
        private const val MAX_EVENT_TYPE_LENGTH = 64

        fun fromData(data: Map<String, String>): NotificationPayload? {
            val eventId = data["eventId"]?.trim()?.takeIf { it.length <= MAX_EVENT_ID_LENGTH }
                ?: return null
            val eventType = data["eventType"]?.trim()?.takeIf { it.length in 1..MAX_EVENT_TYPE_LENGTH }
                ?: return null
            val normalizedEventId = runCatching { UUID.fromString(eventId).toString() }.getOrNull()
                ?: return null
            if (eventType != "BUTTON_PRESSED") return null
            return NotificationPayload(normalizedEventId, eventType)
        }
    }
}
