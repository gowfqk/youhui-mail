package com.youhui.mail.ui.settings

import android.content.Context
import android.net.Uri
import android.util.Base64
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.youhui.mail.data.remote.dto.AccountSummaryDto
import com.youhui.mail.data.remote.dto.AiConfigDto
import com.youhui.mail.data.remote.dto.DefaultAccountReq
import com.youhui.mail.data.remote.dto.McpConfigDto
import com.youhui.mail.data.remote.dto.TranslationConfigDto
import com.youhui.mail.data.remote.dto.NotificationConfigDto
import com.youhui.mail.data.remote.dto.NotificationConfigReq
import com.youhui.mail.data.repository.AuthRepository
import com.youhui.mail.data.repository.toUserMessage
import com.youhui.mail.di.ServiceLocator
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

data class SettingsUiState(
    val loading: Boolean = false,
    val accounts: List<AccountSummaryDto> = emptyList(),
    val defaultAccountId: String? = null,
    val notification: NotificationConfigDto? = null,
    val aiConfig: AiConfigDto? = null,          // AI 助手配置摘要（未配置时为 null/configured=false）
    val mcpConfig: McpConfigDto? = null,        // MCP 权限与端点
    val translationConfig: TranslationConfigDto? = null, // 邮件翻译配置摘要
    val mcpApprovalCount: Int = 0,              // 待确认的 MCP 操作数
    val identityProviders: Map<String, Boolean> = emptyMap(),
    val serverUrl: String = "",
    val busy: String? = null,          // 正在执行的动作提示（"导出备份…"等）
    val error: String? = null,
    val info: String? = null,
    val restored: Boolean = false       // 恢复完成后需退出到登录页
)

/** 设置页：账户管理 / 新邮件检查 / 备份恢复 / 身份绑定 / 退出登录（对齐网页版设置核心）。 */
class SettingsViewModel(
    private val locator: ServiceLocator,
    private val authRepository: AuthRepository
) : ViewModel() {

    private val _state = MutableStateFlow(SettingsUiState(serverUrl = locator.tokenStore.serverUrl.orEmpty()))
    val state: StateFlow<SettingsUiState> = _state

    init {
        refresh()
    }

    fun refresh() {
        _state.value = _state.value.copy(loading = true, error = null)
        viewModelScope.launch {
            val api = locator.api()
            val accounts = runCatching { api.accounts() }.getOrNull()
            val notification = runCatching { api.notificationConfig() }.getOrNull()
            val aiConfig = runCatching { api.aiConfig() }.getOrNull()
            val mcpConfig = runCatching { api.mcpConfig() }.getOrNull()
            val translationConfig = runCatching { api.translationConfig() }.getOrNull()
            val mcpApprovals = runCatching { api.mcpApprovals() }.getOrNull()?.approvals.orEmpty()
            val status = runCatching { authRepository.status() }.getOrNull()
            _state.value = _state.value.copy(
                loading = false,
                accounts = accounts?.accounts?.map {
                    AccountSummaryDto(it.id, it.label, it.email, it.provider)
                }.orEmpty(),
                defaultAccountId = accounts?.defaultAccountId,
                notification = notification,
                aiConfig = aiConfig ?: _state.value.aiConfig,
                mcpConfig = mcpConfig ?: _state.value.mcpConfig,
                translationConfig = translationConfig ?: _state.value.translationConfig,
                mcpApprovalCount = mcpApprovals.size,
                identityProviders = status?.identityProviders ?: _state.value.identityProviders,
                error = when {
                    accounts == null && notification == null -> "无法加载设置，请检查网络后重试。"
                    else -> null
                }
            )
        }
    }

    // ---------- 账户 ----------

    fun setDefaultAccount(accountId: String) {
        viewModelScope.launch {
            try {
                locator.api().setDefaultAccount(DefaultAccountReq(accountId))
                _state.value = _state.value.copy(defaultAccountId = accountId, info = "已设为默认发件邮箱。")
            } catch (e: Exception) {
                _state.value = _state.value.copy(error = e.toUserMessage())
            }
        }
    }

    fun deleteAccount(account: AccountSummaryDto) {
        _state.value = _state.value.copy(busy = "正在删除账户…")
        viewModelScope.launch {
            try {
                locator.api().deleteAccount(account.id)
                locator.mailCache.wipeAll() // 账户删除后离线缓存可能包含其邮件，保守清理
                _state.value = _state.value.copy(info = "账户已删除。")
                refresh()
            } catch (e: Exception) {
                _state.value = _state.value.copy(error = e.toUserMessage())
            } finally {
                _state.value = _state.value.copy(busy = null)
            }
        }
    }

    // ---------- 通知 ----------

    fun setNotificationsEnabled(enabled: Boolean) {
        val current = _state.value.notification ?: return
        _state.value = _state.value.copy(notification = current.copy(enabled = enabled))
        viewModelScope.launch {
            try {
                val updated = locator.api().updateNotificationConfig(NotificationConfigReq(enabled = enabled))
                _state.value = _state.value.copy(notification = updated)
            } catch (e: Exception) {
                _state.value = _state.value.copy(notification = current, error = e.toUserMessage())
            }
        }
    }

    fun setNotificationInterval(seconds: Int) {
        val current = _state.value.notification ?: return
        _state.value = _state.value.copy(notification = current.copy(intervalSeconds = seconds))
        viewModelScope.launch {
            try {
                val updated = locator.api().updateNotificationConfig(NotificationConfigReq(intervalSeconds = seconds))
                _state.value = _state.value.copy(notification = updated)
            } catch (e: Exception) {
                _state.value = _state.value.copy(notification = current, error = e.toUserMessage())
            }
        }
    }

    // ---------- 身份 ----------

    fun unbindIdentity(provider: String) {
        viewModelScope.launch {
            try {
                locator.api().unbindIdentity(provider)
                _state.value = _state.value.copy(
                    identityProviders = _state.value.identityProviders + (provider to false),
                    info = "已解除该身份的登录绑定。"
                )
            } catch (e: Exception) {
                _state.value = _state.value.copy(error = e.toUserMessage())
            }
        }
    }

    // ---------- 备份 ----------

    /** 导出备份到应用 cache，返回文件路径用于分享（由界面层调用 FileProvider）。 */
    fun exportBackup(context: Context, onReady: (File) -> Unit) {
        _state.value = _state.value.copy(busy = "正在生成备份…")
        viewModelScope.launch {
            try {
                val body = withContext(Dispatchers.IO) { locator.api().exportBackup() }
                val dir = File(context.cacheDir, "backup").apply { mkdirs() }
                val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())
                val target = File(dir, "youhui-backup-$stamp.yhbackup")
                withContext(Dispatchers.IO) {
                    body.byteStream().use { input -> target.outputStream().use { output -> input.copyTo(output) } }
                }
                _state.value = _state.value.copy(info = "备份已生成（${String.format(Locale.US, "%.0f", target.length() / 1024.0)} KB），请选择保存位置。")
                onReady(target)
            } catch (e: Exception) {
                _state.value = _state.value.copy(error = e.toUserMessage())
            } finally {
                _state.value = _state.value.copy(busy = null)
            }
        }
    }

    /**
     * 从选定文件恢复备份（危险操作，界面层应先行确认）。
     * passphrase 为加密备份密码；明文备份留空。
     */
    fun restoreBackup(context: Context, uri: Uri, passphrase: String) {
        _state.value = _state.value.copy(busy = "正在上传并校验备份…")
        viewModelScope.launch {
            try {
                val bytes = withContext(Dispatchers.IO) {
                    context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                        ?: throw java.io.IOException("无法读取所选文件")
                }
                val encoded = java.net.URLEncoder.encode(passphrase, "UTF-8")
                val result = withContext(Dispatchers.IO) {
                    locator.api().restoreBackup(
                        body = bytes.toRequestBody("application/octet-stream".toMediaType()),
                        passphrase = encoded
                    )
                }
                _state.value = _state.value.copy(
                    info = result.message ?: "备份已恢复。",
                    restored = true
                )
            } catch (e: retrofit2.HttpException) {
                val message = runCatching {
                    val text = e.response()?.errorBody()?.string()
                    com.youhui.mail.data.remote.parseApiError(text)
                }.getOrNull()
                _state.value = _state.value.copy(error = message ?: e.toUserMessage())
            } catch (e: Exception) {
                _state.value = _state.value.copy(error = e.toUserMessage())
            } finally {
                _state.value = _state.value.copy(busy = null)
            }
        }
    }

    // ---------- 退出 ----------

    fun logout(onDone: () -> Unit) {
        _state.value = _state.value.copy(busy = "正在退出…")
        viewModelScope.launch {
            runCatching { authRepository.logout() }
            runCatching { locator.mailCache.wipeAll() }
            _state.value = _state.value.copy(busy = null)
            onDone()
        }
    }

    fun clearMessages() {
        _state.value = _state.value.copy(error = null, info = null)
    }

    class Factory(private val locator: ServiceLocator, private val authRepository: AuthRepository) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = SettingsViewModel(locator, authRepository) as T
    }
}