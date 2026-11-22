package com.youhui.mail.data.local.cache

import android.content.Context
import androidx.room.Database
import androidx.room.Entity
import androidx.room.PrimaryKey
import androidx.room.Room
import androidx.room.RoomDatabase

/**
 * 离线缓存实体：
 * - CachedMailItem：列表行（收件箱离线可读）；sortKey 用于本地排序（时间戳降序）
 * - CachedMessageDetail：详情 JSON 原文（kotlinx 序列化），带缓存时间做淘汰
 * 字段直接平铺（不做 JSON 列）以便 SQL 过滤/更新读星标记。
 */
@Entity(tableName = "cached_mail_items")
data class CachedMailItem(
    @PrimaryKey val rowKey: String,          // accountId|folder|uid
    val accountId: String,
    val uid: Long,
    val folder: String,
    val sortKey: Long,                        // 排序键：dateEpoch 优先，回退 uid
    val dateEpoch: Long,
    val subject: String,
    val fromNames: String,                    // 展示用：首地址 name/email
    val unread: Boolean,
    val flagged: Boolean,
    val cachedAt: Long
)

@Entity(tableName = "cached_message_details")
data class CachedMessageDetail(
    @PrimaryKey val rowKey: String,            // accountId|folder|uid
    val accountId: String,
    val uid: Long,
    val folder: String,
    val payload: String,                       // MessageDto JSON（attachments=meta 形态）
    val cachedAt: Long
)

@Database(
    entities = [CachedMailItem::class, CachedMessageDetail::class],
    version = 1,
    exportSchema = false
)
abstract class MailCacheDatabase : RoomDatabase() {
    abstract fun dao(): MailCacheDao

    companion object {
        @Volatile
        private var instance: MailCacheDatabase? = null

        fun get(context: Context): MailCacheDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(context.applicationContext, MailCacheDatabase::class.java, "youhui_mail_cache.db")
                .fallbackToDestructiveMigration()
                .build()
                .also { instance = it }
        }
    }
}
