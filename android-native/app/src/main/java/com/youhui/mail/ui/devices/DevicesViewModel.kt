package com.youhui.mail.ui.devices

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.youhui.mail.data.repository.AuthRepository
import com.youhui.mail.data.repository.toUserMessage
import com.youhui.mail.data.remote.dto.DeviceSessionDto
import com.youhui.mail.di.ServiceLocator
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

data class DevicesUiState(
    val loading: Boolean = false,
    val sessions: List<DeviceSessionDto> = emptyList(),
    val currentDeviceId: String = "",
    val fcmTokenPresent: Boolean = false,
    val error: String? = null,
    /** 吊销的设备 ID；若吊销的是本机（会话随之失效），UI 回登录页 */
    val revokedSelf: Boolean = false
)

/** 设备会话管理：列出全部移动端会话、吊销、推送登记状态。 */
class DevicesViewModel(
    private val repository: AuthRepository,
    private val locator: ServiceLocator
) : ViewModel() {

    private val _state = MutableStateFlow(DevicesUiState())
    val state: StateFlow<DevicesUiState> = _state

    init {
        refresh()
    }

    fun refresh() {
        _state.value = _state.value.copy(loading = true, error = null)
        viewModelScope.launch {
            try {
                val sessions = repository.listSessions().sessions
                _state.value = _state.value.copy(
                    loading = false,
                    sessions = sessions,
                    currentDeviceId = locator.tokenStore.deviceId,
                    fcmTokenPresent = !locator.tokenStore.fcmToken.isNullOrBlank()
                )
            } catch (e: Exception) {
                _state.value = _state.value.copy(loading = false, error = e.toUserMessage())
            }
        }
    }

    /** 吊销设备会话；push_devices 随外键级联清理。 */
    fun revoke(deviceId: String) {
        viewModelScope.launch {
            try {
                repository.revokeSession(deviceId)
                if (deviceId == locator.tokenStore.deviceId) {
                    // 吊销本机：服务端会话已删，令牌即刻失效
                    locator.tokenStore.clearSession()
                    _state.value = _state.value.copy(revokedSelf = true)
                }
                refresh()
            } catch (e: Exception) {
                _state.value = _state.value.copy(error = e.toUserMessage())
            }
        }
    }

    fun clearError() {
        _state.value = _state.value.copy(error = null)
    }

    class Factory(private val repository: AuthRepository, private val locator: ServiceLocator) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = DevicesViewModel(repository, locator) as T
    }
}
