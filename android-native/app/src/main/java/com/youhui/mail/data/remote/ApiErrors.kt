package com.youhui.mail.data.remote

import kotlinx.coroutines.Dispatchers
import retrofit2.HttpException
import com.youhui.mail.data.repository.toUserMessage
import kotlinx.coroutines.withContext

/**
 * 优先采用服务端 { error } 文案（AI / MCP 等接口会给出具体原因），
 * 无法解析时回退到通用错误提示。
 */
suspend fun Throwable.readableMessage(): String {
    if (this is HttpException) {
        val body = runCatching {
            withContext(Dispatchers.IO) { response()?.errorBody()?.string() }
        }.getOrNull()
        val parsed = body?.let { parseApiError(it) }
        if (!parsed.isNullOrBlank()) return parsed
    }
    if (this is java.net.SocketTimeoutException) {
        return "等待服务器响应超时。模型服务响应较慢时可稍等片刻再重试；若持续超时，请检查服务器到模型服务的网络。"
    }
    return toUserMessage()
}