package com.youhui.mail.ui.setup

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.youhui.mail.util.UrlGuards
import com.youhui.mail.util.t

/** 首次启动：输入邮汇 HTTPS 根地址（对齐现有 WebView 版校验规则）。 */
@Composable
fun ServerSetupScreen(onConfigured: (String) -> Unit) {
    var raw by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(t("邮汇"), style = MaterialTheme.typography.displaySmall)
        Spacer(Modifier.height(8.dp))
        Text(t("输入你的邮汇服务器地址以开始使用"), style = MaterialTheme.typography.bodyMedium)
        Spacer(Modifier.height(24.dp))
        OutlinedTextField(
            value = raw,
            onValueChange = { raw = it; error = null },
            label = { Text(t("服务器地址")) },
            placeholder = { Text("https://mail.example.com") },
            singleLine = true,
            isError = error != null,
            supportingText = { error?.let { Text(it) } },
            modifier = Modifier.fillMaxWidth()
        )
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = {
                val normalized = UrlGuards.normalizeServerUrl(raw)
                if (normalized == null) {
                    error = t("仅接受 HTTPS 根地址（例如 https://mail.example.com）")
                } else {
                    onConfigured(normalized)
                }
            },
            modifier = Modifier.fillMaxWidth()
        ) { Text(t("继续")) }
        Spacer(Modifier.height(12.dp))
        Text(
            t("仅接受 HTTPS 根地址，以保护登录会话和邮件内容。"),
            style = MaterialTheme.typography.bodySmall
        )
    }
}
