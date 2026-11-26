(function attachMailListFilters(root) {
  // 与服务端 verification-code.js 保持一致：支持提示词在前/数字在前/your-code 前后四种形态。
  const verificationCue = /验证码|校验码|动态(?:验证)?码|一次性(?:验证)?码|验证代码|登录(?:验证)?码|安全码|(?:verification|security|one[-\s]?time|login|sign[-\s]?in|access)\s+(?:code|password)|\bOTP\b|your\s+(?:\w+\s+){0,2}code/i;
  const verificationCodePattern = /(?:验证码|校验码|动态(?:验证)?码|一次性(?:验证)?码|验证代码|登录(?:验证)?码|安全码|(?:verification|security|one[-\s]?time|login)\s+(?:code|password)|\bOTP\b)[^\d]{0,24}(\d{4,8})(?!\d)/iu;
  const verificationCodePrefixPattern = /(?:^|[^\dA-Za-z])(\d{4,8})(?!\d).{0,24}?(?:验证码|校验码|动态(?:验证)?码|一次性(?:验证)?码|验证代码|登录(?:验证)?码|安全码|(?:verification|security|one[-\s]?time|login|sign[-\s]?in|access)\s+(?:code|password)|\bOTP\b)/iu;
  const verificationCodeYourPattern = /(?:^|[^\dA-Za-z])(\d{4,8})(?!\d).{0,24}?your\s+(?:\w+\s+){0,2}code/iu;
  const verificationCodeSuffixPattern = /your\s+(?:\w+\s+){0,2}code[^\d]{0,24}(\d{4,8})(?!\d)/iu;
  const distractorPattern = /(?:单号|订单|编号|流水号|工单|件数|金额|价格|优惠|红包|快件|取件码|手机号|电话|房间号|工号|账号|卡号|发票|order|invoice|amount|price|phone|tel|room)/i;

  function extractVerificationCode(text) {
    const value = String(text || '').slice(0, 14000);
    if (!verificationCue.test(value)) return null;
    const direct = value.match(verificationCodePattern)?.[1];
    if (direct) return direct;
    for (const pattern of [verificationCodePrefixPattern, verificationCodeYourPattern, verificationCodeSuffixPattern]) {
      const candidate = value.match(pattern)?.[1];
      if (!candidate) continue;
      const start = value.indexOf(candidate);
      const window = value.slice(Math.max(0, start - 20), start + candidate.length + 40);
      if (!distractorPattern.test(window)) return candidate;
    }
    return null;
  }

  function hasVerificationCue(message) {
    if (!message || typeof message !== 'object') return false;
    if (/^\d{4,8}$/.test(String(message.verificationCode || '').trim())) return true;
    if (extractVerificationCode(message.verificationCode || '')) return true;
    return [message.subject, message.snippet, message.preview]
      .some((value) => verificationCue.test(String(value || '')));
  }

  function matchesFilter(message, filter = 'all') {
    if (!message || typeof message !== 'object') return false;
    if (filter === 'unread') return message.unread === true;
    if (filter === 'verification') return hasVerificationCue(message);
    if (filter === 'attachments') {
      return message.hasAttachments === true || Number(message.attachmentCount) > 0;
    }
    return filter === 'all';
  }

  root.YouhuiMailListFilters = { extractVerificationCode, hasVerificationCue, matchesFilter };
})(globalThis);