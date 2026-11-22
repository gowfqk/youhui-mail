package com.youhui.mail.data.remote

import com.youhui.mail.data.local.TokenStore
import com.youhui.mail.data.local.UnauthorizedBus
import okhttp3.Authenticator
import okhttp3.Request
import okhttp3.Response
import okhttp3.Route

/**
 * 401 处理：清除本地令牌并通知 UI 回到登录页（设计文档 A1.5）。
 * 不自动重试（避免用失效凭据死循环）；刷新逻辑由用户重新登录完成。
 */
class TokenAuthenticator(private val tokenStore: TokenStore) : Authenticator {
    override fun authenticate(route: Route?, response: Response): Request? {
        if (response.code != 401) return null
        tokenStore.clearSession()
        UnauthorizedBus.emit()
        return null
    }
}
