package com.youhui.mail.ui.detail

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Reply
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material3.AssistChip
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.HorizontalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import com.youhui.mail.di.ServiceLocator
import com.youhui.mail.data.repository.toUserMessage
import com.youhui.mail.data.remote.dto.AttachmentMetaDto
import com.youhui.mail.data.remote.dto.MessageDto
import com.youhui.mail.util.Formatters
import kotlinx.coroutines.launch
import java.util.Locale

/** 邮件详情：雷鸟风格头部 + 受限 WebView 正文 + 附件芯片与流式下载。 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun MessageDetailScreen(
    serviceLocator: ServiceLocator,
    accountId: String,
    uid: Long,
    folder: String,
    onBack: () -> Unit,
    onReply: (com.youhui.mail.data.remote.dto.MessageDto) -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var message by remember { mutableStateOf<MessageDto?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    var downloading by remember { mutableStateOf<String?>(null) } // 正在下载的附件名
    var detailRetry by remember { mutableStateOf(0) }
    // 正文 cid 内嵌图回填结果（未含超预算图时为 null，直接用原始 html）
    var cidHtml by remember { mutableStateOf<String?>(null) }
    // 已回填进正文、不再于附件区重复展示的内嵌图 index 集合
    var referencedInlineIndices by remember { mutableStateOf<Set<Int>>(emptySet()) }

    LaunchedEffect(accountId, uid, folder, detailRetry) {
        cidHtml = null
        referencedInlineIndices = emptySet()
        try {
            val dto = serviceLocator.mailRepository().message(accountId, uid, folder)
            message = dto
            loading = false
            // 成功拉取后写入离线缓存（无网络时可回落）
            serviceLocator.mailCache.saveDetail(dto, accountId, uid, folder)
            // 正文 cid 回填：服务端对超出内联预算的 cid 图保留 data-cid-src 标记，
            // 在此从附件端点（disposition=inline）取回并替换为 data: URL，受客户端预算限制
            val rawHtml = dto.html.orEmpty()
            if (rawHtml.contains(CID_MARKER)) {
                val result = resolveCidImages(serviceLocator, dto, accountId, uid, folder)
                cidHtml = result.html
                // 已成功回填到正文的内嵌图：不再在附件区重复展示
                referencedInlineIndices = result.embeddedIndices
                if (result.failed > 0) {
                    snackbar.showSnackbar("部分内嵌图片未能加载（${result.failed} 张）。")
                }
            }
        } catch (e: Exception) {
            // 网络失败：回落离线详情缓存（若有），并提示离线模式
            val cached = serviceLocator.mailCache.cachedDetail(accountId, uid, folder)
            if (cached != null) {
                message = cached
                snackbar.showSnackbar("离线缓存：无法连接服务器，显示最近一次已读内容。")
            } else {
                // 括号内为诊断信息：HTTP 状态码或异常类名，报告问题时请一并反馈
                error = e.toUserMessage() + when (e) {
                    is retrofit2.HttpException -> "（HTTP ${e.code()}）"
                    else -> "（${e.javaClass.simpleName}）"
                }
            }
        } finally {
            loading = false
        }
    }

    LaunchedEffect(error) {
        error?.let { snackbar.showSnackbar(it); error = null }
    }

    fun shareFile(path: String) {
        try {
            val file = java.io.File(path)
            val uri = FileProvider.getUriForFile(context, context.packageName + ".fileprovider", file)
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = "application/octet-stream"
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            context.startActivity(Intent.createChooser(intent, "打开附件"))
        } catch (e: Exception) {
            scope.launch { snackbar.showSnackbar("无法打开附件：${e.localizedMessage ?: "未知错误"}") }
        }
    }

    fun download(attachment: AttachmentMetaDto) {
        if (downloading != null) return
        downloading = attachment.filename
        scope.launch {
            try {
                val file = serviceLocator.mailRepository()
                    .fetchAttachmentToCache(accountId, uid, folder, attachment.index, context.cacheDir, attachment.filename)
                shareFile(file.absolutePath)
            } catch (e: Exception) {
                snackbar.showSnackbar(e.toUserMessage())
            } finally {
                downloading = null
            }
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = {
                    Text(message?.subject ?: "邮件详情", maxLines = 1, overflow = TextOverflow.Ellipsis)
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    if (message != null) {
                        IconButton(onClick = { message?.let(onReply) }) {
                            Icon(Icons.AutoMirrored.Filled.Reply, contentDescription = "回复")
                        }
                    }
                }
            )
        }
    ) { padding ->
        val current = message
        Column(
            modifier = Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState())
        ) {
            if (loading) {
                Column(
                    Modifier.fillMaxWidth().padding(top = 64.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    CircularProgressIndicator(Modifier.size(36.dp))
                    Spacer(Modifier.height(12.dp))
                    Text("正在加载邮件…", style = MaterialTheme.typography.bodyMedium)
                }
            } else if (current != null) {
                // 雷鸟风格卡片头部：主题 / 头像发件人 / 可折叠收件人 / 友好时间
                MessageMeta(current)
                HorizontalDivider(Modifier.padding(vertical = 4.dp))
                // 正文区：两侧留白，长邮件不难读
                MailBodyWebView(
                    html = cidHtml ?: current.html.orEmpty(),
                    text = current.text.orEmpty(),
                    serverUrl = serviceLocator.tokenStore.serverUrl.orEmpty(),
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp)
                )
                // 附件区隐藏已被正文引用（成功回填）的内嵌图，只展示真正的下载件；芯片化横排
                val visibleAttachments = current.attachments.filterNot { it.index in referencedInlineIndices }
                if (visibleAttachments.isNotEmpty()) {
                    HorizontalDivider(Modifier.padding(vertical = 8.dp))
                    Text(
                        "附件（${visibleAttachments.size}）",
                        style = MaterialTheme.typography.titleSmall,
                        modifier = Modifier.padding(horizontal = 12.dp)
                    )
                    FlowRow(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        visibleAttachments.forEach { attachment ->
                            AttachmentChip(
                                attachment = attachment,
                                downloading = downloading,
                                enabled = downloading == null,
                                onClick = { download(attachment) }
                            )
                        }
                    }
                    Spacer(Modifier.height(16.dp))
                }
            } else if (error != null) {
                Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(error ?: "", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
                    Spacer(Modifier.height(12.dp))
                    OutlinedButton(onClick = {
                        error = null
                        loading = true
                        message = null
                        detailRetry++
                    }) { Text("重试") }
                }
            }
        }
    }
}

/**
 * 雷鸟风格邮件头部：主题大字 + 头像发件人（名字突出、地址灰小字）+
 * 可折叠收件人（默认 2 行，展开看全）+ 友好时间（今天/昨天/周几）。
 */
@Composable
private fun MessageMeta(message: MessageDto) {
    var expanded by remember { mutableStateOf(false) }
    val sender = message.from.firstOrNull()
    val senderName = sender?.name?.takeIf { it.isNotBlank() } ?: sender?.address ?: "未知发件人"
    val senderAddress = sender?.address?.takeIf { it.isNotBlank() && it != senderName }
    val dateText = Formatters.friendly(message.date)

    Column(Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
        // 主题
        Text(
            message.subject.orEmpty().ifBlank { "(无主题)" },
            style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.fillMaxWidth()
        )
        Spacer(Modifier.height(8.dp))
        // 发件人行：字母头像 + 名字/地址 + 右侧时间
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .size(40.dp)
                    .clip(androidx.compose.foundation.shape.CircleShape)
                    .background(MaterialTheme.colorScheme.primaryContainer)
            ) {
                Text(
                    senderName.trim().take(1).uppercase(),
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onPrimaryContainer
                )
            }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    senderName,
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onSurface
                )
                if (senderAddress != null) {
                    Text(
                        senderAddress,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                // 收件人/抄送：灰小字，可展开
                val recipientsLine = buildString {
                    append("收件人：")
                    append(formatAddresses(message.to))
                    if (message.cc.isNotEmpty()) {
                        append("\n抄送：")
                        append(formatAddresses(message.cc))
                    }
                }
                Text(
                    recipientsLine,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = if (expanded) Int.MAX_VALUE else 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 2.dp)
                        .clickable { expanded = !expanded }
                )
            }
            Spacer(Modifier.width(8.dp))
            // 时间：右侧竖排，友好格式
            Text(
                dateText,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

/** 雷鸟风格附件芯片：图标 + 文件名 + 大小 + 下载动作合一。 */
@Composable
private fun AttachmentChip(
    attachment: AttachmentMetaDto,
    downloading: String?,
    enabled: Boolean,
    onClick: () -> Unit
) {
    AssistChip(
        onClick = onClick,
        enabled = enabled,
        leadingIcon = {
            Icon(
                Icons.Filled.AttachFile,
                contentDescription = null,
                modifier = Modifier.size(16.dp)
            )
        },
        label = {
            Column {
                Text(
                    attachment.filename,
                    style = MaterialTheme.typography.bodySmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    if (downloading == attachment.filename) "下载中…" else formatSize(attachment.size),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    )
}

private fun formatAddresses(list: List<com.youhui.mail.data.remote.dto.AddressDto>): String =
    list.joinToString(", ") { it.name?.takeIf { n -> n.isNotBlank() } ?: it.address ?: "" }.ifBlank { "-" }

private fun formatSize(bytes: Long): String = when {
    bytes >= 1024 * 1024 -> String.format(Locale.US, "%.1f MB", bytes / 1024.0 / 1024.0)
    bytes >= 1024 -> String.format(Locale.US, "%.1f KB", bytes / 1024.0)
    else -> "$bytes B"
}

// ---------- 正文 cid 内嵌图回填 ----------
private const val CID_MARKER = "data-cid-src=\""
private const val CID_MAX_PER_IMAGE = 8L * 1024 * 1024    // 单张上限（超出即放弃，留空白）
private const val CID_MAX_TOTAL = 20L * 1024 * 1024        // 整封邮件 cid 回填总量上限
private const val CID_MAX_COUNT = 20                      // 最多回填张数（防止超长 newsletter 拖垮）

private data class CidResult(val html: String, val failed: Int, val embeddedIndices: Set<Int> = emptySet())

/** 归一化 contentId：与服务端 normalizeContentId 对齐（去 cid: 前缀、尖括号，统一小写）。 */
private fun normalizeCid(raw: String?): String {
    var value = raw?.trim().orEmpty()
    if (value.startsWith("cid:", ignoreCase = true)) value = value.substring(4)
    value = value.removePrefix("<").removeSuffix(">").trim()
    if (value.isEmpty()) return ""
    return try {
        java.net.URLDecoder.decode(value, "UTF-8").lowercase()
    } catch (ignored: Exception) {
        value.lowercase()
    }
}

/**
 * 扫描 html 中 data-cid-src 标记的图，从附件元数据里按 contentId 匹配（仅安全类型），
 * 经 disposition=inline 端点取回字节后替换为 data: URL；获取失败保持原样（空白/可重试）。
 */
private suspend fun resolveCidImages(
    serviceLocator: ServiceLocator,
    dto: MessageDto,
    accountId: String,
    uid: Long,
    folder: String
): CidResult {
    val html = dto.html.orEmpty()
    val regex = Regex("data-cid-src=\"([^\"]+)\"")
    val referenced = regex.findAll(html).map { it.groupValues[1] }.distinct().take(CID_MAX_COUNT).toList()
    if (referenced.isEmpty()) return CidResult(html, 0)
    val repository = serviceLocator.mailRepository()
    val resolved = mutableMapOf<String, String>()
    val embeddedIndices = mutableSetOf<Int>()
    var totalBytes = 0L
    var failed = 0
    for (rawCid in referenced) {
        val key = normalizeCid(rawCid)
        if (key.isBlank()) continue
        val target = dto.attachments.firstOrNull { it.inline && normalizeCid(it.contentId) == key } ?: continue
        if (totalBytes >= CID_MAX_TOTAL) break
        val pair = repository.inlineImage(accountId, uid, folder, target.index)
        if (pair == null) { failed++; continue }
        val (bytes, mime) = pair
        if (bytes.size > CID_MAX_PER_IMAGE) { failed++; continue }
        totalBytes += bytes.size
        resolved[rawCid] = "data:$mime;base64," + android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
        embeddedIndices.add(target.index)
    }
    val replaced = regex.replace(html) { match ->
        resolved[match.groupValues[1]]?.let { "src=\"$it\"" } ?: match.value
    }
    return CidResult(replaced, failed, embeddedIndices)
}
