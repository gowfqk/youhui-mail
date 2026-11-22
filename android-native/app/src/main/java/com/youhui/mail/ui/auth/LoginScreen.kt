package com.youhui.mail.ui.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.youhui.mail.data.remote.dto.StatusDto
import com.youhui.mail.data.remote.readableMessage
import com.youhui.mail.data.repository.AuthRepository
import com.youhui.mail.data.repository.toUserMessage
import com.youhui.mail.di.ServiceLocator
import com.youhui.mail.util.t
import kotlinx.coroutines.launch

private val providerLabels = mapOf(
    "google" to "Google",
    "github" to "GitHub",
    "cloudflare" to "Cloudflare"
)

/** 密码登录 / 第三方身份 OAuth 回环 → 令牌存 EncryptedSharedPreferences。 */
@Composable
fun LoginScreen(
    serviceLocator: ServiceLocator,
    onLoggedIn: () -> Unit,
    onChangeServer: () -> Unit
) {
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var oauthBusyProvider by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var identityProviders by remember { mutableStateOf<Map<String, Boolean>>(emptyMap()) }
    val scope = rememberCoroutineScope()
    val serverUrl = serviceLocator.tokenStore.serverUrl.orEmpty()
    val activityContext = LocalContext.current

    // 拉取服务端第三方身份绑定状态（仅显示已绑定的登录方式）
    LaunchedEffect(Unit) {
        runCatching { serviceLocator.authRepository().status() }.onSuccess { s ->
            identityProviders = s.identityProviders
        }
    }

    fun startOAuth(provider: String) {
        if (oauthBusyProvider != null) return
        oauthBusyProvider = provider
        error = null
        scope.launch {
            try {
                OAuthLoopback.login(activityContext, serviceLocator, provider)
                onLoggedIn()
            } catch (e: Exception) {
                // readableMessage 优先透出服务端 { error } 文案（如 state/PKCE 校验失败的具体原因）
                error = e.readableMessage()
            } finally {
                oauthBusyProvider = null
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(t("解锁邮箱工作台"), style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(4.dp))
        Text(serverUrl, style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(24.dp))
        OutlinedTextField(
            value = password,
            onValueChange = { password = it; error = null },
            label = { Text(t("工作台密码")) },
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            singleLine = true,
            isError = error != null,
            supportingText = { error?.let { Text(it) } },
            modifier = Modifier.fillMaxWidth()
        )
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = {
                if (busy) return@Button
                busy = true
                error = null
                scope.launch {
                    try {
                        val repo = AuthRepository(serviceLocator.api(), serviceLocator.tokenStore)
                        repo.loginWithPassword(password)
                        onLoggedIn()
                    } catch (e: Exception) {
                        error = e.toUserMessage()
                    } finally {
                        busy = false
                    }
                }
            },
            enabled = password.length >= 12 && !busy,
            modifier = Modifier.fillMaxWidth()
        ) { Text(if (busy) t("正在解锁…") else t("解锁")) }

        // 第三方身份 OAuth 回环登录（仅显示已在工作台绑定的登录方式）
        val boundProviders = providerLabels.filterKeys { identityProviders[it] == true }.map { it.key to it.value }
        if (boundProviders.isNotEmpty()) {
            Spacer(Modifier.height(20.dp))
            Text(t("或使用已绑定的身份登录"), style = MaterialTheme.typography.labelLarge)
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for ((provider, label) in boundProviders) {
                    OutlinedButton(
                        onClick = { startOAuth(provider) },
                        enabled = oauthBusyProvider == null
                    ) {
                        Text(if (oauthBusyProvider == provider) t("跳转中…") else label)
                    }
                }
            }
            Text(
                t("需先在网页版工作台“设置”中绑定对应身份。"),
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(top = 4.dp)
            )
        }

        Spacer(Modifier.height(8.dp))
        TextButton(onClick = onChangeServer) { Text(t("更换服务器地址")) }
    }
}
