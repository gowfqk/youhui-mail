// 新邮件验证码提取：仅当提示词与 4–8 位数字明确相邻时才认定，避免把普通数字当作验证码推送。
const verificationCue = /验证码|校验码|动态(?:验证)?码|一次性(?:验证)?码|验证代码|登录(?:验证)?码|安全码|(?:verification|security|one[-\s]?time|login)\s+(?:code|password)|\bOTP\b/i;
const verificationCodePattern = /(?:验证码|校验码|动态(?:验证)?码|一次性(?:验证)?码|验证代码|登录(?:验证)?码|安全码|(?:verification|security|one[-\s]?time|login)\s+(?:code|password)|\bOTP\b)[^\d]{0,24}(\d{4,8})(?!\d)/iu;
export function extractVerificationCode(text) {
  const value = String(text || '').slice(0, 14000);
  if (!verificationCue.test(value)) return null;
  return value.match(verificationCodePattern)?.[1] || null;
}
