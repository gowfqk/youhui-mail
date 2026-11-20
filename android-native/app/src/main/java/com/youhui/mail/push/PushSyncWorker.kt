package com.youhui.mail.push

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.youhui.mail.YouhuiApplication

/**
 * 拉取通知详情（移植自 WebView 版 PushSyncWorker.java）：
 * - 凭 Bearer 令牌（无 Cookie）；401 静默结束（等重新登录后 Worker 会跳过）
 * - 游标存于 youhui_push prefs（按服务器地址哈希分键）；每轮最多 5 页
 * - 服务端 5xx/网络失败 → retry；详情只在本地生成通知
 */
class PushSyncWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {

    override suspend fun doWork(): Result {
        val context = applicationContext
        if (!PushClient.notificationsEnabled(context)) return Result.success()
        val locator = (context as? YouhuiApplication)?.serviceLocator ?: return Result.success()
        val store = locator.tokenStore
        val serverUrl = store.serverUrl ?: return Result.success()
        if (!store.hasToken) return Result.success() // 无会话：静默结束，等下次登录

        val settings = PushClient.prefs(context)
        val cursorKey = PushClient.cursorKey(serverUrl)
        if (!settings.contains(cursorKey)) return Result.retry()
        var cursor = Math.max(0L, settings.getLong(cursorKey, 0L))

        var pages: Byte = 0
        while (pages < 5) {
            if (isStopped) return Result.success()
            pages++
            val response = try {
                locator.api().events(after = cursor)
            } catch (error: retrofit2.HttpException) {
                return when (error.code()) {
                    401 -> Result.success()
                    408, 429 -> Result.retry()
                    in 500..599 -> Result.retry()
                    else -> Result.success()
                }
            } catch (error: java.io.IOException) {
                return Result.retry()
            }
            for (event in response.events) {
                if (isStopped) return Result.success()
                PushClient.showMailEvent(context, event)
            }
            val nextCursor = Math.max(cursor, response.cursor)
            if (response.events.isNotEmpty() && nextCursor <= cursor) return Result.retry()
            settings.edit().putLong(cursorKey, nextCursor).apply()
            cursor = nextCursor
            if (response.events.size < 50) return Result.success()
        }
        return Result.retry()
    }
}
