package com.youhui.mail.data.remote

import com.youhui.mail.data.local.TokenStore
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory

/** Retrofit/OkHttp 组装：JSON 容错解析 + Bearer 注入 + 401 处理。 */
object ApiClient {

    fun create(serverUrl: String, tokenStore: TokenStore): YouhuiApi {
        val json = Json {
            ignoreUnknownKeys = true
            coerceInputValues = true
            explicitNulls = false
        }
        val client = OkHttpClient.Builder()
            .connectTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
            .readTimeout(20, java.util.concurrent.TimeUnit.SECONDS)
            .writeTimeout(60, java.util.concurrent.TimeUnit.SECONDS)
            .addInterceptor(TimeoutInterceptor())
            .addInterceptor(AuthInterceptor(tokenStore))
            .authenticator(TokenAuthenticator(tokenStore))
            .build()
        return Retrofit.Builder()
            .baseUrl("$serverUrl/")
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(YouhuiApi::class.java)
    }
}
