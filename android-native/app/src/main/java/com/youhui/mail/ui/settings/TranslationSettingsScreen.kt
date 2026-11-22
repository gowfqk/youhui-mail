package com.youhui.mail.ui.settings

import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Translate
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
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
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.viewmodel.compose.viewModel
import com.youhui.mail.data.remote.dto.TranslationConfigReq
import com.youhui.mail.di.ServiceLocator

private val providerLabels = mapOf(
    "niutrans" to "小牛翻译",
    "google" to "Google Cloud Translation",
    "azure" to "Azure Translator"
)

/** 邮件翻译设置：目标语言固定为简体中文，凭据加密保存且不回显。 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun TranslationSettingsScreen(
    serviceLocator: ServiceLocator,
    onBack: () -> Unit
) {
    val viewModel: TranslationSettingsViewModel = viewModel(factory = TranslationSettingsViewModel.Factory(serviceLocator))
    val state by viewModel.state.collectAsState()
    val snackbar = remember { SnackbarHostState() }

    val config = state.config
    var provider by remember(config?.provider) { mutableStateOf(config?.provider ?: "niutrans") }
    var niutransAppId by remember { mutableStateOf("") }
    var niutransApiKey by remember { mutableStateOf("") }
    var googleApiKey by remember { mutableStateOf("") }
    var azureApiKey by remember { mutableStateOf("") }
    var azureRegion by remember { mutableStateOf("") }
    var confirmClear by remember { mutableStateOf(false) }

    LifecycleResumeEffect(Unit) {
        viewModel.refresh()
        onPauseOrDispose { }
    }
    LaunchedEffect(state.error) {
        state.error?.let { snackbar.showSnackbar(it); viewModel.consumeMessages() }
    }
    LaunchedEffect(state.info) {
        state.info?.let { snackbar.showSnackbar(it); viewModel.consumeMessages() }
    }

    fun payload() = TranslationConfigReq(
        provider = provider,
        niutransAppId = niutransAppId.trim(),
        niutransApiKey = niutransApiKey.trim(),
        googleApiKey = googleApiKey.trim(),
        azureApiKey = azureApiKey.trim(),
        azureRegion = azureRegion.trim()
    )

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = { Text("邮件翻译") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回") }
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
                        Icon(Icons.Filled.Translate, contentDescription = null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.primary)
                        Spacer(Modifier.size(8.dp))
                        Text("专用邮件翻译服务", style = MaterialTheme.typography.titleSmall)
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "只调用当前选中的服务商；目标语言固定为简体中文。留空凭据表示保留已保存的值。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(Modifier.height(10.dp))
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        providerLabels.forEach { (id, label) ->
                            FilterChip(
                                selected = provider == id,
                                onClick = { provider = id },
                                label = { Text(label) }
                            )
                        }
                    }
                    Spacer(Modifier.height(10.dp))

                    when (provider) {
                        "niutrans" -> {
                            Text("小牛翻译（Niutrans）", style = MaterialTheme.typography.labelLarge)
                            Spacer(Modifier.height(6.dp))
                            OutlinedTextField(
                                value = niutransAppId,
                                onValueChange = { niutransAppId = it.take(200) },
                                label = { Text("App ID") },
                                placeholder = {
                                    Text(if (config?.hasNiuTransAppId == true) "已保存；留空保留" else "小牛翻译控制台中的 App ID")
                                },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth()
                            )
                            Spacer(Modifier.height(8.dp))
                            OutlinedTextField(
                                value = niutransApiKey,
                                onValueChange = { niutransApiKey = it.take(4096) },
                                label = { Text("API Key（apikey）") },
                                placeholder = {
                                    Text(if (config?.hasNiuTransApiKey == true) "已保存；留空保留" else "输入小牛翻译 API Key")
                                },
                                visualTransformation = PasswordVisualTransformation(),
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth()
                            )
                        }
                        "google" -> {
                            Text("Google Cloud Translation", style = MaterialTheme.typography.labelLarge)
                            Spacer(Modifier.height(6.dp))
                            OutlinedTextField(
                                value = googleApiKey,
                                onValueChange = { googleApiKey = it.take(4096) },
                                label = { Text("API Key") },
                                placeholder = {
                                    Text(if (config?.hasGoogleApiKey == true) "已保存；留空保留" else "输入 Google Cloud Translation API Key")
                                },
                                visualTransformation = PasswordVisualTransformation(),
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth()
                            )
                        }
                        "azure" -> {
                            Text("Azure Translator", style = MaterialTheme.typography.labelLarge)
                            Spacer(Modifier.height(6.dp))
                            OutlinedTextField(
                                value = azureApiKey,
                                onValueChange = { azureApiKey = it.take(4096) },
                                label = { Text("API Key") },
                                placeholder = {
                                    Text(if (config?.hasAzureApiKey == true) "已保存；留空保留" else "输入 Azure Translator Key")
                                },
                                visualTransformation = PasswordVisualTransformation(),
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth()
                            )
                            Spacer(Modifier.height(8.dp))
                            OutlinedTextField(
                                value = azureRegion,
                                onValueChange = { azureRegion = it.take(100) },
                                label = { Text("资源区域（Region）") },
                                placeholder = {
                                    Text(if (config?.hasAzureRegion == true) "已保存；留空保留" else "例如 eastasia")
                                },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth()
                            )
                        }
                    }
                }
            }

            Text(
                "只有你在邮件里点「译」时，正文才会发送到所选翻译服务商；附件不发送，最多 12,000 个字符，较长内容分块翻译。服务商可能按字符计费。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(vertical = 8.dp)
            )

            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = { viewModel.save(payload()) },
                    enabled = state.busy == null && !state.loading,
                    modifier = Modifier.weight(1f)
                ) { Text("保存翻译设置") }
                OutlinedButton(
                    onClick = { confirmClear = true },
                    enabled = state.busy == null && (config?.hasNiuTransAppId == true || config?.hasNiuTransApiKey == true ||
                        config?.hasGoogleApiKey == true || config?.hasAzureApiKey == true || config?.hasAzureRegion == true)
                ) { Text("清除配置") }
            }
            Spacer(Modifier.height(24.dp))
        }
    }

    if (confirmClear) {
        AlertDialog(
            onDismissRequest = { confirmClear = false },
            title = { Text("清除翻译配置？") },
            text = { Text("会删除加密保存的所有翻译服务商凭据；不会影响 AI 配置、邮箱账户或邮件。") },
            confirmButton = {
                TextButton(onClick = { confirmClear = false; viewModel.clearConfig() }) { Text("清除") }
            },
            dismissButton = { TextButton(onClick = { confirmClear = false }) { Text("取消") } }
        )
    }
}