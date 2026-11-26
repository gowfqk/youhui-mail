import test from 'node:test';
import assert from 'node:assert/strict';
import { extractVerificationCode } from '../verification-code.js';

test('提示词与数字相邻时提取验证码', () => {
  assert.equal(extractVerificationCode('验证码：483921'), '483921');
  assert.equal(extractVerificationCode('您的验证码是 048392'), '048392');
  assert.equal(extractVerificationCode('Your verification code is 123456'), '123456');
  assert.equal(extractVerificationCode('one-time code 998877'), '998877');
  assert.equal(extractVerificationCode('login code: 246810'), '246810');
  assert.equal(extractVerificationCode('OTP 553322'), '553322');
  assert.equal(extractVerificationCode('校验码 778899'), '778899');
  assert.equal(extractVerificationCode('一次性验证码：135246'), '135246');
});

test('无提示词或数字长度不符时不误判', () => {
  assert.equal(extractVerificationCode('订单号 123456 已经发货'), null);
  assert.equal(extractVerificationCode('Invoice #20261122 total $99'), null);
  assert.equal(extractVerificationCode('验证码：123'), null);        // 不足 4 位
  assert.equal(extractVerificationCode('验证码：123456789'), null); // 超过 8 位
  assert.equal(extractVerificationCode(''), null);
  assert.equal(extractVerificationCode(null), null);
});

test('多行正文按提示词就近匹配', () => {
  const body = [
    '订单编号 987654321 已创建。',
    '',
    '如需确认，请输入验证码 483921 完成登录。'
  ].join('\n');
  assert.equal(extractVerificationCode(body), '483921');
});

test('超长输入截断后仍然安全', () => {
  const filler = '无提示词的普通内容。'.repeat(1000);
  const suffix = '验证码：483921';
  assert.equal(extractVerificationCode(filler), null);
  const truncated = (filler + suffix).slice(0, 14000); // 提示词被截断边界切断时不抛错
  const result = extractVerificationCode(truncated);
  assert.ok(result === null || /^\d{4,8}$/.test(result));
});

test('主题中数字在前的形态也可提取', () => {
  assert.equal(extractVerificationCode('G-123456 is your Google verification code'), '123456');
  assert.equal(extractVerificationCode('123456 is your login code'), '123456');
  assert.equal(extractVerificationCode('884212 - Your WhatsApp code'), '884212');
  assert.equal(extractVerificationCode('654321，登录验证码'), '654321');
  assert.equal(extractVerificationCode('2468 is your workspace sign in code'), '2468');
  assert.equal(extractVerificationCode('Your code is 556677'), '556677');
  assert.equal(extractVerificationCode('Your WhatsApp code is 889900'), '889900');
});

test('主题式提取不会误判订单/金额等数字', () => {
  assert.equal(extractVerificationCode('您的订单 483921 已发货'), null);
  assert.equal(extractVerificationCode('订单 483921 已发货，请查收 your code'), null);
  assert.equal(extractVerificationCode('483921'), null); // 纯数字无提示词
  assert.equal(extractVerificationCode('Invoice 483921 issued today'), null);
});
