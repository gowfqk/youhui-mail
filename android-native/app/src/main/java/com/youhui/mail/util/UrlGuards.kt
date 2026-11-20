package com.youhui.mail.util

import android.net.Uri
import java.net.URI
import java.util.Locale

/**
 * 服务端地址规范化：移植自现有 WebView 版 MainActivity.normalizeServerUrl（android/app/.../MainActivity.java:540）。
 * 仅接受 HTTPS 根地址（可带端口），拒绝 userinfo / query / fragment / 路径。
 */
object UrlGuards {
    fun normalizeServerUrl(raw: String?): String? {
        if (raw.isNullOrBlank()) return null
        var value = raw.trim()
        if (value.isEmpty() || value.any { it.isWhitespace() }) return null
        if (!value.contains("://")) value = "https://$value"
        return try {
            val uri = URI(value).normalize()
            if (!"https".equals(uri.scheme, ignoreCase = true)) return null
            val host = uri.host?.lowercase(Locale.ROOT)
            if (host.isNullOrEmpty()) return null
            if (uri.userInfo != null || uri.rawQuery != null || uri.rawFragment != null) return null
            val path = uri.rawPath
            if (!path.isNullOrEmpty() && path != "/") return null
            val port = uri.port
            if (port < -1 || port > 65535) return null
            "https://" + host + if (port == -1 || port == 443) "" else ":$port"
        } catch (ignored: Exception) {
            null
        }
    }

    /** 从规范化地址提取主机名（用于展示与同源判断）。 */
    fun serverHost(serverUrl: String): String? = try {
        URI(serverUrl).host
    } catch (ignored: Exception) {
        null
    }

    /** 判断目标是否与服务器同源（WebView 外链放行判断用）。 */
    fun isSameOrigin(serverUrl: String, target: Uri): Boolean {
        return try {
            val base = URI(serverUrl)
            "https".equals(target.scheme, ignoreCase = true) &&
                base.host.equals(target.host, ignoreCase = true) &&
                (base.port == -1 || base.port == if (target.port == -1) 443 else target.port)
        } catch (ignored: Exception) {
            false
        }
    }
}
