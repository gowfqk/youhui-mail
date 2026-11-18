package com.youhui.mail;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

/** Receives only generic wake signals; mail metadata is fetched separately from the user's server. */
public final class PushMessagingService extends FirebaseMessagingService {
    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        PushDiagnostics.recordFcmToken(getApplicationContext(), "成功（内容隐藏）");
        PushClient.preferences(getApplicationContext())
                .edit().putString(PushClient.PREF_FCM_TOKEN, token).apply();
        PushClient.registerStoredToken(getApplicationContext());
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        if ("mail.new".equals(message.getData().get("type"))) {
            PushClient.enqueueSync(getApplicationContext());
        }
    }

    @Override
    public void onDeletedMessages() {
        PushClient.enqueueSync(getApplicationContext());
    }
}
