package com.youhui.mail.data.repository

import com.youhui.mail.data.local.TokenStore
import com.youhui.mail.data.remote.YouhuiApi
import com.youhui.mail.data.remote.dto.MobileLoginReq
import com.youhui.mail.data.remote.dto.SessionsDto
import com.youhui.mail.data.remote.dto.StatusDto
import com.youhui.mail.data.remote.dto.TokenDto
import com.youhui.mail.data.remote.dto.OkDto
import retrofit2.HttpException
import java.io.IOException

/** 密码登录 / 会话管理（设计文档 A1）。 */
class AuthRepository(private val api: YouhuiApi, private val tokenStore: TokenStore) {

    suspend fun status(): StatusDto = api.status()

    suspend fun loginWithPassword(password: String): TokenDto {
        val result = api.mobileLogin(
            MobileLoginReq(
                password = password,
                deviceId = tokenStore.deviceId,
                deviceLabel = tokenStore.deviceLabel
            )
        )
        tokenStore.setSession(result.token, result.expiresAt)
        return result
    }

    suspend fun listSessions(): SessionsDto = api.sessions()

    suspend fun revokeSession(deviceId: String): OkDto = api.revokeSession(deviceId)

    suspend fun logout(): OkDto {
        // 登出 = 吊销本设备的全部移动端会话（push_devices 随外键级联清理），再清除本地令牌
        val result = try {
            api.revokeSession(tokenStore.deviceId)
        } catch (ignored: Exception) {
            null
        }
        tokenStore.clearSession()
        return result ?: OkDto(ok = true)
    }
}

/** 统一把网络异常转成用户可读消息（对齐服务端 safeError 中文风格）。 */
fun Throwable.toUserMessage(): String = when (this) {
    is HttpException -> when (code()) {
        401 -> "登录已过期，请重新解锁。"
        403 -> "请求被拒绝，请检查身份绑定状态。"
        404 -> "资源不存在，可能已被移走或删除。"
        429 -> "尝试次数过多，请 15 分钟后再试。"
        in 500..599 -> "服务器遇到问题，请稍后重试。"
        else -> "请求失败（HTTP ${code()}）。"
    }
    is IOException -> "网络连接失败，请检查网络后重试。"
    else -> localizedMessage ?: "发生未知错误。"
}
