package com.youhui.mail.data.remote

import okhttp3.Interceptor
import okhttp3.Response
import java.util.concurrent.TimeUnit

/**
 * 长耗时接口标记：AI 对话 / 摘要由服务端调用模型（服务端自身超时 90 秒），
 * 客户端默认 10 秒读超时会先断开，导致网页端可用、App 端失败。
 */
data class LongRunning(val readSeconds: Int = 150)

/** 按调用标记调整读超时，不影响普通接口与后台轮询。 */
class TimeoutInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val tag = chain.request().tag(LongRunning::class.java) ?: return chain.proceed(chain.request())
        return chain.withReadTimeout(tag.readSeconds, TimeUnit.SECONDS).proceed(chain.request())
    }
}