import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { hashPassword, verifyPassword, passwordNeedsRehash, SCRYPT_CURRENT_N } from '../password-hash.js';

function legacyHash(password, salt = crypto.randomBytes(16)) {
  return `${salt.toString('hex')}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

test('新格式哈希可校验且使用当前成本参数', () => {
  assert.equal(SCRYPT_CURRENT_N, 32768);
  const encoded = hashPassword('一个足够长的口令 123456');
  assert.match(encoded, /^scrypt:32768:[0-9a-f]{32}:[0-9a-f]{128}$/);
  assert.equal(verifyPassword('一个足够长的口令 123456', encoded), true);
  assert.equal(verifyPassword('错误口令 654321', encoded), false);
  assert.equal(passwordNeedsRehash(encoded), false);
});

test('旧格式仍可校验并标记需要升级', () => {
  const encoded = legacyHash('legacy password abc');
  assert.equal(verifyPassword('legacy password abc', encoded), true);
  assert.equal(verifyPassword('wrong password', encoded), false);
  assert.equal(passwordNeedsRehash(encoded), true);
});

test('篡改与畸形输入安全拒绝', () => {
  const encoded = hashPassword('correct horse battery staple');
  assert.equal(verifyPassword('correct horse battery staple', `${encoded}ab`), false);
  assert.equal(verifyPassword('x', 'scrypt:1:abcd:abcd'), false);        // 成本参数低于下限
  assert.equal(verifyPassword('x', 'scrypt:99999999:abcd:abcd'), false); // 非 2 的幂且超上限
  assert.equal(verifyPassword('x', 'scrypt:notanumber:abcd:abcd'), false);
  assert.equal(verifyPassword('x', ''), false);
  assert.equal(verifyPassword('x', undefined), false);
});

test('随机盐使相同口令的哈希不同', () => {
  assert.notEqual(hashPassword('same password xyz'), hashPassword('same password xyz'));
});
