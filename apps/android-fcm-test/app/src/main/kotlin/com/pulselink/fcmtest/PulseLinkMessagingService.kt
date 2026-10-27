package com.pulselink.fcmtest

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import java.util.concurrent.Executors

class PulseLinkMessagingService : FirebaseMessagingService() {
    private val syncExecutor = Executors.newSingleThreadExecutor()

    @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
    override fun onNewToken(token: String) {
        SecureCredentialStore(this).saveFcmToken(token)
        sendBroadcast(Intent(ACTION_STATE_CHANGED).setPackage(packageName))
        syncExecutor.execute {
            syncTokenWithBoundedRetry()
        }
    }

    override fun onDestroy() {
        syncExecutor.shutdownNow()
        super.onDestroy()
    }

    private fun syncTokenWithBoundedRetry() {
        val sync = InstallationTokenSync(SecureCredentialStore(this))
        var outcome = sync.sync()
        if (outcome == InstallationSyncOutcome.FAILED_RETRYABLE) {
            try {
                Thread.sleep(1_000)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
                return
            }
            outcome = sync.sync()
        }
        // Intentionally no token or credential is logged. The next app/login
        // lifecycle will retry when the outcome is not successful.
        if (outcome == InstallationSyncOutcome.SKIPPED_SESSION_CHANGED) return
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val payload = NotificationPayload.fromData(message.data) ?: return
        if (PulseLinkState.wasAlreadyHandled(this, payload.eventId)) return
        val title = "PulseLink service call"
        val body = "A button event needs your attention"
        PulseLinkState.saveNotification(this, "$title — $body")
        if (!showNotification(title, body, payload)) {
            PulseLinkState.forgetHandled(this, payload.eventId)
        }
        sendBroadcast(Intent(ACTION_STATE_CHANGED).setPackage(packageName))
    }

    private fun showNotification(title: String, body: String, payload: NotificationPayload): Boolean {
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED
        ) return false
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(PulseLinkState.EVENT_ID_EXTRA, payload.eventId)
            putExtra(PulseLinkState.EVENT_TYPE_EXTRA, payload.eventType)
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
        getSystemService(NotificationManager::class.java).notify(
            PulseLinkState.notificationId(payload.eventId),
            notification,
        )
        return true
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
    const val EVENT_ID_EXTRA = "eventId"
    const val EVENT_TYPE_EXTRA = "eventType"
    private const val PREFERENCES = "pulselink_fcm_test"
    private const val HANDLED_EVENTS_KEY = "handled_event_ids"
    private const val MAX_HANDLED_EVENTS = 100

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

    fun wasAlreadyHandled(context: Context, eventId: String): Boolean {
        val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
        val handled = preferences.getStringSet(HANDLED_EVENTS_KEY, emptySet()).orEmpty()
        if (eventId in handled) return true
        val updated = LinkedHashSet(handled)
        updated.add(eventId)
        while (updated.size > MAX_HANDLED_EVENTS) updated.remove(updated.first())
        preferences.edit().putStringSet(HANDLED_EVENTS_KEY, updated).apply()
        return false
    }

    fun forgetHandled(context: Context, eventId: String) {
        val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
        val updated = preferences.getStringSet(HANDLED_EVENTS_KEY, emptySet()).orEmpty().toMutableSet()
        if (updated.remove(eventId)) preferences.edit().putStringSet(HANDLED_EVENTS_KEY, updated).apply()
    }

    fun notificationId(eventId: String): Int {
        return eventId.hashCode() and Int.MAX_VALUE
    }
}
