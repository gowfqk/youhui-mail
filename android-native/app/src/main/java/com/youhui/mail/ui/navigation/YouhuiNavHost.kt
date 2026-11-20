package com.youhui.mail.ui.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.platform.LocalContext
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.youhui.mail.YouhuiApplication
import com.youhui.mail.data.local.UnauthorizedBus
import com.youhui.mail.push.PushClient
import com.youhui.mail.ui.auth.LoginScreen
import com.youhui.mail.ui.compose.ComposeScreen
import com.youhui.mail.ui.compose.DraftStore
import com.youhui.mail.ui.compose.ReplyDraft
import com.youhui.mail.ui.devices.DevicesScreen
import com.youhui.mail.ui.detail.MessageDetailScreen
import com.youhui.mail.ui.inbox.InboxScreen
import com.youhui.mail.ui.setup.ServerSetupScreen

object Routes {
    const val SETUP = "setup"
    const val LOGIN = "login"
    const val INBOX = "inbox"
    const val COMPOSE = "compose"
    const val DEVICES = "devices"
    const val DETAIL = "detail/{accountId}/{uid}/{folder}"
    fun detail(accountId: String, uid: Long, folder: String) = "detail/$accountId/$uid/${android.net.Uri.encode(folder)}"
}

/** 导航图：服务端设置 → 登录 → 收件箱/写信 → 邮件详情；401 时全局回到登录页并清理推送。 */
@Composable
fun YouhuiNavHost(
    navController: NavHostController,
    hasServer: Boolean,
    hasSession: Boolean,
    onServerConfigured: (String) -> Unit
) {
    val serviceLocator = (LocalContext.current.applicationContext as YouhuiApplication).serviceLocator

    // 会话失效（TokenAuthenticator 401）→ 清推送任务/登记，清栈回登录页
    val busContext = LocalContext.current
    LaunchedEffect(Unit) {
        UnauthorizedBus.events.collect {
            PushClient.handleLoggedOut(busContext, serviceLocator)
            navController.navigate(Routes.LOGIN) { popUpTo(0) { inclusive = true } }
        }
    }

    val start = if (!hasServer) Routes.SETUP else if (!hasSession) Routes.LOGIN else Routes.INBOX

    NavHost(navController = navController, startDestination = start) {
        composable(Routes.SETUP) {
            ServerSetupScreen(
                onConfigured = { normalizedUrl ->
                    onServerConfigured(normalizedUrl)
                    navController.navigate(Routes.LOGIN) { popUpTo(0) { inclusive = true } }
                }
            )
        }
        composable(Routes.LOGIN) {
            LoginScreen(
                serviceLocator = serviceLocator,
                onLoggedIn = {
                    navController.navigate(Routes.INBOX) { popUpTo(0) { inclusive = true } }
                },
                onChangeServer = {
                    navController.navigate(Routes.SETUP) { popUpTo(0) { inclusive = true } }
                }
            )
        }
        composable(Routes.INBOX) {
            // 登录到位：尝试启用推送（权限请求/FCM 登记，失败静默降级）
            val pushContext = LocalContext.current
            LaunchedEffect(Unit) { PushClient.ensurePush(pushContext, serviceLocator) }
            InboxScreen(
                serviceLocator = serviceLocator,
                onOpenMessage = { accountId, uid, folder ->
                    navController.navigate(Routes.detail(accountId, uid, folder))
                },
                onCompose = { navController.navigate(Routes.COMPOSE) },
                onDevices = { navController.navigate(Routes.DEVICES) }
            )
        }
        composable(Routes.COMPOSE) {
            ComposeScreen(
                serviceLocator = serviceLocator,
                onFinished = { navController.popBackStack() }
            )
        }
        composable(Routes.DEVICES) {
            DevicesScreen(
                serviceLocator = serviceLocator,
                onBack = { navController.popBackStack() },
                onSessionRevokedSelf = {
                    navController.navigate(Routes.LOGIN) { popUpTo(0) { inclusive = true } }
                }
            )
        }
        composable(
            Routes.DETAIL,
            arguments = listOf(
                navArgument("accountId") { type = NavType.StringType },
                navArgument("uid") { type = NavType.LongType },
                navArgument("folder") { type = NavType.StringType }
            )
        ) { entry ->
            val accountId = entry.arguments?.getString("accountId") ?: return@composable
            val uid = entry.arguments?.getLong("uid") ?: return@composable
            val folder = entry.arguments?.getString("folder") ?: "INBOX"
            MessageDetailScreen(
                serviceLocator = serviceLocator,
                accountId = accountId,
                uid = uid,
                folder = folder,
                onBack = { navController.popBackStack() },
                onReply = { message ->
                    DraftStore.set(ReplyDraft.fromMessage(message, defaultAccount = null))
                    navController.navigate(Routes.COMPOSE)
                }
            )
        }
    }
}
