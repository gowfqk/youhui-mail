package com.youhui.mail.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.youhui.mail.data.remote.dto.AccountFormReq
import com.youhui.mail.data.remote.dto.PresetDto
import com.youhui.mail.data.repository.toUserMessage
import com.youhui.mail.di.ServiceLocator
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

data class AccountEditState(
    val presets: Map<String, PresetDto> = emptyMap(),
    val presetKey: String = "custom",
    val email: String = "",
    val password: String = "",
    val label: String = "",
    val imapHost: String = "",
    val imapPort: String = "993",
    val imapSecure: Boolean = true,
    val smtpHost: String = "",
    val smtpPort: String = "465",
    val smtpSecure: Boolean = true,
    val testing: Boolean = false,
    val saving: Boolean = false,
    val error: String? = null,
    val info: String? = null,
    val saved: Boolean = false
)

/** 添加邮箱账户：预设自动填充 IMAP/SMTP，支持测试连接与保存（对齐网页版账户表单）。 */
class AccountEditViewModel(private val locator: ServiceLocator) : ViewModel() {

    private val _state = MutableStateFlow(AccountEditState())
    val state: StateFlow<AccountEditState> = _state

    init {
        viewModelScope.launch {
            runCatching { locator.api().presets() }.onSuccess { result ->
                _state.value = _state.value.copy(presets = result.presets)
            }
        }
    }

    fun selectPreset(key: String) {
        val preset = _state.value.presets[key]
        _state.value = if (preset == null) {
            _state.value.copy(presetKey = "custom")
        } else {
            _state.value.copy(
                presetKey = key,
                imapHost = preset.imapHost,
                imapPort = preset.imapPort.toString(),
                imapSecure = preset.imapSecure,
                smtpHost = preset.smtpHost,
                smtpPort = preset.smtpPort.toString(),
                smtpSecure = preset.smtpSecure
            )
        }
    }

    fun update(
        email: String? = null,
        password: String? = null,
        label: String? = null,
        imapHost: String? = null,
        imapPort: String? = null,
        imapSecure: Boolean? = null,
        smtpHost: String? = null,
        smtpPort: String? = null,
        smtpSecure: Boolean? = null
    ) {
        val s = _state.value
        _state.value = s.copy(
            email = email ?: s.email,
            password = password ?: s.password,
            label = label ?: s.label,
            imapHost = imapHost ?: s.imapHost,
            imapPort = imapPort ?: s.imapPort,
            imapSecure = imapSecure ?: s.imapSecure,
            smtpHost = smtpHost ?: s.smtpHost,
            smtpPort = smtpPort ?: s.smtpPort,
            smtpSecure = smtpSecure ?: s.smtpSecure
        )
    }

    private fun buildRequest(): AccountFormReq? {
        val s = _state.value
        val imapPort = s.imapPort.trim().toIntOrNull()
        val smtpPort = s.smtpPort.trim().toIntOrNull()
        if (s.email.isBlank()) { _state.value = s.copy(error = "请填写邮箱地址。"); return null }
        if (s.password.isBlank()) { _state.value = s.copy(error = "请填写邮箱密码或应用专用密码。"); return null }
        if (s.imapHost.isBlank() || s.smtpHost.isBlank()) { _state.value = s.copy(error = "请填写 IMAP 与 SMTP 服务器地址。"); return null }
        if (imapPort == null || imapPort !in 1..65535 || smtpPort == null || smtpPort !in 1..65535) {
            _state.value = s.copy(error = "端口必须是 1 到 65535 之间的整数。"); return null
        }
        return AccountFormReq(
            email = s.email.trim(),
            password = s.password,
            label = s.label.trim().takeIf { it.isNotBlank() },
            provider = if (s.presetKey == "custom") "custom" else s.presetKey,
            imapHost = s.imapHost.trim(),
            imapPort = imapPort,
            imapSecure = s.imapSecure,
            smtpHost = s.smtpHost.trim(),
            smtpPort = smtpPort,
            smtpSecure = s.smtpSecure
        )
    }

    fun test() {
        if (_state.value.testing || _state.value.saving) return
        val request = buildRequest() ?: return
        _state.value = _state.value.copy(testing = true, error = null, info = null)
        viewModelScope.launch {
            try {
                val result = locator.api().testAccount(request)
                _state.value = _state.value.copy(testing = false, info = result.message ?: "连接验证通过。")
            } catch (e: retrofit2.HttpException) {
                val msg = runCatching { com.youhui.mail.data.remote.parseApiError(e.response()?.errorBody()?.string()) }.getOrNull()
                _state.value = _state.value.copy(testing = false, error = msg ?: e.toUserMessage())
            } catch (e: Exception) {
                _state.value = _state.value.copy(testing = false, error = e.toUserMessage())
            }
        }
    }

    fun save() {
        if (_state.value.testing || _state.value.saving) return
        val request = buildRequest() ?: return
        _state.value = _state.value.copy(saving = true, error = null, info = null)
        viewModelScope.launch {
            try {
                // 服务端会先验证连接再保存，失败会返回明确错误
                val result = locator.api().createAccount(request)
                _state.value = _state.value.copy(saving = false, info = result.message ?: "邮箱已连接。", saved = true)
            } catch (e: retrofit2.HttpException) {
                val msg = runCatching { com.youhui.mail.data.remote.parseApiError(e.response()?.errorBody()?.string()) }.getOrNull()
                _state.value = _state.value.copy(saving = false, error = msg ?: e.toUserMessage())
            } catch (e: Exception) {
                _state.value = _state.value.copy(saving = false, error = e.toUserMessage())
            }
        }
    }

    fun clearMessages() {
        _state.value = _state.value.copy(error = null, info = null)
    }

    class Factory(private val locator: ServiceLocator) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = AccountEditViewModel(locator) as T
    }
}