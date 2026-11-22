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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material3.AlertDialog
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.youhui.mail.data.remote.dto.AiConfigReq
import com.youhui.mail.di.ServiceLocator
import com.youhui.mail.util.t

/** AI 模型设置（对齐网页工作台「AI 助手」）：服务商、地址、模型、Key 与每日摘要。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AiSettingsScreen(
    serviceLocator: ServiceLocator,
    onBack: () -> Unit
) {
    val viewModel: AiSettingsViewModel = viewModel(factory = AiSettingsViewModel.Factory(serviceLocator))
    val state by viewModel.state.collectAsState()
    val snackbar = remember { SnackbarHostState() }

    val config = state.config
    var providerName by remember(config?.providerName) { mutableStateOf(config?.providerName.orEmpty()) }
    var baseUrl by remember(config?.baseUrl) { mutableStateOf(config?.baseUrl ?: "https://api.openai.com/v1") }
    var model by remember(config?.model) { mutableStateOf(config?.model.orEmpty()) }
    var apiKey by remember { mutableStateOf("") }
    var dailyEnabled by remember(config?.dailySummaryEnabled) { mutableStateOf(config?.dailySummaryEnabled == true) }
    var dailyTime by remember(config?.dailySummaryTime) { mutableStateOf(config?.dailySummaryTime ?: "08:00") }
    var dailyAccountId by remember(config?.dailySummaryAccountId) {
        mutableStateOf(config?.dailySummaryAccountId ?: "all")
    }
    var accountMenu by remember { mutableStateOf(false) }
    var confirmClear by remember { mutableStateOf(false) }

    LaunchedEffect(state.error) {
        state.error?.let { snackbar.showSnackbar(it); viewModel.consumeMessages() }
    }
    LaunchedEffect(state.info) {
        state.info?.let { snackbar.showSnackbar(it); viewModel.consumeMessages() }
    }

    fun payload() = AiConfigReq(
        providerName = providerName.trim().ifBlank { "自定义服务商" },
        baseUrl = baseUrl.trim(),
        model = model.trim(),
        apiKey = apiKey.trim(),
        dailySummaryEnabled = dailyEnabled,
        dailySummaryTime = dailyTime.trim().ifBlank { "08:00" },
        dailySummaryAccountId = dailyAccountId
    )

    fun accountLabel(): String {
        if (dailyAccountId == "all") return "所有已连接邮箱"
        val account = state.accounts.firstOrNull { it.id == dailyAccountId }
        return account?.label?.takeIf { it.isNotBlank() } ?: account?.email ?: "所有已连接邮箱"
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = { Text(t("AI 助手设置")) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = t("返回")) }
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

            Card(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                Column(Modifier.padding(12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.AutoAwesome, contentDescription = null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.primary)
                        Spacer(Modifier.size(8.dp))
                        Text("模型服务", style = MaterialTheme.typography.titleSmall)
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "填写任意提供 OpenAI Chat Completions 兼容接口的 HTTPS 模型服务。API Key 加密保存在服务端，不会回显；留空表示保留已保存的 Key。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(Modifier.height(12.dp))
                    OutlinedTextField(
                        value = providerName,
                        onValueChange = { providerName = it.take(80) },
                        label = { Text(t("服务商名称")) },
                        placeholder = { Text(t("例如 OpenAI 或自定义服务商")) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = baseUrl,
                        onValueChange = { baseUrl = it.take(500) },
                        label = { Text(t("API 根地址")) },
                        placeholder = { Text("https://api.your-provider.com/v1") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = model,
                        onValueChange = { model = it.take(200) },
                        label = { Text(t("模型名称")) },
                        placeholder = { Text(t("服务商提供的模型 ID")) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = apiKey,
                        onValueChange = { apiKey = it.take(4096) },
                        label = { Text(t("模型 API Key")) },
                        placeholder = {
                            Text(if (config?.hasApiKey == true) "已保存；留空保留，输入新 Key 可替换" else "输入模型 API Key")
                        },
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            }

            Card(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                Column(Modifier.padding(12.dp)) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("每日自动摘要", style = MaterialTheme.typography.titleSmall)
                            Text(
                                "启用后每天按设定时间生成最近 24 小时收件摘要；邮件摘录会发送到上述模型 API，可能产生费用。",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        Switch(checked = dailyEnabled, onCheckedChange = { dailyEnabled = it })
                    }
                    if (dailyEnabled) {
                        Spacer(Modifier.height(12.dp))
                        OutlinedTextField(
                            value = dailyTime,
                            onValueChange = { dailyTime = it.take(5) },
                            label = { Text(t("生成时间（香港时间）")) },
                            placeholder = { Text("08:00") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth()
                        )
                        Spacer(Modifier.height(8.dp))
                        Text("摘要范围", style = MaterialTheme.typography.labelLarge)
                        Spacer(Modifier.height(4.dp))
                        Box {
                            OutlinedButton(onClick = { accountMenu = true }, enabled = state.accounts.isNotEmpty()) {
                                Text(accountLabel())
                            }
                            DropdownMenu(expanded = accountMenu, onDismissRequest = { accountMenu = false }) {
                                DropdownMenuItem(
                                    text = { Text(t("所有已连接邮箱")) },
                                    onClick = { dailyAccountId = "all"; accountMenu = false }
                                )
                                state.accounts.forEach { account ->
                                    DropdownMenuItem(
                                        text = { Text(account.label?.takeIf { it.isNotBlank() } ?: account.email ?: account.id) },
                                        onClick = { dailyAccountId = account.id; accountMenu = false }
                                    )
                                }
                            }
                        }
                        Spacer(Modifier.height(4.dp))
                        Text(
                            "仅读取最近 24 小时收件箱；最多 20 个邮箱、合计 40 封；附件不会发送。",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }

            Text(
                "聊天、主动选择的邮件和摘要内容会发送到你填写的模型服务商。摘要加密保存在服务端并保留最近 45 天。AI 只提供解释和草稿，不会替你发送邮件。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(vertical = 8.dp)
            )

            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = { viewModel.save(payload()) },
                    enabled = state.busy == null && !state.loading,
                    modifier = Modifier.weight(1f)
                ) { Text(t("保存设置")) }
                OutlinedButton(
                    onClick = { viewModel.test(payload()) },
                    enabled = state.busy == null && !state.loading,
                    modifier = Modifier.weight(1f)
                ) { Text(t("测试 API")) }
            }
            TextButton(
                onClick = { confirmClear = true },
                enabled = state.busy == null && config?.configured == true,
                modifier = Modifier.fillMaxWidth()
            ) { Text(t("清除 AI 配置与已保存摘要")) }
            Spacer(Modifier.height(24.dp))
        }
    }

    if (confirmClear) {
        AlertDialog(
            onDismissRequest = { confirmClear = false },
            title = { Text(t("清除 AI 配置？")) },
            text = { Text(t("会删除加密保存的 API Key、模型设置和已保存的 AI 摘要；不会影响邮箱账户或邮件。")) },
            confirmButton = {
                TextButton(onClick = { confirmClear = false; viewModel.clearConfig() }) { Text(t("清除")) }
            },
            dismissButton = { TextButton(onClick = { confirmClear = false }) { Text(t("取消")) } }
        )
    }
}