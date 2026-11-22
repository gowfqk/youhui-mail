package com.youhui.mail.util

import android.content.Context

/**
 * 轻量 i18n：zh 为默认语言，键为中文原文（与 Compose 界面中的字面量逐字一致）。
 * 语言偏好存 SharedPreferences；由 MainActivity 在 attachBaseContext 中应用，
 * 切换后 recreate() 生效。
 */
object I18n {

    const val LANG_KEY = "youhui_lang"
    const val ZH = "zh"
    const val EN = "en"

    var lang: String = ZH
        private set

    fun init(context: Context) {
        val prefs = context.getSharedPreferences("youhui_i18n", Context.MODE_PRIVATE)
        val system = context.resources.configuration.locales[0].language
        lang = prefs.getString(LANG_KEY, null)
            ?: if (system.startsWith("zh")) ZH else EN
    }

    fun setLang(context: Context, value: String) {
        lang = value
        context.getSharedPreferences("youhui_i18n", Context.MODE_PRIVATE)
            .edit().putString(LANG_KEY, value).apply()
    }

    /** 翻译：en 模式查词典（未命中回落原文），zh 模式原样返回。 */
    fun t(zh: String): String = if (lang == EN) enMap[zh] ?: zh else zh

    private val enMap: Map<String, String> = mapOf(
        // ---- 登录 ----
        "解锁邮箱工作台" to "Unlock mail workbench",
        "工作台密码" to "Workbench password",
        "正在解锁…" to "Unlocking…",
        "解锁" to "Unlock",
        "或使用已绑定的身份登录" to "Or sign in with a linked identity",
        "跳转中…" to "Opening…",
        "需先在网页版工作台“设置”中绑定对应身份。" to "Link the identity in the web workbench settings first.",
        "更换服务器地址" to "Change server address",
        // ---- 服务器设置 ----
        "邮汇服务器地址" to "Youhui server address",
        "必须使用 HTTPS 根地址" to "HTTPS root URL required",
        "保存并继续" to "Save & continue",
        "地址无效，请输入 HTTPS 根地址。" to "Invalid address — enter an HTTPS root URL.",
        // ---- 邮件列表 / 详情 ----
        "收件箱" to "Inbox",
        "已加星标" to "Starred",
        "已发送" to "Sent",
        "草稿" to "Drafts",
        "归档" to "Archive",
        "垃圾邮件" to "Spam",
        "已删除" to "Trash",
        "未知发件人" to "Unknown sender",
        "(无主题)" to "(no subject)",
        "搜索邮件、发件人…" to "Search mail, senders…",
        "写邮件" to "Compose",
        "发送" to "Send",
        "正在发送…" to "Sending…",
        "邮件已发送。" to "Message sent.",
        "回复" to "Reply",
        "收件人" to "To",
        "抄送" to "Cc",
        "主题" to "Subject",
        "正文" to "Body",
        "＋ 添加附件" to "＋ Add attachment",
        "移除" to "Remove",
        "已标为已读" to "Marked as read",
        "已标为未读" to "Marked as unread",
        "已加星标" to "Starred",
        "已取消星标" to "Star removed",
        "邮件已归档" to "Message archived",
        "邮件已移到垃圾箱" to "Message moved to Trash",
        "移到垃圾箱" to "Move to Trash",
        "归档这封邮件？" to "Archive this message?",
        "移到垃圾箱？" to "Move to Trash?",
        "确认" to "Confirm",
        "取消" to "Cancel",
        "加载外部图片" to "Load remote images",
        "加载后，图片来源网站可能获知你的 IP 地址和访问时间。" to "After loading, the image host may learn your IP address and visit time.",
        "选一封邮件开始阅读" to "Select a message to start reading",
        "邮件读取失败" to "Failed to load message",
        "返回" to "Back",
        // ---- 设置 ----
        "设置" to "Settings",
        "邮箱账户" to "Mailboxes",
        "添加邮箱" to "Add mailbox",
        "移除此账户" to "Remove this account",
        "移除账户" to "Remove account",
        "邮箱连接已移除。" to "Mailbox connection removed.",
        "移除此邮箱账户？" to "Remove this mailbox?",
        "语言" to "Language",
        "中文" to "English → 中文",
        "English → 中文" to "中文 → English",
        // ---- 推送 ----
        "新邮件" to "New mail",
        "打开邮汇查看收件箱。" to "Open Youhui to view your inbox.",
        // ---- 服务端常见错误 ----
        "请先解锁邮箱工作台。" to "Unlock the workbench first.",
        "登录已过期，请重新解锁。" to "Session expired. Please unlock again.",
        "邮箱认证失败。请检查邮箱地址、应用专用密码或 OAuth 授权。" to "Mail authentication failed. Check the address, app-specific password or OAuth authorization.",
        "安全连接失败。请核对服务器、端口和 TLS 设置。" to "Secure connection failed. Check the server, port and TLS settings.",
        "无法连接邮件服务器。请检查服务器地址、端口，以及主机是否允许 SMTP 出站连接。" to "Cannot reach the mail server. Check the host, port and whether outbound SMTP is allowed.",
        "找不到此邮箱账户。" to "Mailbox not found.",
        "请选择发件邮箱。" to "Choose a sending mailbox.",
        "请填写收件人。" to "Enter a recipient.",
        "邮件主题和正文不能同时为空。" to "Subject and body cannot both be empty.",
        "邮箱已安全连接。" to "Mailbox connected securely.",
        "IMAP 收信与 SMTP 发信连接均已验证。" to "IMAP and SMTP connections verified.",
        "尝试次数过多，请 15 分钟后再试。" to "Too many attempts — try again in 15 minutes.",
        "密码不正确。" to "Incorrect password.",
        "请求失败" to "Request failed",
        "网络错误" to "Network error",
        // ---- 验证码通知 ----
        "验证码：" to "Code: ",
        // ---- InboxScreen ----
        "邮汇 · " to "Youhui · ",
        "AI 助手" to "AI assistant",
        "设置" to "Settings",
        "写信" to "Compose",
        "全部邮箱" to "All mailboxes",
        "搜索邮件" to "Search mail",
        "暂无邮件" to "No messages",
        "取消星标" to "Remove star",
        "加星" to "Add star",
        "(无主题)" to "(no subject)",
        // ---- ServerSetupScreen ----
        "邮汇" to "Youhui",
        "输入你的邮汇服务器地址以开始使用" to "Enter your Youhui server address to get started",
        "服务器地址" to "Server address",
        "仅接受 HTTPS 根地址（例如 https://mail.example.com）" to "HTTPS root URL only (e.g. https://mail.example.com)",
        "继续" to "Continue",
        "仅接受 HTTPS 根地址，以保护登录会话和邮件内容。" to "HTTPS root URLs only — this protects your session and mail content.",
        // ---- AccountEditScreen ----
        "custom" to "Custom",
        "添加邮箱账户" to "Add mailbox",
        "返回" to "Back",
        "邮箱服务商" to "Mail provider",
        "选择预设后自动填入服务器参数；Google/Microsoft 等需使用应用专用密码。" to "Presets fill in server settings; Gmail/Microsoft etc. need an app-specific password.",
        "邮箱地址" to "Email address",
        "密码 / 应用专用密码" to "Password / app-specific password",
        "显示名称（可选）" to "Display name (optional)",
        "收信（IMAP）" to "Incoming (IMAP)",
        "服务器" to "Server",
        "端口" to "Port",
        "加密连接（SSL/TLS）" to "Encrypted connection (SSL/TLS)",
        "已启用" to "Enabled",
        "未启用" to "Disabled",
        "发信（SMTP）" to "Outgoing (SMTP)",
        "测试连接" to "Test connection",
        "保存账户" to "Save account",
        // ---- ComposeScreen ----
        "回复" to "Reply",
        "写信" to "Compose",
        "回复账户" to "Reply mailbox",
        "发件邮箱" to "From mailbox",
        "加载中…" to "Loading…",
        "收件人" to "To",
        "抄送（可选）" to "Cc (optional)",
        "主题" to "Subject",
        "正文" to "Body",
        "添加附件" to "Add attachment",
        "邮件已发送。" to "Message sent.",
    )
}

/** Compose 内快捷调用。 */
fun t(zh: String): String = I18n.t(zh)
