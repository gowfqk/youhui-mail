package com.youhui.mail.data.remote

import com.youhui.mail.data.local.TokenStore
import okhttp3.Interceptor
import okhttp3.Response

/** 为所有 API 请求注入 Authorization: Bearer（设计文档 A1.5）。 */
class AuthInterceptor(private val tokenStore: TokenStore) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val token = tokenStore.token
        val newRequest = if (!token.isNullOrBlank()) {
            request.newBuilder().header("Authorization", "Bearer $token").build()
        } else {
            request
        }
        return chain.proceed(newRequest)
    }
}
