package com.youhui.mail.ui.inbox

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.youhui.mail.data.local.cache.MailCacheRepository
import com.youhui.mail.data.repository.MailRepository
import com.youhui.mail.data.repository.toUserMessage
import com.youhui.mail.data.remote.dto.MailItemDto
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/** 文件夹本地化显示名（特殊用途优先，其次 name/path 原文）。 */
fun folderDisplayName(path: String, name: String? = null, specialUse: String? = null): String {
    val su = specialUse.orEmpty().lowercase()
    val raw = (name?.takeIf { it.isNotBlank() } ?: path).trim()
    return when {
        su.contains("inbox") || path.equals("inbox", true) -> "收件箱"
        su.contains("sent") || path.contains("sent", true) -> "已发送"
        su.contains("draft") || path.contains("draft", true) -> "草稿箱"
        su.contains("trash") || su.contains("deleted") || path.contains("trash", true) || path.contains("deleted", true) -> "已删除"
        su.contains("junk") || su.contains("spam") || path.contains("junk", true) || path.contains("spam", true) -> "垃圾邮件"
        su.contains("archive") || path.contains("archive", true) -> "归档"
        su.contains("flagged") || path.contains("flagged", true) -> "加星邮件"
        else -> raw.ifBlank { path }
    }
}

data class InboxUiState(
    val loading: Boolean = false,
    val loadingMore: Boolean = false,
    val messages: List<MailItemDto> = emptyList(),
    val total: Int = 0,
    val page: Int = 1,
    val folder: String = "INBOX",
    val accountId: String = "all",
    val query: String = "",
    val listFilter: String = "all", // all / unread / verification / attachments（仅筛选当前已加载列表）
    val accounts: List<Pair<String, String>> = emptyList(), // id → 展示名
    val folders: List<Pair<String, String>> = listOf("INBOX" to "收件箱"), // path → 显示名
    val error: String? = null,
    val notice: String? = null,
    val endReached: Boolean = false,
    val fromCache: Boolean = false                    // 当前列表来自离线缓存（无网络/失败时）
)

class InboxViewModel(
    private val repository: MailRepository,
    private val cache: MailCacheRepository? = null
) : ViewModel() {

    private val _state = MutableStateFlow(InboxUiState())
    val state: StateFlow<InboxUiState> = _state

    private val pageSize = 30

    init {
        refresh()
        loadFacets()
    }

    private fun loadFacets() {
        viewModelScope.launch {
            try {
                val accounts = repository.accounts().accounts.map { it.id to (it.label ?: it.email ?: it.id) }
                // folders 接口返回对象数组（path/name/specialUse）；按 path 去重后本地化展示。
                // 多账户“全部邮箱”时取全部账户文件夹的并集；指定账户时仅取该账户的。
                val folderRows = runCatching {
                    repository.folders(if (_state.value.accountId == "all") null else _state.value.accountId).folders
                }.getOrNull().orEmpty()
                val folders = folderRows
                    .filter { it.path.isNotBlank() }
                    .distinctBy { it.path }
                    .map { it.path to folderDisplayName(it.path, it.name, it.specialUse) }
                    .ifEmpty { listOf("INBOX" to "收件箱") }
                _state.value = _state.value.copy(accounts = accounts, folders = folders)
            } catch (ignored: Exception) {
                // 侧栏信息加载失败不阻塞主流程（保留现有文件夹列表）
            }
        }
    }

    fun refresh() {
        _state.value = _state.value.copy(loading = true, page = 1, endReached = false, error = null)
        viewModelScope.launch {
            try {
                val result = repository.mail(_state.value.folder, _state.value.accountId, 1, pageSize, _state.value.query)
                _state.value = _state.value.copy(
                    loading = false,
                    messages = result.messages,
                    total = result.total,
                    endReached = result.messages.size >= result.total || result.messages.isEmpty(),
                    fromCache = false
                )
                cache?.saveFolder(_state.value.folder, result.messages)
            } catch (e: Exception) {
                // 网络失败：先试离线缓存（列表离线可读）
                val cached = cache?.cachedFolder(_state.value.folder).orEmpty()
                _state.value = if (cached.isNotEmpty()) {
                    _state.value.copy(loading = false, messages = cached, total = cached.size, fromCache = true, endReached = true)
                } else {
                    _state.value.copy(loading = false, error = e.toUserMessage())
                }
            }
        }
    }

    fun loadMore() {
        val current = _state.value
        if (current.loading || current.loadingMore || current.endReached) return
        _state.value = current.copy(loadingMore = true)
        viewModelScope.launch {
            try {
                val nextPage = current.page + 1
                val result = repository.mail(current.folder, current.accountId, nextPage, pageSize, current.query)
                val merged = (current.messages + result.messages).distinctBy { Triple(it.accountId, it.folder, it.uid) }
                _state.value = _state.value.copy(
                    loadingMore = false,
                    messages = merged,
                    page = nextPage,
                    endReached = result.messages.isEmpty() || merged.size >= result.total
                )
            } catch (e: Exception) {
                _state.value = _state.value.copy(loadingMore = false, error = e.toUserMessage())
            }
        }
    }

    fun setFolder(folder: String) {
        _state.value = _state.value.copy(folder = folder)
        refresh()
    }

    fun setAccount(accountId: String) {
        _state.value = _state.value.copy(accountId = accountId)
        loadFacets()
        refresh()
    }

    fun setQuery(query: String) {
        _state.value = _state.value.copy(query = query)
        refresh()
    }

    fun setListFilter(filter: String) {
        _state.value = _state.value.copy(listFilter = filter)
    }

    /** 当前文件夹整体标为已读；星标聚合视图没有单一 IMAP 文件夹，需在具体文件夹操作。 */
    fun markAllRead() {
        val current = _state.value
        if (current.folder == "Starred") {
            _state.value = current.copy(error = "星标视图不支持批量已读")
            return
        }
        viewModelScope.launch {
            try {
                val result = repository.markAllRead(current.folder, current.accountId)
                if (result.errors.isNotEmpty()) {
                    _state.value = _state.value.copy(error = result.errors.joinToString(" · ") { it["error"].orEmpty() })
                    return@launch
                }
                val updated = _state.value.messages.map { if (it.unread) it.copy(unread = false) else it }
                _state.value = _state.value.copy(
                    messages = updated,
                    notice = if (result.updated > 0) "已将邮件全部标为已读" else "当前没有未读邮件"
                )
                cache?.markFolderRead(current.folder, current.accountId)
            } catch (e: Exception) {
                _state.value = _state.value.copy(error = e.toUserMessage())
            }
        }
    }

    fun performAction(item: MailItemDto, action: String) {
        viewModelScope.launch {
            try {
                repository.messageAction(item.accountId, item.uid, item.folder ?: "INBOX", action)
                val updated = _state.value.messages.map {
                    when {
                        it.accountId == item.accountId && it.uid == item.uid && action == "star" -> it.copy(flagged = true)
                        it.accountId == item.accountId && it.uid == item.uid && action == "unstar" -> it.copy(flagged = false)
                        it.accountId == item.accountId && it.uid == item.uid && action == "read" -> it.copy(unread = false)
                        it.accountId == item.accountId && it.uid == item.uid && action == "unread" -> it.copy(unread = true)
                        else -> it
                    }
                }
                _state.value = _state.value.copy(messages = if (action == "archive" || action == "delete") {
                    updated.filterNot { it.accountId == item.accountId && it.uid == item.uid }
                } else updated)
                // 同步本地缓存状态（离线列表读到一致标记）
                val folder = item.folder ?: "INBOX"
                when (action) {
                    "read" -> cache?.markRead(item.accountId, item.uid, folder, false)
                    "unread" -> cache?.markRead(item.accountId, item.uid, folder, true)
                    "star" -> cache?.markFlagged(item.accountId, item.uid, folder, true)
                    "unstar" -> cache?.markFlagged(item.accountId, item.uid, folder, false)
                    "archive", "delete" -> cache?.removeItem(item.accountId, item.uid, folder)
                }
            } catch (e: Exception) {
                _state.value = _state.value.copy(error = e.toUserMessage())
            }
        }
    }

    fun clearError() {
        _state.value = _state.value.copy(error = null)
    }

    fun clearNotice() {
        _state.value = _state.value.copy(notice = null)
    }

    class Factory(
        private val repository: MailRepository,
        private val cache: MailCacheRepository? = null
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = InboxViewModel(repository, cache) as T
    }
}
