package com.youhui.mail.ui.ai

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.youhui.mail.data.remote.dto.AccountSummaryDto
import com.youhui.mail.data.remote.dto.AiConfigDto
import com.youhui.mail.data.remote.dto.AiConfigReq
import com.youhui.mail.data.remote.readableMessage
import com.youhui.mail.di.ServiceLocator
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

data class AiSettingsUiState(
    val loading: Boolean = true,
    val config: AiConfigDto? = null,
    val accounts: List<AccountSummaryDto> = emptyList(),
    val busy: String? = null,
    val error: String? = null,
    val info: String? = null,
    val saved: Boolean = false   // 保存成功后返回上一页
)

/** AI 模型设置：对齐网页工作台「AI 助手」面板的配置项。 */
class AiSettingsViewModel(private val locator: ServiceLocator) : ViewModel() {

    private val _state = MutableStateFlow(AiSettingsUiState())
    val state: StateFlow<AiSettingsUiState> = _state

    init { refresh() }

    fun refresh() {
        _state.value = _state.value.copy(loading = true, error = null)
        viewModelScope.launch {
            val api = locator.api()
            val config = runCatching { api.aiConfig() }.getOrNull()
            val accounts = runCatching { api.accounts() }.getOrNull()
            _state.value = _state.value.copy(
                loading = false,
                config = config ?: _state.value.config,
                accounts = accounts?.accounts?.map {
                    AccountSummaryDto(it.id, it.label, it.email, it.provider)
                }.orEmpty(),
                error = if (config == null) "无法读取 AI 配置，请检查网络与服务端版本。" else null
            )
        }
    }

    fun save(body: AiConfigReq) {
        _state.value = _state.value.copy(busy = "正在保存…", error = null, info = null)
        viewModelScope.launch {
            try {
                val config = locator.api().updateAiConfig(body)
                _state.value = _state.value.copy(config = config, saved = true, info = "设置已保存；API Key 不会回显。")
            } catch (e: Exception) {
                _state.value = _state.value.copy(error = e.readableMessage())
            } finally {
                _state.value = _state.value.copy(busy = null)
            }
        }
    }

    fun test(body: AiConfigReq) {
        _state.value = _state.value.copy(busy = "正在测试 API；模型服务可能收取少量费用…", error = null, info = null)
        viewModelScope.launch {
            try {
                val result = locator.api().testAi(body)
                val message = listOfNotNull(result.message, result.sample?.let { "（$it）" }).joinToString("")
                _state.value = _state.value.copy(info = message.ifBlank { "连接成功。" })
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
                locator.api().deleteAiConfig()
                _state.value = _state.value.copy(config = AiConfigDto(), info = "AI 配置与已保存摘要已清除。")
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
        override fun <T : ViewModel> create(modelClass: Class<T>): T = AiSettingsViewModel(locator) as T
    }
}