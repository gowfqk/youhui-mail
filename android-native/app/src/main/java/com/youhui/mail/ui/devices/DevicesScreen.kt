package com.youhui.mail.ui.devices

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Smartphone
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.youhui.mail.di.ServiceLocator
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** 设备会话管理：全部移动端会话、吊销、推送登记状态诊断。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DevicesScreen(
    serviceLocator: ServiceLocator,
    onBack: () -> Unit,
    onSessionRevokedSelf: () -> Unit
) {
    val viewModel: DevicesViewModel = viewModel(
        factory = DevicesViewModel.Factory(serviceLocator.authRepository(), serviceLocator)
    )
    val state by viewModel.state.collectAsState()
    val snackbar = remember { SnackbarHostState() }
    var confirmTarget by remember { mutableStateOf<String?>(null) } // 待吊销设备 ID

    LaunchedEffect(state.error) {
        state.error?.let { snackbar.showSnackbar(it); viewModel.clearError() }
    }
    LaunchedEffect(state.revokedSelf) {
        if (state.revokedSelf) {
            snackbar.showSnackbar("本机会话已吊销，请重新登录。")
            onSessionRevokedSelf()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = { Text("设备管理") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回") }
                }
            )
        }
    ) { padding ->
        Column(modifier = Modifier.padding(padding).fillMaxSize()) {
            if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            Card(Modifier.fillMaxWidth().padding(12.dp)) {
                Column(Modifier.padding(12.dp)) {
                    Text("推送状态", style = MaterialTheme.typography.titleSmall)
                    Spacer(Modifier.height(4.dp))
                    Text(
                        if (state.fcmTokenPresent) "FCM 令牌已获取；新邮件经服务端唤醒后即时拉取。"
                        else "FCM 令牌未获取（服务端未配置推送或权限未授予）；正在使用 15 分钟周期拉取回退。",
                        style = MaterialTheme.typography.bodySmall
                    )
                }
            }
            Text(
                "移动端登录会话（${state.sessions.size}）",
                style = MaterialTheme.typography.titleSmall,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp)
            )
            if (state.sessions.isEmpty() && !state.loading) {
                Text(
                    "暂无其他设备会话。",
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(horizontal = 12.dp)
                )
            }
            LazyColumn(Modifier.fillMaxSize()) {
                items(state.sessions, key = { it.deviceId }) { session ->
                    val isSelf = session.deviceId == state.currentDeviceId
                    Card(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp)) {
                        Row(
                            Modifier.fillMaxWidth().padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(Icons.Filled.Smartphone, contentDescription = null)
                            Column(Modifier.weight(1f).padding(start = 12.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(
                                        session.deviceLabel?.takeIf { it.isNotBlank() } ?: "未命名设备",
                                        style = MaterialTheme.typography.bodyLarge,
                                        fontWeight = if (isSelf) FontWeight.Bold else FontWeight.Normal
                                    )
                                    if (isSelf) {
                                        Text(
                                            "（本机）",
                                            style = MaterialTheme.typography.labelMedium,
                                            color = MaterialTheme.colorScheme.primary,
                                            modifier = Modifier.padding(start = 4.dp)
                                        )
                                    }
                                }
                                Text("设备 ID：${session.deviceId.take(8)}…", style = MaterialTheme.typography.bodySmall)
                                Text("最近活跃：${formatEpoch(session.lastSeenAt)}", style = MaterialTheme.typography.bodySmall)
                                Text("到期时间：${formatEpoch(session.expiresAt)}", style = MaterialTheme.typography.bodySmall)
                            }
                            IconButton(onClick = { confirmTarget = session.deviceId }) {
                                Icon(Icons.Filled.Delete, contentDescription = "吊销此设备会话")
                            }
                        }
                    }
                }
            }
        }
    }

    confirmTarget?.let { deviceId ->
        AlertDialog(
            onDismissRequest = { confirmTarget = null },
            title = { Text("吊销此设备的会话？") },
            text = { Text("吊销后该设备需要重新登录才能访问邮箱；该设备的推送登记也会一并移除。") },
            confirmButton = {
                TextButton(onClick = { confirmTarget = null; viewModel.revoke(deviceId) }) { Text("吊销") }
            },
            dismissButton = {
                TextButton(onClick = { confirmTarget = null }) { Text("取消") }
            }
        )
    }
}

private fun formatEpoch(epochMs: Long): String = if (epochMs <= 0) "未知" else
    SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.getDefault()).format(Date(epochMs))
