package com.youhui.mail.util

import kotlinx.serialization.json.JsonPrimitive
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** 服务端 date 字段兼容：ISO 字符串或毫秒时间戳 → 本地化显示文本。 */
object Formatters {

    private val listFormatter = DateTimeFormatter.ofPattern("MM-dd HH:mm", Locale.getDefault())
    private val detailFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm", Locale.getDefault())
    private val timeOnly = DateTimeFormatter.ofPattern("HH:mm", Locale.getDefault())
    private val weekdayFormatter = DateTimeFormatter.ofPattern("EEEE", Locale.getDefault())

    /** 收件箱列表用短格式。 */
    fun dateText(value: JsonPrimitive?): String = format(value, listFormatter)

    /** 详情页用长格式。 */
    fun dateLong(value: JsonPrimitive?): String = format(value, detailFormatter)

    /**
     * 友好时间（雷鸟风格）：
     * 今天 14:30 / 昨天 09:12 / 周三 15:00（7 天内）/ 2026-11-02 10:24。
     */
    fun friendly(value: JsonPrimitive?): String {
        val instant = toInstant(value) ?: return ""
        val zone = ZoneId.systemDefault()
        val dateTime = instant.atZone(zone)
        val today = LocalDate.now(zone)
        val date = dateTime.toLocalDate()
        return when {
            date.isEqual(today) -> "今天 ${timeOnly.format(dateTime)}"
            date.isEqual(today.minusDays(1)) -> "昨天 ${timeOnly.format(dateTime)}"
            date.isAfter(today.minusDays(7)) -> "${weekdayFormatter.format(dateTime)} ${timeOnly.format(dateTime)}"
            else -> detailFormatter.format(dateTime)
        }
    }

    /** 供未读圆点等需要排序判断的场景使用。 */
    fun toInstant(value: JsonPrimitive?): Instant? {
        val raw = value?.content ?: return null
        if (raw.isBlank()) return null
        return runCatching {
            if (raw.matches(Regex("^\\d{10,16}$"))) Instant.ofEpochMilli(raw.toLong())
            else OffsetDateTime.parse(raw).toInstant()
        }.getOrNull()
    }

    private fun format(value: JsonPrimitive?, formatter: DateTimeFormatter): String {
        val instant = toInstant(value) ?: return ""
        return formatter.format(instant.atZone(ZoneId.systemDefault()))
    }
}
