package com.youhui.mail.data.local.cache

import com.youhui.mail.data.remote.dto.MailItemDto
import com.youhui.mail.data.remote.dto.MessageDto
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.serialization.json.Json

/**
 * 缓存仓库：网络优先、失败回落缓存（列表），详情网络优先、失败回落缓存。
 * 服务器地址变更/登出时全库清理（wipeAll）。
 */
class MailCacheRepository(private val dao: MailCacheDao) {

    private val json = Json { ignoreUnknownKeys = true; coerceInputValues = true }

    // ---------- 列表 ----------

    fun observeFolder(folder: String) = dao.observeFolder(folder)

    suspend fun saveFolder(folder: String, items: List<MailItemDto>) {
        if (items.isEmpty()) {
            dao.clearFolder(folder)
            return
        }
        val now = System.currentTimeMillis()
        val entities = items.map { it.toEntity(now) }
        dao.replaceFolder(folder, entities.maxOf { it.sortKey } + 1, entities)
    }

    suspend fun cachedFolder(folder: String): List<MailItemDto> =
        dao.observeFolder(folder).firstOrNull()?.map { it.toDto() } ?: emptyList()

    suspend fun markRead(accountId: String, uid: Long, folder: String, unread: Boolean) =
        dao.updateRead(accountId, uid, folder, unread)

    suspend fun markFolderRead(folder: String, accountId: String) =
        dao.markFolderRead(folder, accountId)

    suspend fun markFlagged(accountId: String, uid: Long, folder: String, flagged: Boolean) =
        dao.updateFlagged(accountId, uid, folder, flagged)

    suspend fun removeItem(accountId: String, uid: Long, folder: String) =
        dao.removeItem(accountId, uid, folder)

    // ---------- 详情 ----------

    suspend fun saveDetail(dto: MessageDto, accountId: String, uid: Long, folder: String) {
        dao.upsertDetail(
            CachedMessageDetail(
                rowKey = rowKey(accountId, folder, uid),
                accountId = accountId,
                uid = uid,
                folder = folder,
                payload = json.encodeToString(MessageDto.serializer(), dto),
                cachedAt = System.currentTimeMillis()
            )
        )
        // 顺手淘汰 7 天前的详情缓存
        dao.trimOldDetails(System.currentTimeMillis() - 7 * 24 * 60 * 60_000L)
    }

    suspend fun cachedDetail(accountId: String, uid: Long, folder: String): MessageDto? {
        val payload = dao.detailPayload(accountId, uid, folder) ?: return null
        return runCatching { json.decodeFromString(MessageDto.serializer(), payload) }.getOrNull()
    }

    fun wipeAll() = kotlinx.coroutines.runBlocking { dao.wipeAll() }

    companion object {
        fun rowKey(accountId: String, folder: String, uid: Long) = "$accountId|$folder|$uid"

        private fun MailItemDto.toEntity(now: Long): CachedMailItem {
            val dateEpoch = date?.content?.let { raw ->
                raw.toLongOrNull() ?: runCatching {
                    java.time.OffsetDateTime.parse(raw).toInstant().toEpochMilli()
                }.getOrNull()
            } ?: 0L
            val fromLine = from.firstOrNull()?.let { address ->
                address.name?.takeIf { it.isNotBlank() } ?: address.address
            }.orEmpty()
            return CachedMailItem(
                rowKey = rowKey(accountId, folder ?: "INBOX", uid),
                accountId = accountId,
                uid = uid,
                folder = folder ?: "INBOX",
                sortKey = dateEpoch,
                dateEpoch = dateEpoch,
                subject = subject.orEmpty().ifBlank { "(无主题)" },
                fromNames = fromLine,
                unread = unread,
                flagged = flagged,
                cachedAt = now
            )
        }

        private fun CachedMailItem.toDto() = MailItemDto(
            accountId = accountId,
            uid = uid,
            folder = folder,
            subject = subject,
            from = listOf(
                com.youhui.mail.data.remote.dto.AddressDto(name = fromNames.takeIf { it.isNotBlank() }, address = fromNames)
            ),
            date = kotlinx.serialization.json.JsonPrimitive(if (dateEpoch > 0) dateEpoch.toString() else null),
            unread = unread,
            flagged = flagged
        )
    }
}


