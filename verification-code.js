// 新邮件验证码提取：仅当提示词与 4–8 位数字明确相邻时才认定，避免把普通数字当作验证码推送。
// 提示词表；your ... code 形态（如 "Your WhatsApp code"）也算强信号。
const verificationCue = /验证码|校验码|动态(?:验证)?码|一次性(?:验证)?码|验证代码|登录(?:验证)?码|安全码|(?:verification|security|one[-\s]?time|login|sign[-\s]?in|access)\s+(?:code|password)|\bOTP\b|your\s+(?:\w+\s+){0,2}code/i;
// 形态一（常规）：提示词在前，数字紧跟其后（0–24 个非数字字符内）
const verificationCodePattern = /(?:验证码|校验码|动态(?:验证)?码|一次性(?:验证)?码|验证代码|登录(?:验证)?码|安全码|(?:verification|security|one[-\s]?time|login)\s+(?:code|password)|\bOTP\b)[^\d]{0,24}(\d{4,8})(?!\d)/iu;
// 形态二（主题常见）：数字在前，提示词在后，如 "G-123456 is your Google verification code"、"654321，登录验证码"
const verificationCodePrefixPattern = /(?:^|[^\dA-Za-z])(\d{4,8})(?!\d).{0,24}?(?:验证码|校验码|动态(?:验证)?码|一次性(?:验证)?码|验证代码|登录(?:验证)?码|安全码|(?:verification|security|one[-\s]?time|login|sign[-\s]?in|access)\s+(?:code|password)|\bOTP\b)/iu;
// 形态三（主题常见）：数字在前，"your ... code" 收尾，如 "884212 - Your WhatsApp code"
const verificationCodeYourPattern = /(?:^|[^\dA-Za-z])(\d{4,8})(?!\d).{0,24}?your\s+(?:\w+\s+){0,2}code/iu;
// 形态四：your ... code 在前、数字在后，如 "Your code is 556677"
const verificationCodeSuffixPattern = /your\s+(?:\w+\s+){0,2}code[^\d]{0,24}(\d{4,8})(?!\d)/iu;
// 干扰词：候选数字附近出现这些词时不认定（订单号、金额、电话等不是验证码）
const distractorPattern = /(?:单号|订单|编号|流水号|工单|件数|金额|价格|优惠|红包|快件|取件码|手机号|电话|房间号|工号|账号|卡号|发票|order|invoice|amount|price|phone|tel|room)/i;
export function extractVerificationCode(text) {
  const value = String(text || '').slice(0, 14000);
  if (!verificationCue.test(value)) return null;
  const direct = value.match(verificationCodePattern)?.[1];
  if (direct) return direct;
  // 数字与提示词的相对位置不定的形态：命中后检查候选数字附近没有干扰词再认定
  for (const pattern of [verificationCodePrefixPattern, verificationCodeYourPattern, verificationCodeSuffixPattern]) {
    const candidate = value.match(pattern)?.[1];
    if (!candidate) continue;
    const start = value.indexOf(candidate);
    const window = value.slice(Math.max(0, start - 20), start + candidate.length + 40);
    if (!distractorPattern.test(window)) return candidate;
  }
  return null;
}