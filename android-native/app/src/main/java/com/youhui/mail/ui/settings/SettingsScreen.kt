package com.youhui.mail.ui.settings

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Backup
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Restore
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Translate
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.youhui.mail.data.remote.dto.AccountSummaryDto
import com.youhui.mail.di.ServiceLocator
import kotlinx.coroutines.launch
import java.io.File
import com.youhui.mail.util.I18n
import com.youhui.mail.util.t

private val identityLabels = mapOf("google" to "Google", "github" to "GitHub", "cloudflare" to "Cloudflare")

/** 设置页（对齐网页工作台设置的核心功能）。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    serviceLocator: ServiceLocator,
    onBack: () -> Unit,
    onAddAccount: () -> Unit,
    onOpenDevices: () -> Unit,
    onOpenAi: () -> Unit,
    onOpenAiSettings: () -> Unit,
    onOpenMcp: () -> Unit,
    onOpenTranslationSettings: () -> Unit,
    onLoggedOut: () -> Unit
) {
    val context = LocalContext.current
    val viewModel: SettingsViewModel = viewModel(
        factory = SettingsViewModel.Factory(serviceLocator, serviceLocator.authRepository())
    )
    val state by viewModel.state.collectAsState()
    val snackbar = remember { SnackbarHostState() }
    val scope = androidx.compose.runtime.rememberCoroutineScope()

    var pendingDelete by remember { mutableStateOf<AccountSummaryDto?>(null) }
    var pendingRestore by remember { mutableStateOf<android.net.Uri?>(null) }
    var restorePassphrase by remember { mutableStateOf("") }
    var confirmLogout by remember { mutableStateOf(false) }

    // 每次回到设置页（含从添加账户、AI/MCP 设置返回）都刷新，确保状态最新
    LifecycleResumeEffect(Unit) {
        viewModel.refresh()
        onPauseOrDispose { }
    }

    LaunchedEffect(state.error) {
        state.error?.let { snackbar.showSnackbar(it); viewModel.clearMessages() }
    }
    LaunchedEffect(state.info) {
        state.info?.let { snackbar.showSnackbar(it); viewModel.clearMessages() }
    }
    LaunchedEffect(state.restored) {
        if (state.restored) onLoggedOut()
    }

    // 备份恢复：选择 .yhbackup 文件 → 确认 → 上传
    val restorePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            restorePassphrase = ""
            pendingRestore = uri
        }
    }

    fun shareBackup(file: File) {
        try {
            val uri = FileProvider.getUriForFile(context, context.packageName + ".fileprovider", file)
            val intent = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                type = "application/octet-stream"
                putExtra(android.content.Intent.EXTRA_STREAM, uri)
                addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            context.startActivity(android.content.Intent.createChooser(intent, "保存/分享备份文件"))
        } catch (e: Exception) {
            scope.launch { snackbar.showSnackbar("无法分享备份：${e.localizedMessage ?: "未知错误"}") }
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = { Text(t("设置")) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = t("返回")) }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState())
        ) {
            if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            state.busy?.let { busy ->
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    CircularProgressIndicator(Modifier.size(16.dp))
                    Spacer(Modifier.size(8.dp))
                    Text(busy, style = MaterialTheme.typography.bodySmall)
                }
            }

            // ---------- 邮箱账户 ----------
            SettingsCard(title = t("邮箱账户"), icon = Icons.Filled.Email) {
                if (state.accounts.isEmpty() && !state.loading) {
                    Text("尚未连接邮箱账户。", style = MaterialTheme.typography.bodySmall)
                }
                state.accounts.forEach { account ->
                    Row(
                        Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(Modifier.weight(1f)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    account.label?.takeIf { it.isNotBlank() } ?: account.email ?: account.id,
                                    style = MaterialTheme.typography.bodyLarge,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                                if (account.id == state.defaultAccountId) {
                                    Text(
                                        "默认",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.primary,
                                        modifier = Modifier.padding(start = 6.dp)
                                    )
                                }
                            }
                            Text(
                                account.email?.takeIf { it != account.label } ?: "",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        if (account.id != state.defaultAccountId) {
                            TextButton(onClick = { viewModel.setDefaultAccount(account.id) }) { Text(t("设默认")) }
                        }
                        IconButton(onClick = { pendingDelete = account }) {
                            Icon(Icons.Filled.Delete, contentDescription = t("删除账户"))
                        }
                    }
                }
                Spacer(Modifier.height(4.dp))
                AssistChip(
                    onClick = onAddAccount,
                    label = { Text(t("添加邮箱账户")) },
                    leadingIcon = { Icon(Icons.Filled.Add, contentDescription = null, Modifier.size(18.dp)) }
                )
            }

            // ---------- AI 助手 ----------
            SettingsCard(title = t("AI 助手"), icon = Icons.Filled.AutoAwesome) {
                val ai = state.aiConfig
                Text(
                    if (ai?.configured == true) {
                        "已配置：${ai.providerName.ifBlank { "自定义服务商" }} · ${ai.model}"
                    } else {
                        "尚未配置模型 API；配置后可对话、解释邮件与生成收件摘要。"
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                if (ai?.configured == true && ai.dailySummaryEnabled) {
                    Text(
                        "每日摘要：${ai.dailySummaryTime}（香港时间）",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Spacer(Modifier.height(6.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    AssistChip(onClick = onOpenAi, label = { Text(t("打开 AI 助手")) })
                    AssistChip(onClick = onOpenAiSettings, label = { Text(if (ai?.configured == true) "模型设置" else "配置模型") })
                }
            }

            // ---------- 邮件翻译 ----------
            SettingsCard(title = t("邮件翻译"), icon = Icons.Filled.Translate) {
                val translation = state.translationConfig
                val providerName = mapOf(
                    "niutrans" to "小牛翻译",
                    "google" to "Google Cloud Translation",
                    "azure" to "Azure Translator"
                )[translation?.provider] ?: "未选择"
                Text(
                    if (translation?.configured == true) {
                        "当前服务商：$providerName（凭据已保存）"
                    } else {
                        "尚未配置翻译服务；在邮件中点「译」前需先完成配置。"
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(Modifier.height(6.dp))
                AssistChip(
                    onClick = onOpenTranslationSettings,
                    label = { Text(if (translation?.configured == true) "翻译设置" else "配置翻译") }
                )
            }

            // ---------- Agent / MCP ----------
            SettingsCard(title = "Agent / MCP", icon = Icons.Filled.Security) {
                val permissions = state.mcpConfig?.permissions?.values.orEmpty()
                val configured = permissions.count { it.configured }
                Text(
                    "权限令牌：$configured / ${permissions.size.coerceAtLeast(4)} 已创建",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                if (state.mcpApprovalCount > 0) {
                    Text(
                        "有 ${state.mcpApprovalCount} 项待确认的 MCP 邮件操作",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
                Spacer(Modifier.height(6.dp))
                AssistChip(onClick = onOpenMcp, label = { Text(t("打开 Agent / MCP 设置")) })
            }

            // ---------- 新邮件检查 ----------
            SettingsCard(title = t("新邮件检查"), icon = Icons.Filled.Notifications) {
                val notification = state.notification
                if (notification == null) {
                    Text("加载中…", style = MaterialTheme.typography.bodySmall)
                } else {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("定时检查新邮件并推送通知", style = MaterialTheme.typography.bodyMedium)
                            Text(
                                "推送通道：${if (notification.pushProvider == "wxpusher") "WxPusher" else "Webhook"}（在网页设置中完整配置）",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        Switch(
                            checked = notification.enabled,
                            onCheckedChange = { viewModel.setNotificationsEnabled(it) }
                        )
                    }
                    if (notification.enabled) {
                        Spacer(Modifier.height(8.dp))
                        Text("检查间隔", style = MaterialTheme.typography.labelLarge)
                        Spacer(Modifier.height(4.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            listOf(120 to "2 分钟", 300 to "5 分钟", 600 to "10 分钟").forEach { (seconds, label) ->
                                FilterChip(
                                    selected = notification.intervalSeconds == seconds,
                                    onClick = { viewModel.setNotificationInterval(seconds) },
                                    label = { Text(label) }
                                )
                            }
                        }
                    }
                }
            }

            // ---------- 备份与恢复 ----------
            SettingsCard(title = t("备份与恢复"), icon = Icons.Filled.Backup) {
                Text(
                    "备份包含全部账户与设置（不含登录会话）。恢复会替换当前数据并退出所有会话。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = { viewModel.exportBackup(context) { file -> shareBackup(file) } },
                        enabled = state.busy == null
                    ) {
                        Icon(Icons.Filled.Backup, contentDescription = null, Modifier.size(16.dp))
                        Spacer(Modifier.size(6.dp))
                        Text(t("导出备份"))
                    }
                    OutlinedButton(
                        onClick = { restorePicker.launch(arrayOf("application/octet-stream", "application/vnd.youhui-mail.backup", "*/*")) },
                        enabled = state.busy == null
                    ) {
                        Icon(Icons.Filled.Restore, contentDescription = null, Modifier.size(16.dp))
                        Spacer(Modifier.size(6.dp))
                        Text(t("恢复备份"))
                    }
                }
            }

            // ---------- 身份绑定 ----------
            SettingsCard(title = t("第三方身份"), icon = Icons.Filled.VerifiedUser) {
                val bound = state.identityProviders.filterValues { it }
                if (bound.isEmpty()) {
                    Text(
                        "尚未绑定第三方身份；可在网页工作台设置中绑定后用于 App 登录。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                bound.forEach { (provider, _) ->
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            identityLabels[provider] ?: provider,
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.weight(1f)
                        )
                        TextButton(onClick = { viewModel.unbindIdentity(provider) }) { Text(t("解除绑定")) }
                    }
                }
            }

            // ---------- 设备 / 服务器 / 退出 ----------
            SettingsCard(title = t("其他"), icon = Icons.Filled.Devices) {
                Row(
                    Modifier.fillMaxWidth().padding(vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("设备管理", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                    TextButton(onClick = onOpenDevices) { Text(t("打开")) }
                }
                Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                    Text("服务器", style = MaterialTheme.typography.bodyMedium)
                    Spacer(Modifier.size(12.dp))
                    Text(
                        state.serverUrl,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f)
                    )
                }
                Row(
                    Modifier.fillMaxWidth().padding(vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("退出登录", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                    OutlinedButton(onClick = { confirmLogout = true }) {
                        Icon(Icons.Filled.Logout, contentDescription = null, Modifier.size(16.dp))
                        Spacer(Modifier.size(6.dp))
                        Text(t("退出"))
                    }
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }

    // 删除账户确认
    pendingDelete?.let { account ->
        AlertDialog(
            onDismissRequest = { pendingDelete = null },
            title = { Text(t("删除邮箱账户？")) },
            text = { Text(if (I18n.lang == I18n.EN) "This removes ${account.email} and its notification records from the workbench. Mail on the server is unaffected." else "将从工作台移除「${account.label?.takeIf { it.isNotBlank() } ?: account.email}」及其通知记录；不影响邮箱服务器上的邮件。") },
            confirmButton = { TextButton(onClick = { viewModel.deleteAccount(account); pendingDelete = null }) { Text(t("删除")) } },
            dismissButton = { TextButton(onClick = { pendingDelete = null }) { Text(t("取消")) } }
        )
    }

    // 恢复备份确认（危险操作，含加密备份密码输入）
    pendingRestore?.let { uri ->
        AlertDialog(
            onDismissRequest = { pendingRestore = null },
            title = { Text(t("确认恢复备份？")) },
            text = {
                Column {
                    Text(t("恢复会替换当前全部账户与设置，并退出所有登录会话。"))
                    Text("如果备份是加密的，请输入创建时设置的密码；明文备份留空。", style = MaterialTheme.typography.bodySmall)
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = restorePassphrase,
                        onValueChange = { restorePassphrase = it },
                        label = { Text(t("备份密码（可选）")) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    val target = pendingRestore
                    pendingRestore = null
                    if (target != null) viewModel.restoreBackup(context, target, restorePassphrase)
                }) { Text(t("恢复")) }
            },
            dismissButton = { TextButton(onClick = { pendingRestore = null }) { Text(t("取消")) } }
        )
    }

    // 退出确认
    if (confirmLogout) {
        AlertDialog(
            onDismissRequest = { confirmLogout = false },
            title = { Text(t("退出登录？")) },
            text = { Text(t("将吊销本设备的会话并清空本地缓存，需要重新输入工作台密码。")) },
            confirmButton = {
                TextButton(onClick = {
                    confirmLogout = false
                    viewModel.logout(onDone = onLoggedOut)
                }) { Text(t("退出")) }
            },
            dismissButton = { TextButton(onClick = { confirmLogout = false }) { Text(t("取消")) } }
        )
    }
}

@Composable
private fun SettingsCard(
    title: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    content: @Composable () -> Unit
) {
    Card(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp)) {
        Column(Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(icon, contentDescription = null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.size(8.dp))
                Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            }
            Spacer(Modifier.height(8.dp))
            content()
        }
    }
}