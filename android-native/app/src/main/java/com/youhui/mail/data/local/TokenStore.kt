package com.youhui.mail.data.local

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import java.util.UUID

/**
 * 令牌与服务器地址存储：
 * - 令牌（Bearer）存 EncryptedSharedPreferences（AES256-GCM，密钥在 Android Keystore）
 * - 非敏感偏好（服务器地址）存普通 SharedPreferences
 * 两类文件均已排除 Auto Backup（见 backup_rules.xml）。
 */
class TokenStore(context: Context) {

    private val prefs: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context, "youhui_secure_prefs", masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    private val plain: SharedPreferences by lazy {
        context.getSharedPreferences("youhui_prefs", Context.MODE_PRIVATE)
    }

    var serverUrl: String?
        get() = plain.getString(KEY_SERVER_URL, null)
        set(value) = plain.edit().putString(KEY_SERVER_URL, value).apply()

    var token: String?
        get() = prefs.getString(KEY_TOKEN, null)
        set(value) = prefs.edit().putString(KEY_TOKEN, value).apply()

    var tokenExpiresAt: Long
        get() = prefs.getLong(KEY_EXPIRES, 0L)
        set(value) = prefs.edit().putLong(KEY_EXPIRES, value).apply()

    /** FCM 设备令牌（推送）；与 Bearer 同存加密 prefs。 */
    var fcmToken: String?
        get() = prefs.getString(KEY_FCM_TOKEN, null)
        set(value) {
            if (value.isNullOrBlank()) prefs.edit().remove(KEY_FCM_TOKEN).apply()
            else prefs.edit().putString(KEY_FCM_TOKEN, value).apply()
        }

    val deviceId: String by lazy {
        prefs.getString(KEY_DEVICE_ID, null) ?: UUID.randomUUID().toString().also {
            prefs.edit().putString(KEY_DEVICE_ID, it).apply()
        }
    }

    var deviceLabel: String
        get() = prefs.getString(KEY_DEVICE_LABEL, null) ?: android.os.Build.MODEL.ifBlank { "Android 设备" }
        set(value) = prefs.edit().putString(KEY_DEVICE_LABEL, value).apply()

    val hasToken: Boolean get() = !token.isNullOrBlank() && tokenExpiresAt > System.currentTimeMillis()

    /** 会话有效性状态流：UI 据此驱动登录/主界面路由。 */
    val sessionState: kotlinx.coroutines.flow.StateFlow<Boolean> = kotlinx.coroutines.flow.MutableStateFlow(hasToken)

    fun setSession(tokenValue: String, expiresAt: Long) {
        prefs.edit().putString(KEY_TOKEN, tokenValue).putLong(KEY_EXPIRES, expiresAt).apply()
        (sessionState as kotlinx.coroutines.flow.MutableStateFlow<Boolean>).value = expiresAt > System.currentTimeMillis()
    }

    fun clearSession() {
        prefs.edit().remove(KEY_TOKEN).remove(KEY_EXPIRES).apply()
        (sessionState as kotlinx.coroutines.flow.MutableStateFlow<Boolean>).value = false
    }

    fun clearAll() {
        clearSession()
        plain.edit().remove(KEY_SERVER_URL).apply()
    }

    companion object {
        private const val KEY_SERVER_URL = "server_url"
        private const val KEY_TOKEN = "bearer_token"
        private const val KEY_EXPIRES = "token_expires_at"
        private const val KEY_FCM_TOKEN = "fcm_token"
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_DEVICE_LABEL = "device_label"
    }
}

/** 401 失效事件总线：TokenAuthenticator 触发，UI 收集后回到登录页。 */
object UnauthorizedBus {
    private val _events = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val events: SharedFlow<Unit> = _events
    fun emit() { _events.tryEmit(Unit) }
}
