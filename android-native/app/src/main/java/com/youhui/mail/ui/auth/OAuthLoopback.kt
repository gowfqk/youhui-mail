package com.youhui.mail.ui.auth

import android.content.ActivityNotFoundException
import android.content.Context
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import com.youhui.mail.data.remote.dto.ExchangeReq
import com.youhui.mail.di.ServiceLocator
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeout
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.InetAddress
import java.net.ServerSocket
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/**
 * 第三方身份 OAuth 回环登录（设计文档 A3，RFC 8252 + PKCE S256）：
 * 1. 生成本地回环监听（系统分配端口，127.0.0.1 明文已被 network_security_config 放行）
 * 2. GET /api/mobile/identity/:provider/start（redirect_uri/state/code_challenge）→ 拿 Provider 授权页
 * 3. Custom Tabs 打开授权页；服务端验证身份后 302 回回环地址（一次性 code + deviceState）
 * 4. 校验 state → POST /api/mobile/oauth/exchange（code + code_verifier）→ 换移动端会话
 */
object OAuthLoopback {

    private const val TIMEOUT_MS = 5 * 60_000L

    /** 执行完整流程；成功返回会话类型（"mobile"）。失败抛出中文可读异常。 */
    suspend fun login(context: Context, locator: ServiceLocator, provider: String): String {
        val store = locator.tokenStore
        val verifier = randomUrlSafe(48)
        val challenge = Base64.getUrlEncoder().withoutPadding()
            .encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)))
        val deviceState = randomUrlSafe(16)

        val server = ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"))
        val redirectUri = "http://127.0.0.1:${server.localPort}/callback"
        val callback = CompletableDeferred<Uri>()

        // 回环接收线程：把第一个含 code 的 GET /callback 上报，并回一份静态完成页。
        // soTimeout 的 3 秒是预期内的轮询超时（用于周期性检查回调是否已完成），
        // 必须继续循环而不是退出——否则监听在启动 3 秒后就无人 accept，
        // 浏览器的回调连接会一直挂在 TCP 握手上，用户停留在回调页无法返回 App。
        val acceptThread = Thread {
            try {
                server.soTimeout = 3_000
                while (!callback.isCompleted) {
                    val socket = try {
                        server.accept()
                    } catch (timeout: java.net.SocketTimeoutException) {
                        continue
                    } catch (ignored: Exception) {
                        break // server 被 finally 关闭等真实错误
                    }
                    runCatching {
                        socket.use { s ->
                            val reader = BufferedReader(InputStreamReader(s.getInputStream(), Charsets.US_ASCII))
                            val requestLine = reader.readLine() ?: return@use
                            val target = requestLine.split(" ").getOrNull(1) ?: return@use
                            val uri = Uri.parse("http://127.0.0.1$target")
                            val page = if (uri.getQueryParameter("error") != null || uri.getQueryParameter("code") != null) {
                                "<html><body style='font-family:sans-serif;text-align:center;padding-top:48px'><h3>登录已处理</h3><p>请返回邮汇 App 继续。</p></body></html>"
                            } else {
                                "<html><body style='font-family:sans-serif'></body></html>"
                            }
                            val bytes = page.toByteArray(Charsets.UTF_8)
                            s.getOutputStream().apply {
                                write("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray(Charsets.US_ASCII))
                                write(bytes)
                                flush()
                            }
                            if (uri.path == "/callback") callback.complete(uri)
                        }
                    }
                }
            } catch (ignored: Exception) {
                // 服务器被 finally 关闭时退出
            }
        }
        acceptThread.isDaemon = true
        acceptThread.start()

        try {
            val start = locator.api().oauthStart(
                provider = provider,
                redirectUri = redirectUri,
                state = deviceState,
                codeChallenge = challenge,
                method = "S256"
            )
            try {
                CustomTabsIntent.Builder().build().launchUrl(context, Uri.parse(start.url))
            } catch (e: ActivityNotFoundException) {
                throw IllegalStateException("未找到可用的浏览器，无法完成第三方登录。", e)
            }
            val returned = withTimeout(TIMEOUT_MS) { callback.await() }
            val error = returned.getQueryParameter("error")
            if (!error.isNullOrBlank()) throw IllegalStateException("第三方登录失败：${error.take(80)}")
            val code = returned.getQueryParameter("code")
            if (code.isNullOrBlank()) throw IllegalStateException("回调缺少授权码，请重试。")
            val state = returned.getQueryParameter("state").orEmpty()
            if (state != deviceState) throw IllegalStateException("state 校验失败，请重新登录。")

            val token = locator.api().oauthExchange(
                ExchangeReq(
                    code = code,
                    codeVerifier = verifier,
                    deviceId = store.deviceId,
                    deviceLabel = store.deviceLabel
                )
            )
            store.setSession(token.token, token.expiresAt)
            return token.session?.kind ?: "mobile"
        } finally {
            server.close()
        }
    }

    private fun randomUrlSafe(bytes: Int): String {
        val raw = ByteArray(bytes).also { SecureRandom().nextBytes(it) }
        return Base64.getUrlEncoder().withoutPadding().encodeToString(raw)
    }
}
