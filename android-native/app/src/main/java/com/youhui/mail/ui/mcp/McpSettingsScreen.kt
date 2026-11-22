package com.youhui.mail.ui.mcp

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Security
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.youhui.mail.data.remote.dto.McpApprovalDto
import com.youhui.mail.di.ServiceLocator
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import com.youhui.mail.util.t

private data class McpPermissionInfo(
    val id: String,
    val label: String,
    val description: String
)

private val mcpPermissionDefinitions = listOf(
    McpPermissionInfo("read_only", "只读", "查看邮箱账户与文件夹、搜索和读取邮件；读取会把邮件标记为已读。"),
    McpPermissionInfo("email_management", "邮件管理", "在只读基础上增加标记已读/未读、加星与归档；移入已删除须工作台确认。"),
    McpPermissionInfo("send_mail", "发送邮件", "在只读基础上增加准备纯文本邮件；须经工作台确认后才会通过所选邮箱发送。"),
    McpPermissionInfo("full_access", "完全访问", "包含当前全部 MCP 邮件工具；发送邮件与移入已删除仍须逐项确认。")
)

private fun timeText(millis: Long): String =
    if (millis <= 0) "" else SimpleDateFormat("MM-dd HH:mm", Locale.getDefault()).format(Date(millis))

/** Agent / MCP 设置页：端点、权限令牌、邮箱范围与待确认操作。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun McpSettingsScreen(
    serviceLocator: ServiceLocator,
    onBack: () -> Unit
) {
    val viewModel: McpViewModel = viewModel(factory = McpViewModel.Factory(serviceLocator))
    val state by viewModel.state.collectAsState()
    val snackbar = remember { SnackbarHostState() }
    val clipboard = LocalClipboardManager.current

    var scopeTarget by remember { mutableStateOf<McpPermissionInfo?>(null) }
    var scopeAll by remember { mutableStateOf(true) }
    var scopeIds by remember { mutableStateOf<Set<String>>(emptySet()) }
    var rotateTarget by remember { mutableStateOf<McpPermissionInfo?>(null) }
    var revokeTarget by remember { mutableStateOf<McpPermissionInfo?>(null) }
    var approveTarget by remember { mutableStateOf<McpApprovalDto?>(null) }

    LaunchedEffect(Unit) {
        while (true) {
            delay(15_000)
            viewModel.refreshApprovals()
        }
    }
    LaunchedEffect(state.error) {
        state.error?.let { snackbar.showSnackbar(it); viewModel.consumeMessages() }
    }
    LaunchedEffect(state.info) {
        state.info?.let { snackbar.showSnackbar(it); viewModel.consumeMessages() }
    }

    fun openScopeDialog(permission: McpPermissionInfo) {
        val current = viewModel.permission(permission.id)
        scopeAll = current.accountScope == "all"
        scopeIds = current.accountIds.toSet()
        scopeTarget = permission
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = { Text("Agent / MCP") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = t("返回")) }
                },
                actions = {
                    IconButton(onClick = { viewModel.refresh() }) {
                        Icon(Icons.Filled.Refresh, contentDescription = t("刷新"))
                    }
                }
            )
        }
    ) { padding ->
        Column(
            Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState())
                .padding(horizontal = 12.dp)
        ) {
            if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            state.busy?.let { busy ->
                Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(16.dp))
                    Spacer(Modifier.size(8.dp))
                    Text(busy, style = MaterialTheme.typography.bodySmall)
                }
            }

            // ---------- 端点 ----------
            Card(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                Column(Modifier.padding(12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Security, contentDescription = null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.primary)
                        Spacer(Modifier.size(8.dp))
                        Text("MCP 端点", style = MaterialTheme.typography.titleSmall)
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "支持 Streamable HTTP；认证方式为 HTTP Bearer token。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(Modifier.height(8.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            state.config?.endpoint ?: "正在读取…",
                            style = MaterialTheme.typography.bodySmall,
                            fontFamily = FontFamily.Monospace,
                            modifier = Modifier.weight(1f)
                        )
                        IconButton(
                            onClick = {
                                state.config?.endpoint?.let { clipboard.setText(AnnotatedString(it)) }
                            },
                            enabled = !state.config?.endpoint.isNullOrBlank()
                        ) {
                            Icon(Icons.Filled.ContentCopy, contentDescription = t("复制端点"))
                        }
                    }
                }
            }

            // ---------- 工具说明 ----------
            Card(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                Column(Modifier.padding(12.dp)) {
                    Text("提供给 Agent 的工具", style = MaterialTheme.typography.titleSmall)
                    Spacer(Modifier.height(6.dp))
                    listOf(
                        "list_accounts / list_folders：查看邮箱账户与文件夹",
                        "search_emails / get_email：搜索和读取邮件（读取会标记为已读）",
                        "manage_email：标记读/未读、加星、归档；移入已删除前需确认",
                        "send_email：准备纯文本邮件；确认后才会通过所选邮箱发送"
                    ).forEach { line ->
                        Text("· $line", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "只创建 Agent 必需的最低权限令牌；旧版令牌会自动降为只读。MCP 不提供永久删除邮件工具。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            // ---------- 权限令牌 ----------
            Text(
                "权限令牌",
                style = MaterialTheme.typography.titleSmall,
                modifier = Modifier.padding(top = 8.dp, bottom = 2.dp)
            )
            Text(
                "每种权限单独签发令牌，可限制为全部已连接邮箱或选定邮箱。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            mcpPermissionDefinitions.forEach { definition ->
                val permission = viewModel.permission(definition.id)
                Card(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                    Column(Modifier.padding(12.dp)) {
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Text(definition.label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                            Text(
                                when {
                                    permission.legacy -> "旧版只读令牌"
                                    permission.configured -> "已创建"
                                    else -> "未创建"
                                },
                                style = MaterialTheme.typography.labelSmall,
                                color = if (permission.configured) MaterialTheme.colorScheme.primary
                                else MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        Text(
                            definition.description,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        if (permission.configured) {
                            Spacer(Modifier.height(4.dp))
                            Text(
                                "范围：${viewModel.scopeLabel(permission.accountScope, permission.accountIds)}",
                                style = MaterialTheme.typography.bodySmall
                            )
                        }
                        Spacer(Modifier.height(6.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                            if (permission.configured) {
                                OutlinedButton(
                                    onClick = { rotateTarget = definition },
                                    enabled = state.busy == null
                                ) { Text(t("轮换令牌")) }
                                TextButton(
                                    onClick = { openScopeDialog(definition) },
                                    enabled = state.busy == null
                                ) { Text(t("设置范围")) }
                                TextButton(
                                    onClick = { revokeTarget = definition },
                                    enabled = state.busy == null
                                ) { Text(t("撤销")) }
                            } else {
                                Button(
                                    onClick = { openScopeDialog(definition) },
                                    enabled = state.busy == null
                                ) { Text(t("创建令牌")) }
                            }
                        }
                    }
                }
            }

            // ---------- 新令牌（仅本次显示） ----------
            state.newToken?.let { token ->
                Card(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                    Column(Modifier.padding(12.dp)) {
                        Text(
                            "${mcpPermissionDefinitions.firstOrNull { it.id == state.newTokenPermission }?.label ?: "MCP"} 新令牌（仅此次显示）",
                            style = MaterialTheme.typography.titleSmall
                        )
                        Spacer(Modifier.height(6.dp))
                        OutlinedTextField(
                            value = token,
                            onValueChange = { },
                            readOnly = true,
                            singleLine = false,
                            maxLines = 3,
                            textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                            modifier = Modifier.fillMaxWidth()
                        )
                        Spacer(Modifier.height(6.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = { clipboard.setText(AnnotatedString(token)) }) {
                                Icon(Icons.Filled.ContentCopy, contentDescription = null, Modifier.size(16.dp))
                                Spacer(Modifier.size(6.dp))
                                Text(t("复制令牌"))
                            }
                            OutlinedButton(onClick = { viewModel.clearTokenReveal() }) { Text(t("收起")) }
                        }
                        Spacer(Modifier.height(4.dp))
                        Text(
                            "请只粘贴到可信任的 MCP Agent 配置中。关闭页面后需重新轮换才能获得新令牌。",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }

            // ---------- 待确认操作 ----------
            Text(
                "待确认操作",
                style = MaterialTheme.typography.titleSmall,
                modifier = Modifier.padding(top = 10.dp, bottom = 2.dp)
            )
            Text(
                "Agent 提交的邮件会先显示在这里；你确认后才会发送或移入已删除。没有待确认操作时保持为空。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            if (state.approvals.isEmpty()) {
                Text(
                    "目前没有待确认操作。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 8.dp)
                )
            }
            state.approvals.forEach { approval ->
                val send = approval.kind == "send_email"
                Card(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                    Column(Modifier.padding(12.dp)) {
                        Text(
                            if (send) "待发送：${approval.subject ?: "(无主题)"}" else "待移入已删除",
                            style = MaterialTheme.typography.bodyLarge
                        )
                        Text(
                            listOfNotNull(
                                approval.accountLabel ?: approval.accountEmail,
                                timeText(approval.createdAt).takeIf { it.isNotBlank() }
                            ).joinToString(" · "),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Spacer(Modifier.height(4.dp))
                        if (send) {
                            Text("收件人：${approval.to.orEmpty()}", style = MaterialTheme.typography.bodySmall)
                            approval.cc?.takeIf { it.isNotBlank() }?.let { Text("抄送：$it", style = MaterialTheme.typography.bodySmall) }
                            approval.bcc?.takeIf { it.isNotBlank() }?.let { Text("密送：$it", style = MaterialTheme.typography.bodySmall) }
                            Spacer(Modifier.height(4.dp))
                            Text(
                                approval.text ?: "(无正文)",
                                style = MaterialTheme.typography.bodySmall,
                                maxLines = 6,
                                overflow = TextOverflow.Ellipsis
                            )
                        } else {
                            Text(
                                "${approval.accountEmail ?: approval.accountLabel ?: ""} · ${approval.folder ?: "INBOX"} · UID ${approval.uid ?: ""}",
                                style = MaterialTheme.typography.bodySmall
                            )
                        }
                        Spacer(Modifier.height(6.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(
                                onClick = { approveTarget = approval },
                                enabled = state.busy == null
                            ) { Text(if (send) "确认并发送" else "确认移入已删除") }
                            OutlinedButton(
                                onClick = { viewModel.deny(approval.id) },
                                enabled = state.busy == null
                            ) { Text(t("拒绝")) }
                        }
                    }
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }

    // 范围选择（创建令牌或调整已有令牌的邮箱范围）
    scopeTarget?.let { permission ->
        val creating = !viewModel.permission(permission.id).configured
        AlertDialog(
            onDismissRequest = { scopeTarget = null },
            title = { Text(if (creating) "创建 ${permission.label} 令牌" else "设置 ${permission.label} 令牌范围") },
            text = {
                Column(Modifier.heightIn(max = 400.dp).verticalScroll(rememberScrollState())) {
                    Text(
                        if (creating) "选择此令牌可访问的邮箱；创建后会立即显示令牌。" else "只调整范围，不会更换现有令牌。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(Modifier.height(8.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(
                            checked = scopeAll,
                            onCheckedChange = { scopeAll = it }
                        )
                        Text("全部已连接邮箱（含以后添加的）", style = MaterialTheme.typography.bodyMedium)
                    }
                    (state.config?.accounts.orEmpty()).forEach { account ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(
                                checked = scopeAll || account.id in scopeIds,
                                onCheckedChange = { checked ->
                                    if (checked) scopeIds = scopeIds + account.id else scopeIds = scopeIds - account.id
                                },
                                enabled = !scopeAll
                            )
                            Text(
                                account.label?.takeIf { it.isNotBlank() } ?: account.email ?: account.id,
                                style = MaterialTheme.typography.bodyMedium
                            )
                        }
                    }
                    if (state.config?.accounts.isNullOrEmpty()) {
                        Text(
                            "尚未连接邮箱；可先选择“全部”，连接后自动包含。",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val ids = if (scopeAll) setOf<String>() else scopeIds
                        if (creating) viewModel.createToken(permission.id, scopeAll, ids)
                        else viewModel.updateScope(permission.id, scopeAll, ids)
                        scopeTarget = null
                    },
                    enabled = scopeAll || scopeIds.isNotEmpty()
                ) { Text(if (creating) "创建" else "保存") }
            },
            dismissButton = { TextButton(onClick = { scopeTarget = null }) { Text(t("取消")) } }
        )
    }

    // 轮换令牌确认
    rotateTarget?.let { permission ->
        AlertDialog(
            onDismissRequest = { rotateTarget = null },
            title = { Text(t("轮换 ${permission.label} 令牌？")) },
            text = { Text(t("现有令牌会立即失效；已连接的 Agent 需要更新为新令牌。邮箱范围保持不变。")) },
            confirmButton = {
                TextButton(onClick = {
                    val current = viewModel.permission(permission.id)
                    viewModel.createToken(
                        permission.id,
                        current.accountScope == "all",
                        current.accountIds.toSet()
                    )
                    rotateTarget = null
                }) { Text(t("轮换")) }
            },
            dismissButton = { TextButton(onClick = { rotateTarget = null }) { Text(t("取消")) } }
        )
    }

    // 撤销令牌确认
    revokeTarget?.let { permission ->
        AlertDialog(
            onDismissRequest = { revokeTarget = null },
            title = { Text(t("撤销 ${permission.label} 令牌？")) },
            text = { Text(t("使用此令牌的 Agent 会立即失去对应权限；其他权限的令牌不受影响。")) },
            confirmButton = {
                TextButton(onClick = { viewModel.revokeToken(permission.id); revokeTarget = null }) { Text(t("撤销")) }
            },
            dismissButton = { TextButton(onClick = { revokeTarget = null }) { Text(t("取消")) } }
        )
    }

    // 审批确认（发送 / 移入已删除均为敏感操作）
    approveTarget?.let { approval ->
        val send = approval.kind == "send_email"
        AlertDialog(
            onDismissRequest = { approveTarget = null },
            title = { Text(if (send) "确认发送这封邮件？" else "确认移入已删除？") },
            text = {
                Text(
                    if (send) {
                        "将从 ${approval.accountEmail ?: approval.accountLabel ?: "所选邮箱"} 发送给 ${approval.to ?: "未指定收件人"}。主题：${approval.subject ?: "(无主题)"}。\n\n${(approval.text ?: "").take(1500)}"
                    } else {
                        "将把 ${approval.accountEmail ?: approval.accountLabel ?: "所选邮箱"} 中 ${approval.folder ?: "INBOX"} 的邮件 UID ${approval.uid ?: ""} 移入“已删除”。这不是永久删除。"
                    }
                )
            },
            confirmButton = {
                TextButton(onClick = { viewModel.approve(approval.id); approveTarget = null }) {
                    Text(if (send) "确认并发送" else "移入已删除")
                }
            },
            dismissButton = { TextButton(onClick = { approveTarget = null }) { Text(t("取消")) } }
        )
    }
}