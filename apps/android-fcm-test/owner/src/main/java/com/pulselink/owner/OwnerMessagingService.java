package com.pulselink.owner;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class OwnerMessagingService extends FirebaseMessagingService {
    private static final String CHANNEL_ID = "pulselink_owner_events";
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @Override public void onCreate() {
        super.onCreate();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getSystemService(NotificationManager.class).createNotificationChannel(
                    new NotificationChannel(CHANNEL_ID, "PulseLink service calls", NotificationManager.IMPORTANCE_HIGH));
        }
    }

    @Override public void onNewToken(String token) {
        SecureSession session = new SecureSession(this);
        session.saveFcmToken(token);
        registerIfSignedIn(session, token);
    }

    @Override public void onMessageReceived(RemoteMessage message) {
        String eventId = message.getData().get("eventId");
        if (eventId == null || eventId.isBlank()) return;
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) return;
        Intent intent = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pending = PendingIntent.getActivity(this, eventId.hashCode(), intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL_ID) : new Notification.Builder(this);
        Notification notification = builder.setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("PulseLink service call")
                .setContentText("A button event needs your attention")
                .setAutoCancel(true).setContentIntent(pending).build();
        getSystemService(NotificationManager.class).notify(eventId.hashCode() & 0x7fffffff, notification);
    }

    @Override public void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }

    private void registerIfSignedIn(SecureSession session, String token) {
        if (session.accessToken() == null) return;
        executor.execute(() -> {
            try { OwnerPushRegistration.sync(session, token); }
            catch (Exception ignored) { /* The next token refresh or Owner sign-in retries without logging credentials. */ }
        });
    }
}
