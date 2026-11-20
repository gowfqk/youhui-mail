package com.youhui.mail.ui.compose

import android.content.Context
import android.net.Uri
import android.util.Base64
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.youhui.mail.data.remote.dto.AccountDto
import com.youhui.mail.data.remote.dto.SendAttachmentReq
import com.youhui.mail.data.remote.dto.SendReq
import com.youhui.mail.data.repository.MailRepository
import com.youhui.mail.data.repository.toUserMessage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class ComposeUiState(
    val reply: ReplyDraft? = null,
    val accounts: List<AccountDto> = emptyList(),   // id → label/email
    val selectedAccountId: String? = null,
    val to: String = "",
    val cc: String = "",
    val subject: String = "",
    val text: String = "",
    val attachments: List<PickedAttachment> = emptyList(),
    val sending: Boolean = false,
    val error: String? = null,
    val accountsLoaded: Boolean = false
)

/** 写信：字段状态由本 VM 持有；附件内容在发送时经 Dispatchers.IO 读取转 base64。 */
class ComposeViewModel(private val repository: MailRepository) : ViewModel() {

    private val _state = MutableStateFlow(ComposeUiState())
    val state: StateFlow<ComposeUiState> = _state

    init {
        viewModelScope.launch {
            try {
                val accounts = repository.accounts().accounts
                _state.value = _state.value.copy(
                    accounts = accounts,
                    accountsLoaded = true,
                    selectedAccountId = _state.value.selectedAccountId
                        ?: accounts.firstOrNull()?.id
                )
            } catch (error: Exception) {
                _state.value = _state.value.copy(accountsLoaded = true, error = error.toUserMessage())
            }
        }
    }

    fun bindDraft(context: Context) {
        if (_state.value.reply != null) return
        val draft = DraftStore.consume() ?: ReplyDraft(mode = ReplyDraft.Mode.NEW)
        val selected = draft.accountId ?: _state.value.selectedAccountId
        // inReplyTo/references 随 reply 草稿保留在 state.reply 中，sendFrom 时使用
        _state.value = _state.value.copy(
            reply = draft,
            to = draft.to,
            subject = draft.subject,
            selectedAccountId = selected
        )
    }

    fun update(to: String? = null, cc: String? = null, subject: String? = null, text: String? = null) {
        _state.value = _state.value.copy(
            to = to ?: _state.value.to,
            cc = cc ?: _state.value.cc,
            subject = subject ?: _state.value.subject,
            text = text ?: _state.value.text
        )
    }

    fun selectAccount(accountId: String) {
        _state.value = _state.value.copy(selectedAccountId = accountId)
    }

    fun addAttachment(context: Context, uri: Uri) {
        val current = _state.value.attachments
        if (current.size >= 10) {
            _state.value = _state.value.copy(error = "单封邮件最多添加 10 个附件。")
            return
        }
        try {
            val info = context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                val index = cursor.getColumnIndex("_display_name")
                val nameIndex = if (index >= 0) index else 0
                cursor.moveToFirst()
                val filename = cursor.getString(nameIndex)?.takeIf { it.isNotBlank() } ?: uri.lastPathSegment ?: "attachment"
                filename
            } ?: (uri.lastPathSegment ?: "attachment")
            val size = context.contentResolver.openAssetFileDescriptor(uri, "r")?.use { it.length } ?: 0L
            if (size > 15 * 1024 * 1024) {
                _state.value = _state.value.copy(error = "单个附件不能超过 15 MB。")
                return
            }
            if (current.sumOf { it.size } + size > 18 * 1024 * 1024) {
                _state.value = _state.value.copy(error = "附件总大小不能超过 18 MB。")
                return
            }
            val contentType = context.contentResolver.getType(uri) ?: "application/octet-stream"
            val safeName = info.replace(Regex("[\\\\/:*?\"<>|\\x00-\\x1f]"), "_").take(180).ifBlank { "attachment" }
            _state.value = _state.value.copy(attachments = current + PickedAttachment(uri, safeName, contentType, size), error = null)
        } catch (error: Exception) {
            _state.value = _state.value.copy(error = "无法读取所选文件：${error.localizedMessage ?: "未知错误"}")
        }
    }

    fun removeAttachment(index: Int) {
        val current = _state.value.attachments.toMutableList()
        if (index in current.indices) {
            current.removeAt(index)
            _state.value = _state.value.copy(attachments = current)
        }
    }

    fun clearError() {
        _state.value = _state.value.copy(error = null)
    }

    /** 发送；成功后返回 true（由界面负责返回）。 */
    suspend fun sendFrom(context: Context): Boolean {
        val current = _state.value
        val accountId = current.selectedAccountId ?: run {
            _state.value = current.copy(error = "请选择发件邮箱。")
            return false
        }
        if (current.to.isBlank()) {
            _state.value = current.copy(error = "请填写收件人。")
            return false
        }
        if (current.subject.isBlank() && current.text.isBlank()) {
            _state.value = current.copy(error = "邮件主题和正文不能同时为空。")
            return false
        }
        _state.value = current.copy(sending = true, error = null)
        try {
            val attachments = withContext(Dispatchers.IO) {
                current.attachments.map { item ->
                    val bytes = context.contentResolver.openInputStream(item.uri)?.use { it.readBytes() }
                        ?: throw java.io.IOException("附件读取失败")
                    SendAttachmentReq(
                        filename = item.filename,
                        contentType = item.contentType,
                        content = Base64.encodeToString(bytes, Base64.NO_WRAP)
                    )
                }
            }
            val result = repository.send(
                SendReq(
                    accountId = accountId,
                    to = current.to.trim(),
                    cc = current.cc.trim(),
                    subject = current.subject.trim(),
                    text = current.text,
                    inReplyTo = current.reply?.inReplyTo,
                    references = current.reply?.references,
                    attachments = attachments
                )
            )
            _state.value = _state.value.copy(sending = false)
            return true
        } catch (error: Exception) {
            _state.value = _state.value.copy(sending = false, error = error.toUserMessage())
            return false
        }
    }

    class Factory(private val repository: MailRepository) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = ComposeViewModel(repository) as T
    }
}
