(function attachMailListFilters(root) {
  const verificationCue = /验证码|校验码|动态(?:验证)?码|一次性(?:验证)?码|验证代码|登录(?:验证)?码|安全码|(?:verification|security|one[-\s]?time|login)\s+(?:code|password)|\bOTP\b/i;
  const verificationCodePattern = /(?:验证码|校验码|动态(?:验证)?码|一次性(?:验证)?码|验证代码|登录(?:验证)?码|安全码|(?:verification|security|one[-\s]?time|login)\s+(?:code|password)|\bOTP\b)[^\d]{0,24}(\d{4,8})(?!\d)/iu;

  function extractVerificationCode(text) {
    const value = String(text || '').slice(0, 14000);
    if (!verificationCue.test(value)) return null;
    return value.match(verificationCodePattern)?.[1] || null;
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
