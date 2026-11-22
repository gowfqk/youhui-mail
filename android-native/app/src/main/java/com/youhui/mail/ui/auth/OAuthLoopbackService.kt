package com.youhui.mail.ui.auth

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.youhui.mail.util.t

/**
 * OAuth 回环登录期间的前台服务：在用户离开 App 去浏览器完成第三方登录的窗口内
 * 保持进程存活，避免进程被系统冻结或 OEM 后台管控杀死导致 127.0.0.1 回环监听失效
 * （表现为回调页直接“网络错误”，无法返回 App）。
 * 由 OAuthLoopback.login 在启动浏览器前 start()，在 finally 中 stop()。
 */
class OAuthLoopbackService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startInForeground()
        return START_NOT_STICKY
    }

    private fun startInForeground() {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "第三方登录", NotificationManager.IMPORTANCE_LOW)
            )
        }
        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("邮汇")
            .setContentText(t("正在等待第三方登录回调…"))
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    companion object {
        private const val CHANNEL_ID = "youhui_oauth_loopback"
        private const val NOTIFICATION_ID = 2101

        fun start(context: Context) {
            context.startForegroundService(Intent(context, OAuthLoopbackService::class.java))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, OAuthLoopbackService::class.java))
        }
    }
}
