package com.youhui.mail

import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.navigation.compose.rememberNavController
import com.youhui.mail.push.PushClient
import com.youhui.mail.ui.navigation.YouhuiNavHost
import com.youhui.mail.ui.theme.YouhuiTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            YouhuiTheme {
                // 会话/服务器状态是唯一事实来源：由 TokenStore 驱动首屏路由
                val locator = (application as YouhuiApplication).serviceLocator
                val hasSession by locator.tokenStore.sessionState.collectAsState()
                var hasServer by remember {
                    mutableStateOf(locator.tokenStore.serverUrl != null)
                }
                val navController = rememberNavController()
                YouhuiNavHost(
                    navController = navController,
                    hasServer = hasServer,
                    hasSession = hasSession,
                    onServerConfigured = {
                        locator.tokenStore.serverUrl = it
                        hasServer = true
                    }
                )
            }
        }
    }

    @Deprecated("Deprecated in framework")
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == PushClient.PERMISSION_REQUEST) {
            PushClient.onPermissionResult(this, (application as YouhuiApplication).serviceLocator)
        }
    }
}
