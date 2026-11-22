// 工作台口令的 scrypt 哈希。
// v2 格式 "scrypt:N:salt:digest" 显式携带成本参数，当前 N=32768，与备份加密口径一致；
// 旧格式 "salt:digest"（N=16384）仍可校验，登录成功后由调用方用 hashPassword 透明升级。
import crypto from 'node:crypto';
export const SCRYPT_CURRENT_N = 32768;
const SCRYPT_LEGACY_N = 16384;
const SCRYPT_MIN_N = 16384;
const SCRYPT_MAX_N = 2 ** 21;
const SCRYPT_PARAMS = { r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
function scryptDigest(password, salt, n) {
  return crypto.scryptSync(password, salt, 64, { N: n, ...SCRYPT_PARAMS });
}
function digestEquals(actual, expected) {
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
export function hashPassword(password, salt = crypto.randomBytes(16)) {
  return `scrypt:${SCRYPT_CURRENT_N}:${salt.toString('hex')}:${scryptDigest(password, salt, SCRYPT_CURRENT_N).toString('hex')}`;
}
export function passwordNeedsRehash(encoded) {
  const parts = String(encoded || '').split(':');
  return parts.length !== 4 || parts[0] !== 'scrypt' || Number.parseInt(parts[1], 10) !== SCRYPT_CURRENT_N;
}
export function verifyPassword(password, encoded) {
  const parts = String(encoded || '').split(':');
  if (parts.length === 4 && parts[0] === 'scrypt') {
    // 成本参数取自哈希串本身：限制在合理区间且为 2 的幂，防止畸形数据放大内存消耗
    const n = Number.parseInt(parts[1], 10);
    if (!Number.isSafeInteger(n) || (n & (n - 1)) !== 0 || n < SCRYPT_MIN_N || n > SCRYPT_MAX_N) return false;
    try { return digestEquals(scryptDigest(password, Buffer.from(parts[2], 'hex'), n), Buffer.from(parts[3], 'hex')); }
    catch { return false; }
  }
  if (parts.length === 2) {
    try { return digestEquals(scryptDigest(password, Buffer.from(parts[0], 'hex'), SCRYPT_LEGACY_N), Buffer.from(parts[1], 'hex')); }
    catch { return false; }
  }
  return false;
}
