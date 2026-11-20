package com.youhui.mail.ui.detail

import android.content.Intent
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.youhui.mail.util.UrlGuards

private const val EXTERNAL_IMG_ATTR = "data-external-src"

// 图片自适应注入：邮件常见固定宽大图（width="600" 等）超出屏宽时按 100% 缩放并保持比例。
// 纯 CSS 方案，无需并启 JS，不改变现有安全模型。
private const val IMAGE_FIT_CSS = "<style>img{max-width:100%!important;height:auto!important;" +
    "table{max-width:100%!important;}" +
    "video,iframe{max-width:100%!important;}</style>"

private fun hasExternalImages(html: String): Boolean = html.contains("$EXTERNAL_IMG_ATTR=")

/**
 * 邮件正文受限 WebView（设计文档 B4，对齐现有 WebView 版严格配置）：
 * - 禁 JS / 禁 file / 禁混合内容 / 系统信任锚
 * - 远程图默认阻止（data-external-src），用户点击"加载外部图片"后回填 src
 * - 链接：同源 https 内处理，其余外跳系统浏览器
 */
@Composable
fun MailBodyWebView(html: String, text: String, serverUrl: String, modifier: Modifier = Modifier) {
    var loadExternalImages by remember { mutableStateOf(false) }
    var webviewRef by remember { mutableStateOf<WebView?>(null) }

    val rendered = remember(html, loadExternalImages) {
        if (loadExternalImages && html.isNotEmpty()) {
            Regex("$EXTERNAL_IMG_ATTR=\"([^\"]+)\"").replace(html) { match ->
                "src=\"${match.groupValues[1]}\""
            }
        } else {
            html
        }
    }

    fun load(view: WebView) {
        val baseUrl = serverUrl.ifEmpty { "about:blank" }
        if (rendered.isNotEmpty()) {
            // 顶部注入图片自适应 CSS（data-external-src 外链图回填后同样适用）
            view.loadDataWithBaseURL(baseUrl, IMAGE_FIT_CSS + rendered, "text/html", "utf-8", null)
        } else {
            val escaped = text
                .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                .replace("\n", "<br/>")
            view.loadDataWithBaseURL(baseUrl, "<pre style=\"font-family:sans-serif;white-space:pre-wrap;\">$escaped</pre>", "text/html", "utf-8", null)
        }
    }

    Column(modifier) {
        if (html.isNotEmpty() && hasExternalImages(html) && !loadExternalImages) {
            Button(
                onClick = { loadExternalImages = true },
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
            ) { Text("加载外部图片") }
        }
        AndroidView(
            factory = { context ->
                WebView(context).apply {
                    // 正文是消毒后 HTML，无需 JS；如需极少交互再评估开启
                    settings.javaScriptEnabled = false
                    settings.allowFileAccess = false
                    settings.allowContentAccess = true
                    settings.loadsImagesAutomatically = true
                    settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                    settings.mediaPlaybackRequiresUserGesture = true
                    // overview 模式：无 viewport meta 的邮件按屏宽排版（配合图片自适应 CSS）
                    settings.useWideViewPort = true
                    settings.loadWithOverviewMode = true
                    // 手动缩放：双指捏合（隐藏屏幕上的 +/- 按钮），纯原生能力不引入 JS
                    settings.setSupportZoom(true)
                    settings.builtInZoomControls = true
                    settings.displayZoomControls = false
                    webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                            val uri = request.url
                            val scheme = uri.scheme?.lowercase()
                            return if ("https".equals(scheme, true) && UrlGuards.isSameOrigin(serverUrl, uri)) {
                                false // 同源 https 内处理
                            } else if (scheme == "http" || scheme == "https" || scheme == "mailto") {
                                try {
                                    context.startActivity(Intent(Intent.ACTION_VIEW, uri))
                                } catch (ignored: Exception) { }
                                true
                            } else {
                                true // 未知 scheme 一律拦截，不交给 WebView
                            }
                        }
                    }
                    load(this) // 首次内容
                }.also { webviewRef = it }
            },
            modifier = Modifier.fillMaxSize()
        )
        // 内容变化（如用户点击加载外部图片）时重新加载；避免重组时重复加载丢失滚动位置
        LaunchedEffect(rendered, text) {
            webviewRef?.let { load(it) }
        }
    }
}
