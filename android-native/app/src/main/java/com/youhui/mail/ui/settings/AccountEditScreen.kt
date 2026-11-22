package com.youhui.mail.ui.settings

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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
import com.youhui.mail.di.ServiceLocator
import com.youhui.mail.util.t

private val presetLabels = mapOf(
    "custom" to "自定义",
    "google" to "Gmail",
    "microsoft" to "Outlook / Microsoft 365",
    "yahoo" to "Yahoo",
    "icloud" to "iCloud",
    "fastmail" to "Fastmail"
)

/** 添加邮箱账户（预设自动填充服务器参数，可手动覆盖）。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccountEditScreen(
    serviceLocator: ServiceLocator,
    onBack: () -> Unit,
    onSaved: () -> Unit
) {
    val viewModel: AccountEditViewModel = viewModel(factory = AccountEditViewModel.Factory(serviceLocator))
    val state by viewModel.state.collectAsState()
    val snackbar = remember { SnackbarHostState() }
    var presetMenu by remember { mutableStateOf(false) }

    LaunchedEffect(state.error) {
        state.error?.let { snackbar.showSnackbar(it); viewModel.clearMessages() }
    }
    LaunchedEffect(state.info) {
        state.info?.let { snackbar.showSnackbar(it); viewModel.clearMessages() }
    }
    LaunchedEffect(state.saved) {
        if (state.saved) onSaved()
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = { Text(t("添加邮箱账户")) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = t("返回")) }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState())
        ) {
            if (state.testing || state.saving) LinearProgressIndicator(Modifier.fillMaxWidth())
            Column(Modifier.padding(horizontal = 12.dp)) {
                Spacer(Modifier.height(8.dp))
                // 预设
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("邮箱服务商", style = MaterialTheme.typography.labelLarge)
                    Spacer(Modifier.size(12.dp))
                    androidx.compose.foundation.layout.Box {
                        OutlinedButton(onClick = { presetMenu = true }) {
                            Text(presetLabels[state.presetKey] ?: state.presetKey)
                        }
                        DropdownMenu(expanded = presetMenu, onDismissRequest = { presetMenu = false }) {
                            val keys = listOf("custom") + state.presets.keys.filter { it != "custom" }
                            keys.forEach { key ->
                                DropdownMenuItem(
                                    text = { Text(presetLabels[key] ?: key) },
                                    onClick = { presetMenu = false; viewModel.selectPreset(key) }
                                )
                            }
                        }
                    }
                }
                Spacer(Modifier.height(4.dp))
                Text(
                    "选择预设后自动填入服务器参数；Google/Microsoft 等需使用应用专用密码。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = state.email,
                    onValueChange = { viewModel.update(email = it) },
                    label = { Text(t("邮箱地址")) },
                    placeholder = { Text("name@example.com") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = state.password,
                    onValueChange = { viewModel.update(password = it) },
                    label = { Text(t("密码 / 应用专用密码")) },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = state.label,
                    onValueChange = { viewModel.update(label = it) },
                    label = { Text(t("显示名称（可选）")) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.height(8.dp))
                Text("收信（IMAP）", style = MaterialTheme.typography.titleSmall)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = state.imapHost,
                        onValueChange = { viewModel.update(imapHost = it) },
                        label = { Text(t("服务器")) },
                        singleLine = true,
                        modifier = Modifier.weight(1f)
                    )
                    OutlinedTextField(
                        value = state.imapPort,
                        onValueChange = { viewModel.update(imapPort = it) },
                        label = { Text(t("端口")) },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.weight(0.4f)
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("加密连接（SSL/TLS）", style = MaterialTheme.typography.bodySmall)
                    FilterChip(
                        selected = state.imapSecure,
                        onClick = { viewModel.update(imapSecure = !state.imapSecure) },
                        label = { Text(if (state.imapSecure) "已启用" else "未启用") }
                    )
                }
                Spacer(Modifier.height(8.dp))
                Text("发信（SMTP）", style = MaterialTheme.typography.titleSmall)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = state.smtpHost,
                        onValueChange = { viewModel.update(smtpHost = it) },
                        label = { Text(t("服务器")) },
                        singleLine = true,
                        modifier = Modifier.weight(1f)
                    )
                    OutlinedTextField(
                        value = state.smtpPort,
                        onValueChange = { viewModel.update(smtpPort = it) },
                        label = { Text(t("端口")) },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.weight(0.4f)
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("加密连接（SSL/TLS）", style = MaterialTheme.typography.bodySmall)
                    FilterChip(
                        selected = state.smtpSecure,
                        onClick = { viewModel.update(smtpSecure = !state.smtpSecure) },
                        label = { Text(if (state.smtpSecure) "已启用" else "未启用") }
                    )
                }
                Spacer(Modifier.height(16.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = { viewModel.test() },
                        enabled = !state.testing && !state.saving,
                        modifier = Modifier.weight(1f)
                    ) {
                        if (state.testing) CircularProgressIndicator(Modifier.size(16.dp))
                        else Text(t("测试连接"))
                    }
                    Button(
                        onClick = { viewModel.save() },
                        enabled = !state.testing && !state.saving,
                        modifier = Modifier.weight(1f)
                    ) {
                        if (state.saving) CircularProgressIndicator(Modifier.size(16.dp))
                        else Text(t("保存账户"))
                    }
                }
                Spacer(Modifier.height(24.dp))
            }
        }
    }
}