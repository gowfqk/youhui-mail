package com.youhui.mail;

import android.content.Context;
import android.content.SharedPreferences;

import java.text.DateFormat;
import java.util.Date;

/** Stores and presents only non-sensitive push-registration status. */
public final class PushDiagnostics {
    private static final String KEY_PROBE = "push_diag_probe";
    private static final String KEY_FCM = "push_diag_fcm";
    private static final String KEY_COOKIE = "push_diag_cookie";
    private static final String KEY_REGISTRATION = "push_diag_registration";
    private static final String KEY_UPDATED = "push_diag_updated";

    private PushDiagnostics() { }

    private static SharedPreferences preferences(Context context) {
        return context.getApplicationContext().getSharedPreferences(PushClient.PREFS, Context.MODE_PRIVATE);
    }

    private static void put(Context context, String key, String value) {
        preferences(context).edit()
                .putString(key, value)
                .putLong(KEY_UPDATED, System.currentTimeMillis())
                .apply();
    }

    public static void recordSessionProbe(Context context, String status) {
        String safeStatus;
        if (status != null && status.matches("[0-9]{3}")) safeStatus = "HTTP " + status;
        else if ("network".equals(status)) safeStatus = "网络异常";
        else safeStatus = "未知结果";
        put(context, KEY_PROBE, safeStatus);
    }

    public static void recordFcmToken(Context context, String status) {
        if ("获取中".equals(status) || "成功（内容隐藏）".equals(status)
                || "获取失败".equals(status) || "等待通知权限".equals(status)
                || "通知权限未开启".equals(status) || "Firebase 未初始化".equals(status)
                || "等待会话验证".equals(status) || "服务器地址未设置".equals(status)
                || "FCM 初始化失败".equals(status) || "未取得 token".equals(status)) {
            put(context, KEY_FCM, status);
        } else {
            put(context, KEY_FCM, "未知状态");
        }
    }

    public static void recordCookiePresence(Context context, boolean present) {
        put(context, KEY_COOKIE, present ? "存在" : "不存在");
    }

    public static void recordRegistration(Context context, String status) {
        if (status != null && status.matches("HTTP [1-5][0-9]{2}")) {
            put(context, KEY_REGISTRATION, status);
            return;
        }
        if ("尚未发送".equals(status) || "请求发送中".equals(status)
                || "网络异常（无 HTTP 状态）".equals(status)
                || "Cookie 读取失败".equals(status)
                || "未发送：缺少会话 Cookie".equals(status)
                || "未发送：没有 FCM token".equals(status)
                || "未发送：通知未开启".equals(status)
                || "未发送：FCM token 获取失败".equals(status)
                || "未发送：服务器地址未设置".equals(status)
                || "跳过：本机缓存显示之前登记成功".equals(status)
                || "HTTP 成功，但响应处理失败".equals(status)) {
            put(context, KEY_REGISTRATION, status);
        } else {
            put(context, KEY_REGISTRATION, "未知状态");
        }
    }

    public static void reset(Context context) {
        preferences(context).edit()
                .remove(KEY_PROBE)
                .remove(KEY_FCM)
                .remove(KEY_COOKIE)
                .remove(KEY_REGISTRATION)
                .remove(KEY_UPDATED)
                .apply();
    }

    public static String format(Context context) {
        SharedPreferences prefs = preferences(context);
        String probe = prefs.getString(KEY_PROBE, "尚未检查");
        String fcm = prefs.getString(KEY_FCM, "尚未获取");
        String cookie = prefs.getString(KEY_COOKIE, "未检查");
        String registration = prefs.getString(KEY_REGISTRATION, "尚未发送");
        long updated = prefs.getLong(KEY_UPDATED, 0);
        String updatedText = updated == 0 ? "无" : DateFormat.getDateTimeInstance(
                DateFormat.SHORT, DateFormat.MEDIUM).format(new Date(updated));
        return "会话探测：" + probe
                + "\nFirebase token 获取：" + fcm
                + "\n会话 Cookie：" + cookie
                + "\n设备登记：" + registration
                + "\n最近更新：" + updatedText
                + "\n\n本面板只显示状态；Cookie、设备令牌及邮件内容均不显示。";
    }
}
