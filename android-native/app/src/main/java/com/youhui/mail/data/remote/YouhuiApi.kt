package com.youhui.mail.data.remote

import com.youhui.mail.data.remote.dto.AccountFormReq
import com.youhui.mail.data.remote.dto.AccountsDto
import com.youhui.mail.data.remote.dto.ActionReq
import com.youhui.mail.data.remote.dto.AiChatReplyDto
import com.youhui.mail.data.remote.dto.AiChatReq
import com.youhui.mail.data.remote.dto.AiConfigDto
import com.youhui.mail.data.remote.dto.AiConfigReq
import com.youhui.mail.data.remote.dto.AiDigestEnvelopeDto
import com.youhui.mail.data.remote.dto.AiDigestReq
import com.youhui.mail.data.remote.dto.AiTestDto
import com.youhui.mail.data.remote.dto.ApiErrorDto
import com.youhui.mail.data.remote.dto.DefaultAccountReq
import com.youhui.mail.data.remote.dto.EventsDto
import com.youhui.mail.data.remote.dto.ExchangeReq
import com.youhui.mail.data.remote.dto.FoldersDto
import com.youhui.mail.data.remote.dto.MailListDto
import com.youhui.mail.data.remote.dto.McpApproveDto
import com.youhui.mail.data.remote.dto.McpApprovalsDto
import com.youhui.mail.data.remote.dto.McpConfigDto
import com.youhui.mail.data.remote.dto.McpScopeDto
import com.youhui.mail.data.remote.dto.McpScopeReq
import com.youhui.mail.data.remote.dto.McpTokenDto
import com.youhui.mail.data.remote.dto.McpTokenReq
import com.youhui.mail.data.remote.dto.MessageDto
import com.youhui.mail.data.remote.dto.MobileLoginReq
import com.youhui.mail.data.remote.dto.NotificationConfigDto
import com.youhui.mail.data.remote.dto.NotificationConfigReq
import com.youhui.mail.data.remote.dto.OauthStartDto
import com.youhui.mail.data.remote.dto.OkDto
import com.youhui.mail.data.remote.dto.OkMessageDto
import com.youhui.mail.data.remote.dto.PresetsDto
import com.youhui.mail.data.remote.dto.PushDeviceDto
import com.youhui.mail.data.remote.dto.PushDeviceReq
import com.youhui.mail.data.remote.dto.SessionsDto
import com.youhui.mail.data.remote.dto.SendReq
import com.youhui.mail.data.remote.dto.StatusDto
import com.youhui.mail.data.remote.dto.TokenDto
import com.youhui.mail.data.remote.dto.TranslationConfigDto
import com.youhui.mail.data.remote.dto.TranslationConfigReq
import com.youhui.mail.data.remote.dto.TranslationReq
import com.youhui.mail.data.remote.dto.TranslationResultDto
import okhttp3.RequestBody
import okhttp3.ResponseBody
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Streaming
import retrofit2.http.Tag

/** 对齐服务端 REST 接口（设计文档 B3；含 Part A 新增端点）。 */
interface YouhuiApi {

    @GET("api/status")
    suspend fun status(): StatusDto

    // ---- A1 移动端令牌鉴权 ----
    @POST("api/mobile/login")
    suspend fun mobileLogin(@Body body: MobileLoginReq): TokenDto

    @GET("api/mobile/sessions")
    suspend fun sessions(): SessionsDto

    @DELETE("api/mobile/sessions/{deviceId}")
    suspend fun revokeSession(@Path("deviceId") deviceId: String): OkDto

    // ---- 账户 / 文件夹 ----
    @GET("api/accounts")
    suspend fun accounts(): AccountsDto

    @GET("api/folders")
    suspend fun folders(@Query("accountId") accountId: String? = null): FoldersDto

    // ---- 邮件列表 / 详情 / 操作 / 发送 ----
    @GET("api/mail")
    suspend fun mail(
        @Query("folder") folder: String,
        @Query("accountId") accountId: String = "all",
        @Query("q") q: String? = null,
        @Query("page") page: Int = 1,
        @Query("limit") limit: Int = 30
    ): MailListDto

    @GET("api/message/{accountId}/{uid}")
    suspend fun message(
        @Path("accountId") accountId: String,
        @Path("uid") uid: Long,
        @Query("folder") folder: String,
        @Query("attachments") attachments: String = "meta"
    ): MessageDto

    @POST("api/message/{accountId}/{uid}/action")
    suspend fun action(
        @Path("accountId") accountId: String,
        @Path("uid") uid: Long,
        @Body body: ActionReq
    ): OkDto

    @POST("api/send")
    suspend fun send(@Body body: SendReq): OkDto

    // ---- A2 附件流式下载 ----
    @Streaming
    @GET("api/message/{accountId}/{uid}/attachment/{index}")
    suspend fun attachment(
        @Path("accountId") accountId: String,
        @Path("uid") uid: Long,
        @Path("index") index: Int,
        @Query("folder") folder: String,
        @Query("disposition") disposition: String = "attachment"
    ): ResponseBody

    // ---- 推送事件游标 ----
    @GET("api/notifications/events")
    suspend fun events(@Query("after") after: Long? = null): EventsDto

    // ---- FCM 设备登记（唤醒链路；服务端 FCM 未配置时返回 503，拉取周期任务仍可用）----
    @POST("api/push/devices")
    suspend fun registerPushDevice(@Body body: PushDeviceReq): PushDeviceDto

    @DELETE("api/push/devices/{deviceId}")
    suspend fun unregisterPushDevice(@Path("deviceId") deviceId: String): OkDto

    // ---- 设置：账户 ----
    @GET("api/presets")
    suspend fun presets(): PresetsDto

    @POST("api/accounts/test")
    suspend fun testAccount(@Body body: AccountFormReq): OkMessageDto

    @POST("api/accounts")
    suspend fun createAccount(@Body body: AccountFormReq): OkMessageDto

    @DELETE("api/accounts/{id}")
    suspend fun deleteAccount(@Path("id") id: String): OkDto

    @PUT("api/preferences/default-account")
    suspend fun setDefaultAccount(@Body body: DefaultAccountReq): OkDto

    // ---- 设置：通知 ----
    @GET("api/notifications/config")
    suspend fun notificationConfig(): NotificationConfigDto

    @PUT("api/notifications/config")
    suspend fun updateNotificationConfig(@Body body: NotificationConfigReq): NotificationConfigDto

    // ---- 设置：身份绑定（解绑；绑定新身份需在网页工作台操作）----
    @DELETE("api/identity/{provider}")
    suspend fun unbindIdentity(@Path("provider") provider: String): OkDto

    // ---- 设置：备份与恢复 ----
    @Streaming
    @GET("api/backup/export")
    suspend fun exportBackup(): ResponseBody

    @Streaming
    @POST("api/backup/restore")
    suspend fun restoreBackup(
        @Body body: RequestBody,
        @Header("x-backup-passphrase") passphrase: String = ""
    ): OkMessageDto

    // ---- AI 助手（与网页工作台共用同一套服务端配置）----
    @GET("api/ai/config")
    suspend fun aiConfig(): AiConfigDto

    @PUT("api/ai/config")
    suspend fun updateAiConfig(@Body body: AiConfigReq): AiConfigDto

    @DELETE("api/ai/config")
    suspend fun deleteAiConfig(): OkDto

    @POST("api/ai/test")
    suspend fun testAi(@Body body: AiConfigReq, @Tag longRunning: LongRunning = LongRunning()): AiTestDto

    @POST("api/ai/chat")
    suspend fun aiChat(@Body body: AiChatReq, @Tag longRunning: LongRunning = LongRunning()): AiChatReplyDto

    @GET("api/ai/digest/latest")
    suspend fun latestAiDigest(@Query("accountId") accountId: String = "all"): AiDigestEnvelopeDto

    @POST("api/ai/digest")
    suspend fun createAiDigest(@Body body: AiDigestReq, @Tag longRunning: LongRunning = LongRunning()): AiDigestEnvelopeDto

    // ---- Agent / MCP：配置、权限令牌与待确认操作 ----
    @GET("api/mcp/config")
    suspend fun mcpConfig(): McpConfigDto

    @POST("api/mcp/token")
    suspend fun createMcpToken(@Body body: McpTokenReq): McpTokenDto

    @POST("api/mcp/token/{permission}/scope")
    suspend fun updateMcpScope(
        @Path("permission") permission: String,
        @Body body: McpScopeReq
    ): McpScopeDto

    @DELETE("api/mcp/token/{permission}")
    suspend fun revokeMcpToken(@Path("permission") permission: String): OkDto

    @GET("api/mcp/approvals")
    suspend fun mcpApprovals(): McpApprovalsDto

    @POST("api/mcp/approvals/{id}/approve")
    suspend fun approveMcp(@Path("id") id: String, @Body body: RequestBody): McpApproveDto

    @POST("api/mcp/approvals/{id}/deny")
    suspend fun denyMcp(@Path("id") id: String, @Body body: RequestBody): OkDto

    // ---- 邮件翻译 ----
    @GET("api/translation/config")
    suspend fun translationConfig(): TranslationConfigDto

    @PUT("api/translation/config")
    suspend fun updateTranslationConfig(@Body body: TranslationConfigReq): TranslationConfigDto

    @DELETE("api/translation/config")
    suspend fun deleteTranslationConfig(): OkDto

    @POST("api/translation/translate")
    suspend fun translate(
        @Body body: TranslationReq,
        @Tag longRunning: LongRunning = LongRunning(120)
    ): TranslationResultDto

    // ---- A3 OAuth 回环（阶段 4 接入 UI）----
    @GET("api/mobile/identity/{provider}/start")
    suspend fun oauthStart(
        @Path("provider") provider: String,
        @Query("redirect_uri") redirectUri: String,
        @Query("state") state: String,
        @Query("code_challenge") codeChallenge: String,
        @Query("code_challenge_method") method: String = "S256"
    ): OauthStartDto

    @POST("api/mobile/oauth/exchange")
    suspend fun oauthExchange(@Body body: ExchangeReq): TokenDto
}

/** 解析服务端错误体（{ error: "..." }），用于统一错误提示。 */
fun parseApiError(body: String?): String {
    if (body.isNullOrBlank()) return "请求失败，请稍后重试。"
    return try {
        val json = kotlinx.serialization.json.Json { ignoreUnknownKeys = true }
        json.decodeFromString(ApiErrorDto.serializer(), body).error ?: body.take(200)
    } catch (ignored: Exception) {
        body.take(200)
    }
}
