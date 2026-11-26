package com.youhui.mail.data.repository

import com.youhui.mail.data.remote.YouhuiApi
import com.youhui.mail.data.remote.dto.ActionReq
import com.youhui.mail.data.remote.dto.AccountsDto
import com.youhui.mail.data.remote.dto.FoldersDto
import com.youhui.mail.data.remote.dto.FolderReadAllDto
import com.youhui.mail.data.remote.dto.FolderReadAllReq
import com.youhui.mail.data.remote.dto.MailListDto
import com.youhui.mail.data.remote.dto.MessageDto
import com.youhui.mail.data.remote.dto.OkDto
import com.youhui.mail.data.remote.dto.SendReq
import okhttp3.ResponseBody
import retrofit2.Response
import java.io.File
import java.io.IOException

/** 邮件列表 / 详情 / 操作 / 附件下载（设计文档 A2 + B3）。 */
class MailRepository(private val api: YouhuiApi) {

    suspend fun mail(folder: String, accountId: String, page: Int, limit: Int, query: String?): MailListDto =
        api.mail(folder = folder, accountId = accountId, page = page, limit = limit, q = query?.takeIf { it.isNotBlank() })

    suspend fun message(accountId: String, uid: Long, folder: String): MessageDto =
        api.message(accountId, uid, folder, attachments = "meta")

    suspend fun messageAction(accountId: String, uid: Long, folder: String, action: String): OkDto =
        api.action(accountId, uid, ActionReq(folder, action))

    suspend fun markAllRead(folder: String, accountId: String): FolderReadAllDto =
        api.markAllRead(FolderReadAllReq(folder = folder, accountId = accountId))

    suspend fun accounts(): AccountsDto = api.accounts()

    suspend fun folders(accountId: String? = null): FoldersDto = api.folders(accountId)

    suspend fun send(body: SendReq): OkDto = api.send(body)

    /**
     * 流式下载附件到目标文件（@Streaming + 边写边落盘，避免整块进内存）。
     * 目标文件建议放 cacheDir 或经 MediaStore 打开的输出流。
     */
    suspend fun downloadAttachment(accountId: String, uid: Long, folder: String, index: Int, target: File) {
        val body: ResponseBody = api.attachment(accountId, uid, index, folder)
        val temp = File(target.parentFile, target.name + ".part")
        try {
            body.byteStream().use { input ->
                temp.outputStream().use { output ->
                    input.copyTo(output, bufferSize = 64 * 1024)
                }
            }
            if (!temp.renameTo(target)) {
                temp.copyTo(target, overwrite = true)
                temp.delete()
            }
        } finally {
            temp.delete()
        }
    }

    /**
     * 下载附件并返回文件；存到应用 cache 目录的 downloads/ 子目录。
     * 分享/保存到公共目录（MediaStore）由 UI 层按需调用 FileProvider 完成。
     */
    suspend fun fetchAttachmentToCache(accountId: String, uid: Long, folder: String, index: Int, cacheDir: File, filename: String): File {
        val dir = File(cacheDir, "downloads").apply { mkdirs() }
        val safeName = filename.replace(Regex("[\\\\/:*?\"<>|\\x00-\\x1f]"), "_").take(150).ifBlank { "attachment" }
        val target = File(dir, safeName)
        downloadAttachment(accountId, uid, folder, index, target)
        return target
    }

    /**
     * 内嵌图取回（正文 cid 回填用）：请求 disposition=inline 的附件流。
     * 服务端仅对安全图片类型放行 inline，其余类型会按 attachment 返回。
     */
    suspend fun inlineImage(accountId: String, uid: Long, folder: String, index: Int): Pair<ByteArray, String>? = try {
        val body = api.attachment(accountId, uid, index, folder, disposition = "inline")
        val mime = body.contentType()?.toString()
            ?.substringBefore(';')?.trim()
            ?.takeIf { it.isNotBlank() } ?: "application/octet-stream"
        val bytes = body.byteStream().use { it.readBytes() }
        bytes to mime
    } catch (ignored: Exception) {
        null
    }
}
