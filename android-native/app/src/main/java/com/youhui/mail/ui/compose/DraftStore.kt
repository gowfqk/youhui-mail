package com.youhui.mail.ui.compose

import android.net.Uri
import com.youhui.mail.data.remote.dto.MessageDto

/**
 * 回复/新邮件草稿的极短生命周期传递（从详情/收件箱跳到写信页时一次性消费）。
 * 进程重建丢失属可接受范围（骨架阶段），避免超长参数走导航路由。
 */
object DraftStore {
    @Volatile
    private var pending: ReplyDraft? = null

    fun set(draft: ReplyDraft) { pending = draft }

    fun consume(): ReplyDraft? {
        val value = pending
        pending = null
        return value
    }
}

data class ReplyDraft(
    val mode: Mode = Mode.NEW,
    val accountId: String? = null,     // 回复时与来信使用同一发件账户
    val to: String = "",
    val subject: String = "",
    val inReplyTo: String? = null,
    val references: String? = null
) {
    enum class Mode { NEW, REPLY }

    companion object {
        fun fromMessage(message: MessageDto, defaultAccount: String?): ReplyDraft {
            val address = { item: com.youhui.mail.data.remote.dto.AddressDto ->
                val name = item.name?.trim().orEmpty()
                if (name.isBlank() || name == item.address) (item.address ?: "") else "$name <${item.address}>"
            }
            val to = message.from.joinToString(", ") { address(it) }.trim()
            val original = message.subject.orEmpty()
            val subject = if (original.startsWith("Re:", true) || original.startsWith("回复：")) original else "Re: $original"
            return ReplyDraft(
                mode = Mode.REPLY,
                accountId = message.accountId ?: defaultAccount,
                to = to,
                subject = subject,
                inReplyTo = message.messageId,
                references = message.references
            )
        }
    }
}

/** 已选待上传附件（发送时才读取内容做 base64）。 */
data class PickedAttachment(
    val uri: Uri,
    val filename: String,
    val contentType: String,
    val size: Long
)
