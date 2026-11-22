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
import com.youhui.mail.ui.ai.AiChatScreen
import com.youhui.mail.ui.ai.AiSettingsScreen
import com.youhui.mail.ui.compose.ComposeScreen
import com.youhui.mail.ui.compose.DraftStore
import com.youhui.mail.ui.compose.ReplyDraft
import com.youhui.mail.ui.devices.DevicesScreen
import com.youhui.mail.ui.detail.MessageDetailScreen
import com.youhui.mail.ui.inbox.InboxScreen
import com.youhui.mail.ui.mcp.McpSettingsScreen
import com.youhui.mail.ui.settings.AccountEditScreen
import com.youhui.mail.ui.settings.SettingsScreen
import com.youhui.mail.ui.settings.TranslationSettingsScreen
import com.youhui.mail.ui.setup.ServerSetupScreen

object Routes {
    const val SETUP = "setup"
    const val LOGIN = "login"
    const val INBOX = "inbox"
    const val COMPOSE = "compose"
    const val DEVICES = "devices"
    const val SETTINGS = "settings"
    const val ACCOUNT_EDIT = "account-edit"
    const val AI_SETTINGS = "ai-settings"
    const val TRANSLATION_SETTINGS = "translation-settings"
    const val MCP = "mcp"
    const val DETAIL = "detail/{accountId}/{uid}/{folder}"
    const val AI_CHAT = "ai-chat?accountId={accountId}&uid={uid}&folder={folder}&intent={intent}"
    fun detail(accountId: String, uid: Long, folder: String) = "detail/$accountId/$uid/${android.net.Uri.encode(folder)}"
    fun aiChat(accountId: String? = null, uid: Long = 0, folder: String = "INBOX", intent: String = "chat"): String {
        val account = accountId?.let { android.net.Uri.encode(it) }.orEmpty()
        return "ai-chat?accountId=$account&uid=$uid&folder=${android.net.Uri.encode(folder)}&intent=${android.net.Uri.encode(intent)}"
    }
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
                onOpenAi = { navController.navigate(Routes.aiChat()) },
                onSettings = { navController.navigate(Routes.SETTINGS) }
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
        composable(Routes.SETTINGS) {
            SettingsScreen(
                serviceLocator = serviceLocator,
                onBack = { navController.popBackStack() },
                onAddAccount = { navController.navigate(Routes.ACCOUNT_EDIT) },
                onOpenDevices = { navController.navigate(Routes.DEVICES) },
                onOpenAi = { navController.navigate(Routes.aiChat()) },
                onOpenAiSettings = { navController.navigate(Routes.AI_SETTINGS) },
                onOpenMcp = { navController.navigate(Routes.MCP) },
                onOpenTranslationSettings = { navController.navigate(Routes.TRANSLATION_SETTINGS) },
                onLoggedOut = {
                    navController.navigate(Routes.LOGIN) { popUpTo(0) { inclusive = true } }
                }
            )
        }
        composable(Routes.ACCOUNT_EDIT) {
            AccountEditScreen(
                serviceLocator = serviceLocator,
                onBack = { navController.popBackStack() },
                onSaved = { navController.popBackStack() }
            )
        }
        composable(
            Routes.AI_CHAT,
            arguments = listOf(
                navArgument("accountId") { type = NavType.StringType; nullable = true; defaultValue = "" },
                navArgument("uid") { type = NavType.LongType; defaultValue = 0L },
                navArgument("folder") { type = NavType.StringType; defaultValue = "INBOX" },
                navArgument("intent") { type = NavType.StringType; defaultValue = "chat" }
            )
        ) { entry ->
            val seedAccountId = entry.arguments?.getString("accountId")?.takeIf { it.isNotBlank() }
            val seedUid = entry.arguments?.getLong("uid") ?: 0L
            val seedFolder = entry.arguments?.getString("folder") ?: "INBOX"
            val seedIntent = entry.arguments?.getString("intent") ?: "chat"
            AiChatScreen(
                serviceLocator = serviceLocator,
                onBack = { navController.popBackStack() },
                onOpenSettings = { navController.navigate(Routes.AI_SETTINGS) },
                seedAccountId = seedAccountId,
                seedUid = seedUid,
                seedFolder = seedFolder,
                seedIntent = seedIntent
            )
        }
        composable(Routes.AI_SETTINGS) {
            AiSettingsScreen(
                serviceLocator = serviceLocator,
                onBack = { navController.popBackStack() }
            )
        }
        composable(Routes.TRANSLATION_SETTINGS) {
            TranslationSettingsScreen(
                serviceLocator = serviceLocator,
                onBack = { navController.popBackStack() }
            )
        }
        composable(Routes.MCP) {
            McpSettingsScreen(
                serviceLocator = serviceLocator,
                onBack = { navController.popBackStack() }
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
                },
                onAi = { intent ->
                    navController.navigate(Routes.aiChat(accountId, uid, folder, intent))
                },
                onOpenTranslationSettings = { navController.navigate(Routes.TRANSLATION_SETTINGS) }
            )
        }
    }
}
