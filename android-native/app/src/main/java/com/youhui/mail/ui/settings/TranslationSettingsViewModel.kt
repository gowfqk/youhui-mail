package com.youhui.mail.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.youhui.mail.data.remote.dto.TranslationConfigDto
import com.youhui.mail.data.remote.dto.TranslationConfigReq
import com.youhui.mail.data.remote.readableMessage
import com.youhui.mail.di.ServiceLocator
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

data class TranslationSettingsUiState(
    val loading: Boolean = true,
    val config: TranslationConfigDto? = null,
    val busy: String? = null,
    val error: String? = null,
    val info: String? = null
)

/** 邮件翻译设置：服务商与凭据（对齐网页工作台「邮件翻译」面板）。 */
class TranslationSettingsViewModel(private val locator: ServiceLocator) : ViewModel() {

    private val _state = MutableStateFlow(TranslationSettingsUiState())
    val state: StateFlow<TranslationSettingsUiState> = _state

    init { refresh() }

    fun refresh() {
        _state.value = _state.value.copy(loading = true, error = null)
        viewModelScope.launch {
            val config = runCatching { locator.api().translationConfig() }
            _state.value = _state.value.copy(
                loading = false,
                config = config.getOrNull() ?: _state.value.config,
                error = if (config.isFailure) {
                    config.exceptionOrNull()?.readableMessage() ?: "无法读取翻译配置。"
                } else null
            )
        }
    }

    fun save(body: TranslationConfigReq) {
        _state.value = _state.value.copy(busy = "正在保存…", error = null, info = null)
        viewModelScope.launch {
            try {
                val config = locator.api().updateTranslationConfig(body)
                _state.value = _state.value.copy(config = config, info = "翻译设置已保存；凭据不会回显。")
            } catch (e: Exception) {
                _state.value = _state.value.copy(error = e.readableMessage())
            } finally {
                _state.value = _state.value.copy(busy = null)
            }
        }
    }

    fun clearConfig() {
        _state.value = _state.value.copy(busy = "正在清除配置…", error = null, info = null)
        viewModelScope.launch {
            try {
                locator.api().deleteTranslationConfig()
                _state.value = _state.value.copy(
                    config = TranslationConfigDto(),
                    info = "翻译配置已清除。"
                )
            } catch (e: Exception) {
                _state.value = _state.value.copy(error = e.readableMessage())
            } finally {
                _state.value = _state.value.copy(busy = null)
            }
        }
    }

    fun consumeMessages() {
        _state.value = _state.value.copy(error = null, info = null)
    }

    class Factory(private val locator: ServiceLocator) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = TranslationSettingsViewModel(locator) as T
    }
}