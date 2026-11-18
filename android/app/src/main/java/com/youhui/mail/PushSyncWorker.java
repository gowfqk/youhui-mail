package com.youhui.mail;

import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.CookieManager;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** Fetches notification details from the user's own mail server after a generic FCM wake signal. */
public final class PushSyncWorker extends Worker {
    public PushSyncWorker(@NonNull Context context, @NonNull WorkerParameters parameters) {
        super(context, parameters);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        if (!PushClient.notificationsEnabled(context)) return Result.success();
        SharedPreferences preferences = PushClient.preferences(context);
        String serverUrl = preferences.getString(PushClient.PREF_SERVER_URL, "");
        if (serverUrl.isEmpty()) return Result.success();

        String cookie;
        try { cookie = CookieManager.getInstance().getCookie(serverUrl); }
        catch (RuntimeException ignored) { return Result.retry(); }
        if (PushClient.sessionCookieValue(cookie).isEmpty()) return Result.success();

        String cursorKey = PushClient.cursorPreferenceKey(serverUrl);
        if (!preferences.contains(cursorKey)) return Result.retry();
        long cursor = Math.max(0, preferences.getLong(cursorKey, 0));
        for (int page = 0; page < 5; page++) {
            if (isStopped()) return Result.success();
            HttpURLConnection connection = null;
            try {
                URL url = new URL(serverUrl + "/api/notifications/events?after=" + cursor);
                connection = (HttpURLConnection) url.openConnection();
                connection.setRequestMethod("GET");
                connection.setConnectTimeout(10_000);
                connection.setReadTimeout(15_000);
                connection.setRequestProperty("Accept", "application/json");
                connection.setRequestProperty("Cache-Control", "no-store");
                connection.setRequestProperty("Cookie", cookie);
                int status = connection.getResponseCode();
                if (status == 401) return Result.success();
                if (status == 408 || status == 429 || status >= 500) return Result.retry();
                if (status < 200 || status >= 300) return Result.success();
                try (InputStream input = connection.getInputStream()) {
                    JSONObject response = new JSONObject(PushClient.readBody(input));
                    JSONArray events = response.optJSONArray("events");
                    if (events == null) events = new JSONArray();
                    for (int index = 0; index < events.length(); index++) {
                        if (isStopped()) return Result.success();
                        JSONObject event = events.optJSONObject(index);
                        if (event != null) PushClient.showMailEvent(context, event);
                    }
                    long nextCursor = Math.max(cursor, response.optLong("cursor", cursor));
                    if (events.length() > 0 && nextCursor <= cursor) return Result.retry();
                    preferences.edit().putLong(cursorKey, nextCursor).apply();
                    cursor = nextCursor;
                    if (events.length() < 50) return Result.success();
                }
            } catch (Exception ignored) {
                return Result.retry();
            } finally {
                if (connection != null) connection.disconnect();
            }
        }
        return Result.retry();
    }
}
