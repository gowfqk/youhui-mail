package com.youhui.mail.ui.ai

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.youhui.mail.data.remote.dto.AccountSummaryDto
import com.youhui.mail.data.remote.dto.AiChatReq
import com.youhui.mail.data.remote.dto.AiDigestDto
import com.youhui.mail.data.remote.dto.AiDigestReq
import com.youhui.mail.data.remote.dto.AiEmailContextDto
import com.youhui.mail.data.remote.dto.AiMessageDto
import com.youhui.mail.data.remote.dto.MessageDto
import com.youhui.mail.data.remote.readableMessage
import com.youhui.mail.di.ServiceLocator
import com.youhui.mail.util.Formatters
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

data class AiChatMessage(
    val role: String,                 // user / assistant
    val content: String,
    val error: Boolean = false,
    val digest: AiDigestDto? = null
)

data class AiChatUiState(
    val loading: Boolean = true,
    val configLoaded: Boolean = false,
    val configError: String? = null,
    val configured: Boolean = false,
    val providerLabel: String = "",
    val dailySummaryEnabled: Boolean = false,
    val defaultDigestScope: String = "all",
    val accounts: List<AccountSummaryDto> = emptyList(),
    val messages: List<AiChatMessage> = emptyList(),
    val busy: Boolean = false,
    val busyLabel: String = "",
    val notice: String? = null          // 一次性提示（Snackbar）
)

/** AI 助手：对话、摘要与「解释 / 起草回复」快捷意图（对齐网页工作台 AI 面板）。 */
class AiChatViewModel(
    private val locator: ServiceLocator,
    private val seedAccountId: String? = null,
    private val seedUid: Long = 0,
    private val seedFolder: String = "INBOX",
    private val seedIntent: String = "chat"
) : ViewModel() {

    private val _state = MutableStateFlow(AiChatUiState())
    val state: StateFlow<AiChatUiState> = _state

    private var seedStarted = false
    private var latestDigestLoaded = false

    init {
        refreshConfig()
    }

    /** 每次回到 AI 页都刷新配置（从「模型设置」返回后立即生效）。 */
    fun refreshConfig() {
        val shouldLoadDigest = !latestDigestLoaded
        if (shouldLoadDigest) latestDigestLoaded = true
        val seedId = seedAccountId
        val shouldSeed = !seedStarted && !seedId.isNullOrBlank()
        if (shouldSeed) seedStarted = true
        _state.value = _state.value.copy(loading = !_state.value.configLoaded)
        viewModelScope.launch {
            val api = locator.api()
            val configResult = runCatching { api.aiConfig() }
            val config = configResult.getOrNull()
            val accounts = runCatching { api.accounts() }.getOrNull()
            val configured = config?.configured == true
            _state.value = _state.value.copy(
                loading = false,
                configLoaded = true,
                configError = if (config == null) {
                    configResult.exceptionOrNull()?.readableMessage() ?: "无法读取 AI 配置。"
                } else null,
                configured = configured,
                providerLabel = if (configured) {
                    listOfNotNull(config?.providerName?.takeIf { it.isNotBlank() }, config?.model?.takeIf { it.isNotBlank() })
                        .joinToString(" · ")
                } else "",
                dailySummaryEnabled = config?.dailySummaryEnabled == true,
                defaultDigestScope = config?.dailySummaryAccountId ?: "all",
                accounts = accounts?.accounts?.map {
                    AccountSummaryDto(it.id, it.label, it.email, it.provider)
                }.orEmpty()
            )
            if (configured && config?.dailySummaryEnabled == true && shouldLoadDigest) {
                loadLatestDigest(config.dailySummaryAccountId ?: "all")
            }
            if (shouldSeed && seedId != null) {
                openSeedMail(seedId, seedUid, seedFolder, seedIntent)
            }
        }
    }

    /** 从邮件详情进入：载入邮件作为上下文并自动发起解释 / 起草请求。 */
    private fun openSeedMail(accountId: String, uid: Long, folder: String, intent: String) {
        viewModelScope.launch {
            if (!_state.value.configured) {
                _state.value = _state.value.copy(notice = "请先配置模型 API。")
                return@launch
            }
            val detail = runCatching { locator.mailRepository().message(accountId, uid, folder) }.getOrNull()
            if (detail == null) {
                push(AiChatMessage("assistant", "无法读取这封邮件，可能已被移动或删除。", error = true))
                return@launch
            }
            val prompt = if (intent == "reply") {
                "请根据邮件内容起草一封合适、简洁的中文回复。只生成草稿，不要发送。"
            } else {
                "请用中文解释这封邮件的主旨、对我的明确要求、时间要求和建议的后续动作。"
            }
            send(
                prompt = prompt,
                intent = if (intent == "reply") "reply" else "explain",
                context = mailContext(detail)
            )
        }
    }

    private fun mailContext(detail: MessageDto): AiEmailContextDto {
        val accountEmail = detail.email
            ?: _state.value.accounts.firstOrNull { it.id == detail.accountId }?.email
            ?: ""
        val from = detail.from.joinToString(", ") { address ->
            val name = address.name?.takeIf { it.isNotBlank() }
            val mail = address.address.orEmpty()
            if (name != null) "$name <$mail>" else mail
        }
        return AiEmailContextDto(
            accountEmail = accountEmail,
            subject = detail.subject ?: "(无主题)",
            from = from,
            date = Formatters.dateLong(detail.date),
            text = (detail.text ?: "").take(12_000)
        )
    }

    fun send(prompt: String, intent: String = "chat", context: AiEmailContextDto? = null) {
        val text = prompt.trim()
        if (text.isEmpty() || _state.value.busy) return
        if (!_state.value.configured) {
            _state.value = _state.value.copy(notice = "请先配置模型 API。")
            return
        }
        push(AiChatMessage("user", text))
        _state.value = _state.value.copy(busy = true, busyLabel = "正在等待模型回复（通常 5–30 秒）…")
        viewModelScope.launch {
            try {
                val history = _state.value.messages
                    .filter { !it.error && (it.role == "user" || it.role == "assistant") }
                    .dropLast(1)   // 去掉刚加入的本轮提问
                    .takeLast(14)
                    .map { AiMessageDto(it.role, it.content) }
                val reply = locator.api().aiChat(
                    AiChatReq(message = text, history = history, intent = intent, emailContext = context)
                )
                push(AiChatMessage("assistant", reply.reply.ifBlank { "模型没有返回内容。" }))
            } catch (e: Exception) {
                push(AiChatMessage("assistant", e.readableMessage(), error = true))
            } finally {
                _state.value = _state.value.copy(busy = false, busyLabel = "")
            }
        }
    }

    /** 生成最近 24 小时收件摘要（服务端按天缓存，同日重复请求直接返回）。 */
    fun generateDigest(scope: String) {
        if (_state.value.busy) return
        if (!_state.value.configured) {
            _state.value = _state.value.copy(notice = "请先配置模型 API。")
            return
        }
        push(AiChatMessage("user", "生成最近 24 小时的收件摘要（${scopeLabel(scope)}）。"))
        _state.value = _state.value.copy(busy = true, busyLabel = "正在读取收件箱并生成摘要（可能需要 30 秒以上）…")
        viewModelScope.launch {
            try {
                val digest = locator.api().createAiDigest(AiDigestReq(accountId = scope)).digest
                if (digest == null) {
                    push(AiChatMessage("assistant", "摘要暂不可用，请稍后重试。", error = true))
                } else {
                    push(
                        AiChatMessage(
                            "assistant",
                            "收件摘要（${digest.day} · ${scopeLabel(scope)} · ${digest.messageCount} 封）\n\n${digest.summary}",
                            digest = digest
                        )
                    )
                }
            } catch (e: Exception) {
                push(AiChatMessage("assistant", e.readableMessage(), error = true))
            } finally {
                _state.value = _state.value.copy(busy = false, busyLabel = "")
            }
        }
    }

    private fun loadLatestDigest(scope: String) {
        viewModelScope.launch {
            val digest = runCatching { locator.api().latestAiDigest(scope) }.getOrNull()?.digest ?: return@launch
            if (_state.value.messages.any { it.digest?.day == digest.day }) return@launch
            push(
                AiChatMessage(
                    "assistant",
                    "每日摘要（${digest.day} · ${scopeLabel(scope)}）\n\n${digest.summary}",
                    digest = digest
                )
            )
        }
    }

    fun clearConversation() {
        _state.value = _state.value.copy(messages = emptyList())
        latestDigestLoaded = true
    }

    fun consumeNotice() {
        _state.value = _state.value.copy(notice = null)
    }

    fun scopeLabel(scope: String): String {
        if (scope == "all") return "所有邮箱"
        val account = _state.value.accounts.firstOrNull { it.id == scope }
        return account?.label?.takeIf { it.isNotBlank() } ?: account?.email ?: "所选邮箱"
    }

    private fun push(message: AiChatMessage) {
        _state.value = _state.value.copy(messages = (_state.value.messages + message).takeLast(80))
    }

    class Factory(
        private val locator: ServiceLocator,
        private val seedAccountId: String? = null,
        private val seedUid: Long = 0,
        private val seedFolder: String = "INBOX",
        private val seedIntent: String = "chat"
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            AiChatViewModel(locator, seedAccountId, seedUid, seedFolder, seedIntent) as T
    }
}