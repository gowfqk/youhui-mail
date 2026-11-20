package com.youhui.mail.push

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequest
import androidx.work.WorkManager
import com.youhui.mail.MainActivity
import com.youhui.mail.data.remote.dto.NotificationEventDto
import com.youhui.mail.data.remote.dto.PushDeviceReq
import com.youhui.mail.di.ServiceLocator
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/**
 * FCM 注册与本地通知呈现（移植自 WebView 版 PushClient.java，认证改用 Bearer 令牌）：
 * - FCM 只投递 type=mail.new 的唤醒信号，邮件元数据始终由设备从用户自己的服务器拉取
 * - FCM token 入加密存储（TokenStore）；游标/登记指纹用普通 prefs（按服务器地址哈希分键）
 * - 与 Java 版差异：服务端 FCM 未配置时（登记 503）仍启用 15 分钟周期拉取作为回退
 */
object PushClient {
    private const val CHANNEL_ID = "youhui_mail_new_mail"
    private const val SYNC_WORK_NAME = "youhui_mail_push_sync"
    private const val PERIODIC_WORK_NAME = "youhui_mail_push_periodic"
    internal const val PERMISSION_REQUEST = 4103
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    internal fun prefs(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences("youhui_push", Context.MODE_PRIVATE)

    fun notificationsEnabled(context: Context): Boolean {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return false
        }
        return NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    /** 登录成功后调用：必要时请求通知权限，随后获取 FCM token 并登记设备 + 起周期任务。 */
    fun ensurePush(context: Context, locator: ServiceLocator) {
        val appContext = context.applicationContext
        if (!locator.tokenStore.hasToken) return // 未登录不启用
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(appContext, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            val settings = prefs(appContext)
            if (!settings.getBoolean("permission_prompted", false)) {
                settings.edit().putBoolean("permission_prompted", true).apply()
                if (context is android.app.Activity) {
                    context.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), PERMISSION_REQUEST)
                }
            }
            return
        }
        bootstrap(appContext, locator)
    }

    /** 用户授予/拒绝通知权限后的回调。 */
    fun onPermissionResult(context: Context, locator: ServiceLocator) {
        if (notificationsEnabled(context)) bootstrap(context.applicationContext, locator)
    }

    private fun bootstrap(context: Context, locator: ServiceLocator) {
        if (!notificationsEnabled(context)) return
        val store = locator.tokenStore
        val serverUrl = store.serverUrl ?: return
        if (store.fcmToken.isNullOrBlank()) {
            // 无 google-services.json 时 Firebase 未初始化，静默降级（仅周期拉取也起不来：无 FCM 不登记）
            runCatching {
                val messaging = com.google.firebase.messaging.FirebaseMessaging.getInstance()
                messaging.isAutoInitEnabled = true
                messaging.token.addOnSuccessListener { token ->
                    if (!token.isNullOrBlank()) {
                        store.fcmToken = token
                        scope.launch { registerAndSchedule(context, store, serverUrl, locator) }
                    }
                }
            }
        } else {
            scope.launch { registerAndSchedule(context, store, serverUrl, locator) }
        }
    }

    private suspend fun registerAndSchedule(context: Context, store: com.youhui.mail.data.local.TokenStore, serverUrl: String, locator: ServiceLocator) {
        if (!notificationsEnabled(context)) return
        val fcmToken = store.fcmToken ?: return
        val deviceId = store.deviceId
        val settings = prefs(context)
        val fingerprint = sha256(serverUrl + "\n" + fcmToken + "\n" + (store.token ?: ""))
        val registrationKey = "registration:" + sha256(serverUrl)
        val cursorKey = cursorKey(serverUrl)
        if (settings.getString(registrationKey, "") != fingerprint) {
            // 登记失败（503=服务端 FCM 未配置、网络错误等）均静默：周期拉取仍可作回退
            runCatching {
                val response = locator.api().registerPushDevice(PushDeviceReq(deviceId, fcmToken))
                // 首次登记时以服务器当前游标为基线，避免把历史事件全部提示一遍
                if (!settings.contains(cursorKey)) settings.edit().putLong(cursorKey, response.cursor).apply()
                settings.edit().putString(registrationKey, fingerprint).apply()
            }
        }
        ensureWorkScheduled(context)
    }

    /** FCM 唤醒的一次性同步入队（由 PushMessagingService 调用）。 */
    fun enqueueSync(context: Context) {
        if (!notificationsEnabled(context)) return
        val request = OneTimeWorkRequest.Builder(PushSyncWorker::class.java)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.LINEAR, 15, TimeUnit.SECONDS)
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(SYNC_WORK_NAME, ExistingWorkPolicy.APPEND_OR_REPLACE, request)
    }

    /** 15 分钟周期拉取回退（Java 版无此机制；服务端 FCM 未配置时也能收到通知）。 */
    internal fun ensureWorkScheduled(context: Context) {
        if (!notificationsEnabled(context)) return
        val periodic = PeriodicWorkRequest.Builder(PushSyncWorker::class.java, 15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.LINEAR, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC_WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, periodic)
    }

    fun cursorKey(serverUrl: String): String = "cursor:" + sha256(serverUrl)

    /** 登出：取消任务、吊销设备登记、清本地 FCM 状态。 */
    fun handleLoggedOut(context: Context, locator: ServiceLocator) {
        val appContext = context.applicationContext
        val work = WorkManager.getInstance(appContext)
        work.cancelUniqueWork(SYNC_WORK_NAME)
        work.cancelUniqueWork(PERIODIC_WORK_NAME)
        val serverUrl = locator.tokenStore.serverUrl
        if (!serverUrl.isNullOrBlank()) {
            prefs(appContext).edit()
                .remove("registration:" + sha256(serverUrl))
                .remove(cursorKey(serverUrl))
                .apply()
            // 401 触发的清理时令牌已被清空：不再试图调 unregister（防止再次 401 → 事件循环）
            if (locator.tokenStore.hasToken) {
                scope.launch {
                    runCatching { locator.api().unregisterPushDevice(locator.tokenStore.deviceId) }
                }
            }
        }
        locator.tokenStore.fcmToken = null
        // 会话失效也清空离线缓存（登出/换号不留数据）
        scope.launch { runCatching { locator.mailCache.wipeAll() } }
        runCatching {
            with(com.google.firebase.messaging.FirebaseMessaging.getInstance()) {
                isAutoInitEnabled = false
                deleteToken()
            }
        }
    }

    /** 本地通知（对齐 Java 版样式：锁屏公开版不含邮件内容）。 */
    fun showMailEvent(context: Context, event: NotificationEventDto) {
        if (!notificationsEnabled(context)) return
        if (Build.VERSION.SDK_INT >= 26) {
            (context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager)?.let { manager ->
                val channel = NotificationChannel(CHANNEL_ID, "邮汇新邮件", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "收到新邮件时提醒；锁屏预览隐藏邮件内容。"
                    lockscreenVisibility = NotificationCompat.VISIBILITY_PRIVATE
                }
                manager.createNotificationChannel(channel)
            }
        }
        val eventId = if (event.id > 0) event.id else event.eventId
        if (eventId <= 0) return
        val accountLabel = event.account?.label?.trim().orEmpty().ifBlank { "邮箱" }
        var senderName = event.sender?.name?.trim().orEmpty()
        if (senderName.isBlank()) senderName = event.sender?.email?.trim().orEmpty()
        if (senderName.isBlank()) senderName = "新邮件"
        val subject = (event.subject ?: "(无主题)").replace(Regex("[\\r\\n]+"), " ").trim()
        var body = "$senderName：$subject"
        val code = event.verificationCode?.trim().orEmpty()
        if (code.isNotBlank() && !code.equals("null", ignoreCase = true)) body += "  验证码：$code"

        val openApp = android.content.Intent(context, MainActivity::class.java).apply {
            addFlags(android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP or android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
        val contentIntent = PendingIntent.getActivity(context, 0, openApp, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(com.youhui.mail.R.drawable.ic_stat_mail)
            .setContentTitle("新邮件 · $accountLabel")
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(contentIntent)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_EMAIL)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(
                NotificationCompat.Builder(context, CHANNEL_ID)
                    .setSmallIcon(com.youhui.mail.R.drawable.ic_stat_mail)
                    .setContentTitle("邮汇")
                    .setContentText("你有新邮件，解锁后打开邮汇查看。")
                    .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                    .build()
            )
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        NotificationManagerCompat.from(context).notify("youhui-mail:$eventId", 0, builder.build())
    }

    private fun sha256(value: String): String =
        MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
}
