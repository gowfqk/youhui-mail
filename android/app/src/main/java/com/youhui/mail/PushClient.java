package com.youhui.mail;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.OutOfQuotaPolicy;
import androidx.work.WorkManager;

import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/** FCM registration and local-only notification presentation. */
public final class PushClient {
    public static final String PREFS = "youhui_android_client";
    public static final String PREF_SERVER_URL = "server_url";
    public static final String PREF_DEVICE_ID = "push_device_id";
    public static final String PREF_FCM_TOKEN = "push_fcm_token";
    public static final String PREF_SESSION_AUTHENTICATED = "push_session_authenticated";

    private static final String CHANNEL_ID = "youhui_mail_new_mail";
    private static final String SYNC_WORK_NAME = "youhui_mail_push_sync";
    private static final int NOTIFICATION_PERMISSION_REQUEST = 4103;
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final ExecutorService IO = Executors.newFixedThreadPool(2);

    private PushClient() { }

    public static boolean isFirebaseConfigured(Context context) {
        try { return !FirebaseApp.getApps(context.getApplicationContext()).isEmpty(); }
        catch (RuntimeException ignored) { return false; }
    }

    public static boolean notificationsEnabled(Context context) {
        if (Build.VERSION.SDK_INT >= 33
                && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        return NotificationManagerCompat.from(context).areNotificationsEnabled();
    }

    public static void requestPermissionAndRegister(Activity activity, String serverUrl) {
        if (!isFirebaseConfigured(activity)) {
            PushDiagnostics.recordFcmToken(activity, "Firebase 未初始化");
            return;
        }
        if (Build.VERSION.SDK_INT >= 33
                && activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            PushDiagnostics.recordFcmToken(activity, "等待通知权限");
            SharedPreferences preferences = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            if (!preferences.getBoolean("push_permission_prompted", false)) {
                preferences.edit().putBoolean("push_permission_prompted", true).apply();
                activity.requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION_REQUEST);
            }
            return;
        }
        enableAndRegister(activity.getApplicationContext(), serverUrl);
    }

    public static int permissionRequestCode() { return NOTIFICATION_PERMISSION_REQUEST; }

    public static void enableAndRegister(Context context, String serverUrl) {
        Context appContext = context.getApplicationContext();
        if (serverUrl == null || serverUrl.isEmpty()) {
            PushDiagnostics.recordFcmToken(appContext, "服务器地址未设置");
            PushDiagnostics.recordRegistration(appContext, "未发送：服务器地址未设置");
            return;
        }
        if (!isFirebaseConfigured(appContext)) {
            PushDiagnostics.recordFcmToken(appContext, "Firebase 未初始化");
            return;
        }
        if (!notificationsEnabled(appContext)) {
            PushDiagnostics.recordFcmToken(appContext, "通知权限未开启");
            PushDiagnostics.recordRegistration(appContext, "未发送：通知未开启");
            return;
        }
        PushDiagnostics.recordFcmToken(appContext, "获取中");
        try {
            FirebaseMessaging messaging = FirebaseMessaging.getInstance();
            messaging.setAutoInitEnabled(true);
            messaging.getToken().addOnSuccessListener(token -> {
                if (token == null || token.isEmpty()) {
                    PushDiagnostics.recordFcmToken(appContext, "未取得 token");
                    PushDiagnostics.recordRegistration(appContext, "未发送：没有 FCM token");
                    return;
                }
                PushDiagnostics.recordFcmToken(appContext, "成功（内容隐藏）");
                preferences(appContext).edit().putString(PREF_FCM_TOKEN, token).apply();
                registerToken(appContext, serverUrl, token);
            }).addOnFailureListener(error -> {
                PushDiagnostics.recordFcmToken(appContext, "获取失败");
                PushDiagnostics.recordRegistration(appContext, "未发送：FCM token 获取失败");
            });
        } catch (RuntimeException ignored) {
            PushDiagnostics.recordFcmToken(appContext, "FCM 初始化失败");
            PushDiagnostics.recordRegistration(appContext, "未发送：FCM token 获取失败");
        }
    }

    public static void registerStoredToken(Context context) {
        Context appContext = context.getApplicationContext();
        String serverUrl = preferences(appContext).getString(PREF_SERVER_URL, "");
        String token = preferences(appContext).getString(PREF_FCM_TOKEN, "");
        if (!serverUrl.isEmpty() && !token.isEmpty()) registerToken(appContext, serverUrl, token);
    }

    private static void registerToken(Context context, String serverUrl, String token) {
        if (!notificationsEnabled(context)) {
            PushDiagnostics.recordRegistration(context, "未发送：通知未开启");
            return;
        }
        MAIN.post(() -> {
            String cookie;
            try { cookie = CookieManager.getInstance().getCookie(serverUrl); }
            catch (RuntimeException ignored) {
                PushDiagnostics.recordCookiePresence(context, false);
                PushDiagnostics.recordRegistration(context, "Cookie 读取失败");
                return;
            }
            String sessionToken = sessionCookieValue(cookie);
            boolean hasSessionCookie = !sessionToken.isEmpty();
            PushDiagnostics.recordCookiePresence(context, hasSessionCookie);
            if (!hasSessionCookie) {
                PushDiagnostics.recordRegistration(context, "未发送：缺少会话 Cookie");
                return;
            }

            SharedPreferences preferences = preferences(context);
            String deviceId = preferences.getString(PREF_DEVICE_ID, "");
            if (deviceId.isEmpty()) {
                deviceId = UUID.randomUUID().toString();
                preferences.edit().putString(PREF_DEVICE_ID, deviceId).apply();
            }
            String sessionHash = sha256(sessionToken);
            String urlKey = sha256(serverUrl);
            String registrationKey = "push_registration:" + urlKey;
            String sessionKey = "push_session:" + urlKey;
            String cursorKey = cursorPreferenceKey(serverUrl);
            String fingerprint = sha256(serverUrl + "\n" + token + "\n" + sessionHash);
            String oldFingerprint = preferences.getString(registrationKey, "");
            String oldSessionHash = preferences.getString(sessionKey, "");
            if (fingerprint.equals(oldFingerprint)) {
                PushDiagnostics.recordRegistration(context, "跳过：本机缓存显示之前登记成功");
                return;
            }
            boolean newSession = !sessionHash.equals(oldSessionHash);
            String finalDeviceId = deviceId;
            PushDiagnostics.recordRegistration(context, "请求发送中");
            IO.execute(() -> postRegistration(context, serverUrl, cookie, finalDeviceId, token,
                    fingerprint, sessionHash, registrationKey, sessionKey, cursorKey, newSession));
        });
    }

    private static void postRegistration(Context context, String serverUrl, String cookie, String deviceId,
                                         String token, String fingerprint, String sessionHash,
                                         String registrationKey, String sessionKey, String cursorKey,
                                         boolean newSession) {
        HttpURLConnection connection = null;
        int responseCode = -1;
        try {
            connection = (HttpURLConnection) new URL(serverUrl + "/api/push/devices").openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(10_000);
            connection.setReadTimeout(10_000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Cookie", cookie);
            JSONObject payload = new JSONObject().put("deviceId", deviceId).put("token", token);
            byte[] bytes = payload.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream output = connection.getOutputStream()) { output.write(bytes); }
            responseCode = connection.getResponseCode();
            PushDiagnostics.recordRegistration(context, "HTTP " + responseCode);
            if (responseCode < 200 || responseCode >= 300) return;
            JSONObject response = new JSONObject(readBody(connection.getInputStream()));
            SharedPreferences preferences = preferences(context);
            SharedPreferences.Editor editor = preferences.edit()
                    .putString(registrationKey, fingerprint)
                    .putString(sessionKey, sessionHash);
            if ((newSession || !preferences.contains(cursorKey)) && response.has("cursor")) {
                editor.putLong(cursorKey, Math.max(0, response.optLong("cursor", 0)));
            }
            editor.apply();
        } catch (Exception ignored) {
            if (responseCode < 0) PushDiagnostics.recordRegistration(context, "网络异常（无 HTTP 状态）");
            else if (responseCode >= 200 && responseCode < 300) {
                PushDiagnostics.recordRegistration(context, "HTTP 成功，但响应处理失败");
            }
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    public static void unregister(Context context, String serverUrl) {
        Context appContext = context.getApplicationContext();
        SharedPreferences preferences = preferences(appContext);
        String urlKey = sha256(serverUrl);
        preferences.edit().remove("push_registration:" + urlKey).apply();
        MAIN.post(() -> {
            String cookie;
            try { cookie = CookieManager.getInstance().getCookie(serverUrl); }
            catch (RuntimeException ignored) { return; }
            if (sessionCookieValue(cookie).isEmpty()) return;
            String deviceId = preferences(appContext).getString(PREF_DEVICE_ID, "");
            if (deviceId.isEmpty()) return;
            IO.execute(() -> {
                HttpURLConnection connection = null;
                try {
                    connection = (HttpURLConnection) new URL(serverUrl + "/api/push/devices/" + deviceId).openConnection();
                    connection.setRequestMethod("DELETE");
                    connection.setConnectTimeout(10_000);
                    connection.setReadTimeout(10_000);
                    connection.setRequestProperty("Accept", "application/json");
                    connection.setRequestProperty("Cookie", cookie);
                    connection.getResponseCode();
                } catch (Exception ignored) { }
                finally { if (connection != null) connection.disconnect(); }
            });
        });
    }

    public static void handleLoggedOut(Context context, String serverUrl) {
        Context appContext = context.getApplicationContext();
        SharedPreferences preferences = preferences(appContext);
        if (serverUrl != null && !serverUrl.isEmpty()) {
            String urlKey = sha256(serverUrl);
            preferences.edit().remove("push_registration:" + urlKey)
                    .remove("push_session:" + urlKey)
                    .remove(cursorPreferenceKey(serverUrl))
                    .remove(PREF_FCM_TOKEN).apply();
        }
        WorkManager.getInstance(appContext).cancelUniqueWork(SYNC_WORK_NAME);
        if (!isFirebaseConfigured(appContext)) return;
        try {
            FirebaseMessaging messaging = FirebaseMessaging.getInstance();
            messaging.setAutoInitEnabled(false);
            messaging.deleteToken();
        } catch (RuntimeException ignored) { }
    }

    public static String cursorPreferenceKey(String serverUrl) {
        return "push_cursor:" + sha256(serverUrl);
    }

    public static void enqueueSync(Context context) {
        Context appContext = context.getApplicationContext();
        if (!notificationsEnabled(appContext)) return;
        Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(PushSyncWorker.class)
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.LINEAR, 15, TimeUnit.SECONDS)
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .build();
        WorkManager.getInstance(appContext).enqueueUniqueWork(SYNC_WORK_NAME, ExistingWorkPolicy.APPEND_OR_REPLACE, request);
    }

    public static void showMailEvent(Context context, JSONObject event) {
        if (!notificationsEnabled(context)) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "邮汇新邮件", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("收到新邮件时提醒；锁屏预览隐藏邮件内容。");
            channel.setLockscreenVisibility(NotificationCompat.VISIBILITY_PRIVATE);
            manager.createNotificationChannel(channel);
        }
        long eventId = Math.max(0, event.optLong("id", event.optLong("eventId", 0)));
        JSONObject account = event.optJSONObject("account");
        JSONObject sender = event.optJSONObject("sender");
        String accountLabel = account == null ? "邮箱" : account.optString("label", "邮箱").trim();
        String senderName = sender == null ? "" : sender.optString("name", "").trim();
        if (senderName.isEmpty() && sender != null) senderName = sender.optString("email", "").trim();
        if (senderName.isEmpty()) senderName = "新邮件";
        String subject = event.optString("subject", "(无主题)").replaceAll("[\\r\\n]+", " ").trim();
        String body = senderName + "：" + subject;
        String code = event.optString("verificationCode", "").trim();
        if (!code.isEmpty() && !"null".equalsIgnoreCase(code)) body += "  验证码：" + code;

        Intent openApp = new Intent(context, MainActivity.class);
        openApp.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(context, 0, openApp,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_mail)
                .setContentTitle("新邮件 · " + (accountLabel.isEmpty() ? "邮箱" : accountLabel))
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setContentIntent(contentIntent)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setCategory(NotificationCompat.CATEGORY_EMAIL)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setPublicVersion(new NotificationCompat.Builder(context, CHANNEL_ID)
                        .setSmallIcon(R.drawable.ic_stat_mail)
                        .setContentTitle("邮汇")
                        .setContentText("你有新邮件，解锁后打开邮汇查看。")
                        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                        .build());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) return;
        NotificationManagerCompat.from(context).notify("youhui-mail:" + eventId, 0, builder.build());
    }

    static SharedPreferences preferences(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static String sessionCookieValue(String cookies) {
        if (cookies == null || cookies.isEmpty()) return "";
        for (String part : cookies.split(";")) {
            String trimmed = part.trim();
            if (trimmed.startsWith("youhui_session=")) return trimmed.substring("youhui_session=".length());
        }
        return "";
    }

    static String readBody(InputStream input) throws Exception {
        StringBuilder body = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) body.append(line);
        }
        return body.toString();
    }

    private static String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder(digest.length * 2);
            for (byte item : digest) result.append(String.format(Locale.ROOT, "%02x", item));
            return result.toString();
        } catch (Exception impossible) { throw new IllegalStateException(impossible); }
    }
}
