package com.youhui.mail.ui.ai

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
import androidx.compose.material3.Surface
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
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.youhui.mail.di.ServiceLocator
import com.youhui.mail.util.t

/**
 * AI 助手页：对话、收件摘要、模型状态；从邮件详情进入时自动携带该邮件并发起解释 / 起草。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AiChatScreen(
    serviceLocator: ServiceLocator,
    onBack: () -> Unit,
    onOpenSettings: () -> Unit,
    seedAccountId: String? = null,
    seedUid: Long = 0,
    seedFolder: String = "INBOX",
    seedIntent: String = "chat"
) {
    val viewModel: AiChatViewModel = viewModel(
        factory = AiChatViewModel.Factory(serviceLocator, seedAccountId, seedUid, seedFolder, seedIntent)
    )
    val state by viewModel.state.collectAsState()
    val snackbar = remember { SnackbarHostState() }
    val listState = rememberLazyListState()
    val clipboard = LocalClipboardManager.current

    var input by remember { mutableStateOf("") }
    var scopeMenu by remember { mutableStateOf(false) }
    var digestScope by remember { mutableStateOf("all") }

    LaunchedEffect(state.defaultDigestScope) {
        if (state.defaultDigestScope.isNotBlank()) digestScope = state.defaultDigestScope
    }
    LaunchedEffect(state.notice) {
        state.notice?.let { snackbar.showSnackbar(it); viewModel.consumeNotice() }
    }
    // 从模型设置页返回时刷新配置，避免仍显示“未配置”
    LifecycleResumeEffect(Unit) {
        viewModel.refreshConfig()
        onPauseOrDispose { }
    }
    LaunchedEffect(state.messages.size, state.busy) {
        if (state.messages.isNotEmpty()) listState.animateScrollToItem(state.messages.size - 1)
    }

    fun submit() {
        val text = input.trim()
        if (text.isEmpty()) return
        input = ""
        viewModel.send(text)
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = { Text(t("AI 助手")) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = t("返回")) }
                },
                actions = {
                    if (state.messages.isNotEmpty()) {
                        IconButton(onClick = { viewModel.clearConversation() }) {
                            Icon(Icons.Filled.DeleteSweep, contentDescription = t("清空对话"))
                        }
                    }
                    IconButton(onClick = onOpenSettings) {
                        Icon(Icons.Filled.Settings, contentDescription = t("AI 设置"))
                    }
                }
            )
        }
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth())

            // 模型状态 / 未配置提示
            if (!state.loading && !state.configured) {
                Card(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)) {
                    Column(Modifier.padding(12.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Filled.AutoAwesome, contentDescription = null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.primary)
                            Spacer(Modifier.size(8.dp))
                            Text(
                                if (state.configError != null) "无法读取 AI 配置" else "尚未配置模型 API",
                                style = MaterialTheme.typography.titleSmall
                            )
                        }
                        Spacer(Modifier.height(6.dp))
                        Text(
                            state.configError
                                ?: "配置任意兼容 OpenAI Chat Completions 的 HTTPS 服务后即可对话、解释邮件与生成摘要。",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Spacer(Modifier.height(8.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = onOpenSettings) { Text(t("配置模型 API")) }
                            if (state.configError != null) {
                                OutlinedButton(onClick = { viewModel.refreshConfig() }) { Text(t("重试")) }
                            }
                        }
                    }
                }
            } else if (state.configured) {
                Text(
                    "已连接 ${state.providerLabel.ifBlank { "模型服务" }}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 6.dp)
                )
            }

            LazyColumn(
                state = listState,
                modifier = Modifier.weight(1f).fillMaxWidth(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                if (state.messages.isEmpty() && !state.loading) {
                    item {
                        Text(
                            if (state.configured) {
                                "你好，我可以回答问题、解释你从邮件详情带入的邮件，或帮你起草回复。AI 生成的回复只是草稿，不会自动发送。"
                            } else {
                                "配置模型 API 后即可开始对话。"
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
                items(state.messages) { message ->
                    MessageBubble(message) { text -> clipboard.setText(AnnotatedString(text)) }
                }
                if (state.busy) {
                    item {
                        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(4.dp)) {
                            CircularProgressIndicator(Modifier.size(14.dp))
                            Spacer(Modifier.size(8.dp))
                            Text(
                                state.busyLabel.ifBlank { "正在处理…" },
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }

            // 摘要 & 输入区
            Surface(tonalElevation = 2.dp) {
                Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box {
                            OutlinedButton(onClick = { scopeMenu = true }, enabled = state.configured && !state.busy) {
                                Text(t("摘要：${viewModel.scopeLabel(digestScope)}"))
                            }
                            DropdownMenu(expanded = scopeMenu, onDismissRequest = { scopeMenu = false }) {
                                DropdownMenuItem(
                                    text = { Text(t("所有已连接邮箱")) },
                                    onClick = { digestScope = "all"; scopeMenu = false }
                                )
                                state.accounts.forEach { account ->
                                    DropdownMenuItem(
                                        text = { Text(account.label?.takeIf { it.isNotBlank() } ?: account.email ?: account.id) },
                                        onClick = { digestScope = account.id; scopeMenu = false }
                                    )
                                }
                            }
                        }
                        Spacer(Modifier.size(8.dp))
                        TextButton(
                            onClick = { viewModel.generateDigest(digestScope) },
                            enabled = state.configured && !state.busy
                        ) { Text(t("生成昨日 24 小时摘要")) }
                    }
                    Row(verticalAlignment = Alignment.Bottom) {
                        OutlinedTextField(
                            value = input,
                            onValueChange = { input = it },
                            modifier = Modifier.weight(1f),
                            placeholder = { Text(if (state.configured) "输入问题…" else "请先配置模型 API") },
                            enabled = state.configured && !state.busy,
                            maxLines = 4,
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                            keyboardActions = KeyboardActions(onSend = { submit() })
                        )
                        Spacer(Modifier.size(6.dp))
                        IconButton(onClick = { submit() }, enabled = state.configured && !state.busy && input.isNotBlank()) {
                            Icon(Icons.AutoMirrored.Filled.Send, contentDescription = t("发送"))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MessageBubble(message: AiChatMessage, onCopy: (String) -> Unit) {
    val isUser = message.role == "user"
    val containerColor = when {
        message.error -> MaterialTheme.colorScheme.errorContainer
        isUser -> MaterialTheme.colorScheme.primaryContainer
        else -> MaterialTheme.colorScheme.surfaceVariant
    }
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start
    ) {
        Column(Modifier.fillMaxWidth(0.92f)) {
            Text(
                if (isUser) "你" else "AI 助手",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(bottom = 2.dp, start = if (isUser) 0.dp else 2.dp)
            )
            Surface(color = containerColor, shape = MaterialTheme.shapes.medium) {
                Text(
                    message.content,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)
                )
            }
            if (!isUser && !message.error) {
                TextButton(onClick = { onCopy(message.content) }, modifier = Modifier.height(28.dp)) {
                    Text("复制", style = MaterialTheme.typography.labelSmall)
                }
            }
        }
    }
}