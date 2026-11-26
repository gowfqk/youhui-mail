package com.youhui.mail.data.local.cache

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import kotlinx.coroutines.flow.Flow

@Dao
interface MailCacheDao {

    // ---------- 列表缓存 ----------

    @Query("SELECT * FROM cached_mail_items WHERE folder = :folder ORDER BY sortKey DESC")
    fun observeFolder(folder: String): Flow<List<CachedMailItem>>

    @Query("SELECT COUNT(*) FROM cached_mail_items WHERE folder = :folder")
    suspend fun countFolder(folder: String): Int

    /** 替换某文件夹的缓存页（先清后插，事务内完成）。 */
    @Transaction
    suspend fun replaceFolder(folder: String, sortKeyBase: Long, items: List<CachedMailItem>) {
        clearFolder(folder)
        if (items.isNotEmpty()) insertItems(items.map { it.copy(folder = folder, sortKey = sortKeyBase - it.uid) })
    }

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertItems(items: List<CachedMailItem>)

    @Query("DELETE FROM cached_mail_items WHERE folder = :folder")
    suspend fun clearFolder(folder: String)

    @Query("DELETE FROM cached_mail_items")
    suspend fun clearAllItems()

    // ---------- 状态同步（离线可读的读/星标记） ----------

    @Query("UPDATE cached_mail_items SET unread = :unread WHERE accountId = :accountId AND uid = :uid AND folder = :folder")
    suspend fun updateRead(accountId: String, uid: Long, folder: String, unread: Boolean)

    /** 整个文件夹标为已读（accountId 为 all 时覆盖该文件夹内所有账户）。 */
    @Query("UPDATE cached_mail_items SET unread = 0 WHERE folder = :folder AND (:accountId = 'all' OR accountId = :accountId)")
    suspend fun markFolderRead(folder: String, accountId: String)

    @Query("UPDATE cached_mail_items SET flagged = :flagged WHERE accountId = :accountId AND uid = :uid AND folder = :folder")
    suspend fun updateFlagged(accountId: String, uid: Long, folder: String, flagged: Boolean)

    @Query("DELETE FROM cached_mail_items WHERE accountId = :accountId AND uid = :uid AND folder = :folder")
    suspend fun removeItem(accountId: String, uid: Long, folder: String)

    // ---------- 详情缓存 ----------

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertDetail(detail: CachedMessageDetail)

    @Query("SELECT payload FROM cached_message_details WHERE accountId = :accountId AND uid = :uid AND folder = :folder")
    suspend fun detailPayload(accountId: String, uid: Long, folder: String): String?

    @Query("DELETE FROM cached_message_details WHERE cachedAt < :threshold")
    suspend fun trimOldDetails(threshold: Long)

    // ---------- 全库 ----------

    @Query("DELETE FROM cached_mail_items")
    suspend fun wipeItems()

    @Query("DELETE FROM cached_message_details")
    suspend fun wipeDetails()
}

/** 换个服务器地址/登出时的整库清理入口。 */
suspend fun MailCacheDao.wipeAll() {
    wipeItems()
    wipeDetails()
}
