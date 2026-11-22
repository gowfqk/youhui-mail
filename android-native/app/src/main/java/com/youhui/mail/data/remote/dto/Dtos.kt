package com.youhui.mail.data.remote.dto

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// 服务端 date 字段可能为 ISO 字符串（mailparser Date）或毫秒时间戳（IMAP internalDate），
// 因此用 JsonPrimitive 兼容两种类型，展示层用 Formatters.dateText 统一格式化。

@Serializable
data class StatusDto(
    val setupRequired: Boolean = false,
    val authenticated: Boolean = false,
    val oauthProviders: Map<String, Boolean> = emptyMap(),
    val identityProviders: Map<String, Boolean> = emptyMap()
)

@Serializable
data class MobileLoginReq(
    val password: String,
    val deviceId: String,
    val deviceLabel: String
)

@Serializable
data class SessionInfo(
    val deviceId: String,
    val deviceLabel: String? = null,
    val kind: String = "mobile"
)

@Serializable
data class TokenDto(
    val token: String,
    val expiresAt: Long,
    val session: SessionInfo? = null
)

@Serializable
data class OkDto(
    val ok: Boolean = true,
    val message: String? = null,
    val warning: String? = null
)

@Serializable
data class DeviceSessionDto(
    val deviceId: String,
    val deviceLabel: String? = null,
    val createdAt: Long = 0,
    val lastSeenAt: Long = 0,
    val expiresAt: Long = 0
)

@Serializable
data class SessionsDto(val sessions: List<DeviceSessionDto> = emptyList())

@Serializable
data class AddressDto(
    val name: String? = null,
    val address: String? = null
)

@Serializable
data class MailItemDto(
    val accountId: String,
    val accountEmail: String? = null,
    val accountLabel: String? = null,
    val uid: Long,
    val folder: String? = null,
    val subject: String? = null,
    val from: List<AddressDto> = emptyList(),
    val to: List<AddressDto> = emptyList(),
    val date: JsonPrimitive? = null,
    val unread: Boolean = false,
    val flagged: Boolean = false,
    val size: Long = 0
)

@Serializable
data class MailListDto(
    val messages: List<MailItemDto> = emptyList(),
    val total: Int = 0,
    val page: Int = 1,
    val limit: Int = 30,
    val folder: String? = null,
    val errors: List<Map<String, String>> = emptyList()
)

@Serializable
data class AttachmentMetaDto(
    val index: Int = 0,
    val filename: String = "attachment",
    val contentType: String = "application/octet-stream",
    val size: Long = 0,
    val contentId: String? = null,
    val inline: Boolean = false,
    // 网页版兼容字段：attachments=meta 时服务端不返回
    val content: String? = null
)

@Serializable
data class MessageDto(
    val accountId: String? = null,
    val email: String? = null,
    val uid: Long = 0,
    val folder: String? = null,
    val subject: String? = null,
    val from: List<AddressDto> = emptyList(),
    val to: List<AddressDto> = emptyList(),
    val cc: List<AddressDto> = emptyList(),
    val date: JsonPrimitive? = null,
    val text: String? = null,
    val html: String? = null,
    val messageId: String? = null,
    val inReplyTo: String? = null,
    val references: String? = null,
    val attachments: List<AttachmentMetaDto> = emptyList()
)

@Serializable
data class ActionReq(
    val folder: String,
    val action: String
)

@Serializable
data class AccountDto(
    val id: String,
    val label: String? = null,
    val email: String? = null,
    val provider: String? = null
)

@Serializable
data class AccountsDto(
    val accounts: List<AccountDto> = emptyList(),
    val defaultAccountId: String? = null
)

// 对齐服务端 /api/folders 返回：[{accountId, accountEmail, path, name, specialUse}]
@Serializable
data class FolderDto(
    val accountId: String? = null,
    val accountEmail: String? = null,
    val path: String,
    val name: String? = null,
    val specialUse: String? = null
)

@Serializable
data class FoldersDto(val folders: List<FolderDto> = emptyList())

@Serializable
data class EventBrief(
    val label: String? = null,
    val name: String? = null,
    val email: String? = null
)

// 对齐服务端 notification_events 解密后 payload：
// { id, accountId, account: {label,email}, sender: {name,email}, subject, verificationCode, ... }
@Serializable
data class NotificationEventDto(
    val id: Long = 0,
    val eventId: Long = 0,
    val accountId: String? = null,
    val account: EventBrief? = null,
    val sender: EventBrief? = null,
    val subject: String? = null,
    val verificationCode: String? = null,
    val folder: String? = null
)

@Serializable
data class EventsDto(
    val events: List<NotificationEventDto> = emptyList(),
    val cursor: Long = 0,
    val defaultAccountId: String? = null
)

@Serializable
data class PushDeviceReq(
    val deviceId: String,
    val token: String
)

@Serializable
data class PushDeviceDto(
    val ok: Boolean = true,
    val cursor: Long = 0
)

@Serializable
data class OauthStartDto(val url: String)

@Serializable
data class ExchangeReq(
    val code: String,
    val codeVerifier: String,
    val deviceId: String,
    val deviceLabel: String
)

@Serializable
data class SendReq(
    val accountId: String,
    val to: String,
    val cc: String = "",
    val bcc: String = "",
    val subject: String,
    val text: String,
    val inReplyTo: String? = null,
    val references: String? = null,
    val attachments: List<SendAttachmentReq> = emptyList()
)

@Serializable
data class SendAttachmentReq(
    val filename: String,
    val contentType: String,
    val content: String // base64，≤10 个、合计 ≤18MB（服务端约束）
)

/** 统一错误响应（对齐服务端 safeError 的 { error } 结构）。 */
@Serializable
data class ApiErrorDto(val error: String? = null)

// ---------- 设置（对齐网页版设置功能，App 端复用同一套 API）：账户/通知/备份 ----------

/** GET /api/presets：常见邮箱服务商 IMAP/SMTP 预设。 */
@Serializable
data class PresetDto(
    val imapHost: String = "",
    val imapPort: Int = 993,
    val imapSecure: Boolean = true,
    val smtpHost: String = "",
    val smtpPort: Int = 465,
    val smtpSecure: Boolean = true
)

@Serializable
data class PresetsDto(val presets: Map<String, PresetDto> = emptyMap())

/** /api/accounts 列表项（含网页端返回的 mailStatus，忽略未知字段）。 */
@Serializable
data class AccountSummaryDto(
    val id: String,
    val label: String? = null,
    val email: String? = null,
    val provider: String? = null,
    val authType: String? = null,
    val createdAt: Long = 0
)

/** POST /api/accounts 与 /api/accounts/test 的请求体（对齐 normalizeManual）。 */
@Serializable
data class AccountFormReq(
    val email: String,
    val username: String? = null,
    val password: String,
    val label: String? = null,
    val provider: String = "custom",
    val imapHost: String,
    val imapPort: Int = 993,
    val imapSecure: Boolean = true,
    val smtpHost: String,
    val smtpPort: Int = 465,
    val smtpSecure: Boolean = false
)

@Serializable
data class OkMessageDto(val ok: Boolean = true, val message: String? = null)

@Serializable
data class DefaultAccountReq(val accountId: String)

/** GET/PUT /api/notifications/config（公开视图，敏感字段只返回配置状态）。 */
@Serializable
data class NotificationConfigDto(
    val enabled: Boolean = false,
    val intervalSeconds: Int = 300,
    val webhookEnabled: Boolean = false,
    val webhookConfigured: Boolean = false,
    val webhookSecretConfigured: Boolean = false,
    val pushProvider: String = "webhook",
    val wxpusherEnabled: Boolean = false,
    val wxpusherAppTokenConfigured: Boolean = false,
    val wxpusherUids: String = "",
    val wxpusherTopicIds: String = ""
)

/** PUT 时只提交要改的字段（服务端对缺失字段保留原值）。 */
@Serializable
data class NotificationConfigReq(
    val enabled: Boolean? = null,
    val intervalSeconds: Int? = null
)

// ---------- AI 助手（对齐 /api/ai/*，与网页工作台共用同一套配置）----------

/** GET/PUT /api/ai/config 的公开视图：API Key 只返回是否已保存。 */
@Serializable
data class AiConfigDto(
    val configured: Boolean = false,
    val hasApiKey: Boolean = false,
    val baseUrl: String = "https://api.openai.com/v1",
    val providerName: String = "",
    val model: String = "",
    val dailySummaryEnabled: Boolean = false,
    val dailySummaryTime: String = "08:00",
    val dailySummaryAccountId: String = "all",
    val timeZone: String = "Asia/Hong_Kong"
)

/** PUT /api/ai/config：apiKey 留空表示保留已保存的 Key。 */
@Serializable
data class AiConfigReq(
    val providerName: String,
    val baseUrl: String,
    val model: String,
    val apiKey: String = "",
    val dailySummaryEnabled: Boolean = false,
    val dailySummaryTime: String = "08:00",
    val dailySummaryAccountId: String = "all"
)

@Serializable
data class AiTestDto(
    val ok: Boolean = true,
    val message: String? = null,
    val sample: String? = null
)

@Serializable
data class AiMessageDto(val role: String, val content: String)

/** 用户主动选择的邮件上下文（服务端会截断并作为引用数据处理）。 */
@Serializable
data class AiEmailContextDto(
    val accountEmail: String = "",
    val subject: String = "",
    val from: String = "",
    val date: String = "",
    val text: String = ""
)

@Serializable
data class AiChatReq(
    val message: String,
    val history: List<AiMessageDto> = emptyList(),
    val intent: String = "chat",
    val emailContext: AiEmailContextDto? = null
)

@Serializable
data class AiChatReplyDto(val reply: String = "")

@Serializable
data class AiDigestDto(
    val day: String = "",
    val generatedAt: Long = 0,
    val messageCount: Int = 0,
    val summary: String = ""
)

@Serializable
data class AiDigestEnvelopeDto(val digest: AiDigestDto? = null)

@Serializable
data class AiDigestReq(val accountId: String = "all")

// ---------- Agent / MCP（对齐 /api/mcp/*）----------

@Serializable
data class McpAccountDto(
    val id: String,
    val label: String? = null,
    val email: String? = null
)

@Serializable
data class McpPermissionDto(
    val configured: Boolean = false,
    val legacy: Boolean = false,
    val accountScope: String = "all",
    val accountIds: List<String> = emptyList()
)

@Serializable
data class McpConfigDto(
    val endpoint: String = "",
    val permissions: Map<String, McpPermissionDto> = emptyMap(),
    val accounts: List<McpAccountDto> = emptyList()
)

/** accountIds 为 "all"（JsonPrimitive）或账户 ID 数组（JsonArray）。 */
@Serializable
data class McpTokenReq(
    val permission: String,
    val accountIds: JsonElement? = null
)

@Serializable
data class McpTokenDto(
    val token: String = "",
    val permission: String? = null,
    val configured: Boolean = true
)

@Serializable
data class McpScopeReq(val accountIds: JsonElement)

@Serializable
data class McpScopeDto(
    val permission: String? = null,
    val accountScope: String = "all",
    val accountIds: List<String> = emptyList()
)

@Serializable
data class McpApprovalDto(
    val id: String,
    val kind: String = "",
    val accountId: String? = null,
    val accountEmail: String? = null,
    val accountLabel: String? = null,
    val createdAt: Long = 0,
    val to: String? = null,
    val cc: String? = null,
    val bcc: String? = null,
    val subject: String? = null,
    val text: String? = null,
    val uid: Long? = null,
    val folder: String? = null
)

@Serializable
data class McpApprovalsDto(val approvals: List<McpApprovalDto> = emptyList())

@Serializable
data class McpApproveDto(
    val ok: Boolean = true,
    val result: JsonObject? = null
)

// ---------- 邮件翻译（对齐 /api/translation/*，目标语言固定为简体中文）----------

@Serializable
data class TranslationConfigDto(
    val provider: String = "niutrans",
    val configured: Boolean = false,
    val hasNiuTransAppId: Boolean = false,
    val hasNiuTransApiKey: Boolean = false,
    val hasGoogleApiKey: Boolean = false,
    val hasAzureApiKey: Boolean = false,
    val hasAzureRegion: Boolean = false
)

/** 凭据留空表示保留已保存值。 */
@Serializable
data class TranslationConfigReq(
    val provider: String,
    val niutransAppId: String = "",
    val niutransApiKey: String = "",
    val googleApiKey: String = "",
    val azureApiKey: String = "",
    val azureRegion: String = ""
)

@Serializable
data class TranslationReq(val text: String)

@Serializable
data class TranslationResultDto(
    val translation: String = "",
    val provider: String = ""
)
