package com.pulselink.fcmtest

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class PulseLinkMessagingService : FirebaseMessagingService() {
    @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
    override fun onNewToken(token: String) {
        SecureCredentialStore(this).saveFcmToken(token)
        sendBroadcast(Intent(ACTION_STATE_CHANGED).setPackage(packageName))
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val title = message.notification?.title?.takeIf { it.isNotBlank() } ?: "PulseLink service call"
        val body = message.notification?.body?.takeIf { it.isNotBlank() }
            ?: message.data["message"]?.takeIf { it.isNotBlank() }
            ?: "Button event received"
        val eventId = message.data["eventId"]
        val display = if (eventId.isNullOrBlank()) "$title — $body" else "$title — $body (eventId=$eventId)"
        PulseLinkState.saveNotification(this, display)
        showNotification(title, body, eventId)
        sendBroadcast(Intent(ACTION_STATE_CHANGED).setPackage(packageName))
    }

    private fun showNotification(title: String, body: String, eventId: String?) {
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            if (!eventId.isNullOrBlank()) putExtra("eventId", eventId)
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        @Suppress("DEPRECATION")
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, PulseLinkState.CHANNEL_ID)
        } else {
            Notification.Builder(this)
        }
        val notification: Notification = builder
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(Notification.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification)
    }

    companion object {
        const val ACTION_STATE_CHANGED = "com.pulselink.fcmtest.STATE_CHANGED"
        private const val NOTIFICATION_ID = 9001
    }
}

object PulseLinkState {
    const val LATEST_KEY = "latest_notification"
    const val COUNT_KEY = "notification_count"
    const val CHANNEL_ID = "pulselink_events"
    private const val PREFERENCES = "pulselink_fcm_test"

    fun saveNotification(context: Context, display: String) {
        val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
        preferences.edit()
            .putString(LATEST_KEY, display)
            .putInt(COUNT_KEY, preferences.getInt(COUNT_KEY, 0) + 1)
            .apply()
    }

    fun ensureChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                android.app.NotificationChannel(CHANNEL_ID, "PulseLink events", NotificationManager.IMPORTANCE_HIGH),
            )
        }
    }
}
