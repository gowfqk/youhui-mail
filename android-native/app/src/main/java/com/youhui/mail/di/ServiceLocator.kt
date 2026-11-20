package com.youhui.mail.di

import android.content.Context
import com.youhui.mail.data.local.TokenStore
import com.youhui.mail.data.local.cache.MailCacheDatabase
import com.youhui.mail.data.local.cache.MailCacheRepository
import com.youhui.mail.data.remote.ApiClient
import com.youhui.mail.data.remote.YouhuiApi
import com.youhui.mail.data.repository.AuthRepository
import com.youhui.mail.data.repository.MailRepository

/** 手写服务容器（单模块规模不引入 Hilt，依赖图简单清晰）。 */
class ServiceLocator(context: Context) {

    val tokenStore: TokenStore = TokenStore(context.applicationContext)

    /** 离线缓存（列表/详情）；登出/换服务器时 wipeAll。 */
    val mailCache: MailCacheRepository by lazy {
        MailCacheRepository(MailCacheDatabase.get(context.applicationContext).dao())
    }

    @Volatile
    private var cachedApi: YouhuiApi? = null
    @Volatile
    private var cachedServerUrl: String? = null

    fun api(): YouhuiApi {
        val url = tokenStore.serverUrl ?: throw IllegalStateException("尚未配置服务器地址。")
        if (cachedApi == null || cachedServerUrl != url) {
            synchronized(this) {
                if (cachedApi == null || cachedServerUrl != url) {
                    cachedApi = ApiClient.create(url, tokenStore)
                    cachedServerUrl = url
                }
            }
        }
        return cachedApi!!
    }

    fun authRepository(): AuthRepository = AuthRepository(api(), tokenStore)

    fun mailRepository(): MailRepository = MailRepository(api())
}
