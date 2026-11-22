package com.youhui.mail.ui.mcp

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.youhui.mail.data.remote.dto.McpApprovalDto
import com.youhui.mail.data.remote.dto.McpConfigDto
import com.youhui.mail.data.remote.dto.McpPermissionDto
import com.youhui.mail.data.remote.dto.McpScopeReq
import com.youhui.mail.data.remote.dto.McpTokenReq
import com.youhui.mail.data.remote.readableMessage
import com.youhui.mail.di.ServiceLocator
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody

data class McpUiState(
    val loading: Boolean = true,
    val config: McpConfigDto? = null,
    val approvals: List<McpApprovalDto> = emptyList(),
    val busy: String? = null,
    val error: String? = null,
    val info: String? = null,
    val newToken: String? = null,
    val newTokenPermission: String? = null
)

/** Agent / MCP 设置：端点、权限令牌、邮箱范围与待确认操作（对齐网页工作台 MCP 面板）。 */
class McpViewModel(private val locator: ServiceLocator) : ViewModel() {

    private val _state = MutableStateFlow(McpUiState())
    val state: StateFlow<McpUiState> = _state

    private val jsonBody = "{}".toRequestBody("application/json".toMediaType())

    init { refresh() }

    fun refresh() {
        _state.value = _state.value.copy(loading = true, error = null)
        viewModelScope.launch {
            val api = locator.api()
            val config = runCatching { api.mcpConfig() }.getOrNull()
            val approvals = runCatching { api.mcpApprovals() }.getOrNull()?.approvals ?: emptyList()
            _state.value = _state.value.copy(
                loading = false,
                config = config ?: _state.value.config,
                approvals = approvals,
                error = if (config == null) "无法读取 MCP 配置，请检查网络与服务端版本。" else null
            )
        }
    }

    fun refreshApprovals() {
        viewModelScope.launch {
            runCatching { locator.api().mcpApprovals() }.getOrNull()?.let { result ->
                _state.value = _state.value.copy(approvals = result.approvals)
            }
        }
    }

    /**
     * 创建或轮换令牌。all=true 表示访问全部邮箱；否则必须至少选择一个账户。
     * 新令牌只在本次响应中返回，界面需提示用户立即复制。
     */
    fun createToken(permission: String, all: Boolean, ids: Set<String>) {
        if (!all && ids.isEmpty()) {
            _state.value = _state.value.copy(error = "至少选择一个邮箱，或选择全部邮箱。")
            return
        }
        val permissionMeta = _state.value.config?.permissions?.get(permission)
        _state.value = _state.value.copy(busy = if (permissionMeta?.configured == true) "正在轮换令牌…" else "正在创建令牌…", error = null, info = null)
        viewModelScope.launch {
            try {
                val result = locator.api().createMcpToken(
                    McpTokenReq(permission = permission, accountIds = scopeValue(all, ids))
                )
                _state.value = _state.value.copy(
                    newToken = result.token,
                    newTokenPermission = permission,
                    info = "令牌已生成；请立即复制到 Agent 配置中，关闭页面后不再显示。"
                )
                reloadConfigQuietly(permission, all, ids)
            } catch (e: Exception) {
                _state.value = _state.value.copy(error = e.readableMessage())
            } finally {
                _state.value = _state.value.copy(busy = null)
            }
        }
    }

    fun updateScope(permission: String, all: Boolean, ids: Set<String>) {
        if (!all && ids.isEmpty()) {
            _state.value = _state.value.copy(error = "至少选择一个邮箱，或选择全部邮箱。")
            return
        }
        _state.value = _state.value.copy(busy = "正在保存邮箱范围…", error = null, info = null)
        viewModelScope.launch {
            try {
                val result = locator.api().updateMcpScope(permission, McpScopeReq(scopeValue(all, ids)))
                _state.value = _state.value.copy(info = "已保存范围：${scopeLabel(result.accountScope, result.accountIds)}。")
                reloadConfigQuietly(permission, all, ids)
            } catch (e: Exception) {
                _state.value = _state.value.copy(error = e.readableMessage())
            } finally {
                _state.value = _state.value.copy(busy = null)
            }
        }
    }

    fun revokeToken(permission: String) {
        _state.value = _state.value.copy(busy = "正在撤销令牌…", error = null, info = null)
        viewModelScope.launch {
            try {
                locator.api().revokeMcpToken(permission)
                if (_state.value.newTokenPermission == permission) {
                    _state.value = _state.value.copy(newToken = null, newTokenPermission = null)
                }
                _state.value = _state.value.copy(info = "此权限的令牌已撤销。")
                refreshConfigOnly()
            } catch (e: Exception) {
                _state.value = _state.value.copy(error = e.readableMessage())
            } finally {
                _state.value = _state.value.copy(busy = null)
            }
        }
    }

    fun approve(id: String) {
        _state.value = _state.value.copy(busy = "正在执行确认的操作…", error = null, info = null)
        viewModelScope.launch {
            try {
                val result = locator.api().approveMcp(id, jsonBody)
                val warning = result.result?.get("warning")?.jsonPrimitive?.contentOrNull
                val message = result.result?.get("message")?.jsonPrimitive?.contentOrNull
                _state.value = _state.value.copy(info = warning ?: message ?: "操作已完成。")
            } catch (e: Exception) {
                _state.value = _state.value.copy(error = e.readableMessage())
            } finally {
                _state.value = _state.value.copy(busy = null)
                refreshApprovals()
            }
        }
    }

    fun deny(id: String) {
        _state.value = _state.value.copy(busy = "正在拒绝…", error = null, info = null)
        viewModelScope.launch {
            try {
                locator.api().denyMcp(id, jsonBody)
                _state.value = _state.value.copy(info = "已拒绝此 MCP 操作。")
            } catch (e: Exception) {
                _state.value = _state.value.copy(error = e.readableMessage())
            } finally {
                _state.value = _state.value.copy(busy = null)
                refreshApprovals()
            }
        }
    }

    fun clearTokenReveal() {
        _state.value = _state.value.copy(newToken = null, newTokenPermission = null)
    }

    fun scopeLabel(scope: String, ids: List<String>): String {
        if (scope == "all") return "全部已连接邮箱"
        val accounts = _state.value.config?.accounts.orEmpty()
        val labels = ids.map { id ->
            val account = accounts.firstOrNull { it.id == id }
            account?.label?.takeIf { it.isNotBlank() } ?: account?.email ?: id
        }
        return labels.joinToString("、").ifBlank { "所选邮箱" }
    }

    fun permission(permission: String): McpPermissionDto =
        _state.value.config?.permissions?.get(permission) ?: McpPermissionDto()

    fun consumeMessages() {
        _state.value = _state.value.copy(error = null, info = null)
    }

    private fun scopeValue(all: Boolean, ids: Set<String>): JsonElement =
        if (all) JsonPrimitive("all") else JsonArray(ids.map { JsonPrimitive(it) })

    private fun reloadConfigQuietly(permission: String, all: Boolean, ids: Set<String>) {
        viewModelScope.launch {
            runCatching { locator.api().mcpConfig() }.getOrNull()?.let { config ->
                _state.value = _state.value.copy(config = config)
            }
            // 本次保存的范围作为兜底，避免服务端旧版本未回写时界面不一致
            val current = _state.value.config ?: return@launch
            val updated = current.permissions.toMutableMap()
            updated[permission] = (updated[permission] ?: McpPermissionDto()).copy(
                configured = true,
                accountScope = if (all) "all" else "selected",
                accountIds = if (all) emptyList() else ids.toList()
            )
            _state.value = _state.value.copy(config = current.copy(permissions = updated))
        }
    }

    private fun refreshConfigOnly() {
        viewModelScope.launch {
            runCatching { locator.api().mcpConfig() }.getOrNull()?.let { config ->
                _state.value = _state.value.copy(config = config)
            }
        }
    }

    class Factory(private val locator: ServiceLocator) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = McpViewModel(locator) as T
    }
}