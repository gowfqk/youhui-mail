import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicAddress, makePinnedLookup } from '../net-guard.js';

test('公网与内网 IPv4 地址判定', () => {
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('1.1.1.1'), true);
  assert.equal(isPublicAddress('127.0.0.1'), false);
  assert.equal(isPublicAddress('10.1.2.3'), false);
  assert.equal(isPublicAddress('192.168.1.1'), false);
  assert.equal(isPublicAddress('172.16.0.9'), false);
  assert.equal(isPublicAddress('172.31.255.255'), false);
  assert.equal(isPublicAddress('172.32.0.1'), true);
  assert.equal(isPublicAddress('169.254.169.254'), false);
  assert.equal(isPublicAddress('100.64.0.1'), false);
  assert.equal(isPublicAddress('224.0.0.1'), false);
  assert.equal(isPublicAddress('0.0.0.0'), false);
  assert.equal(isPublicAddress('203.0.113.9'), false);
  assert.equal(isPublicAddress('198.51.100.7'), false);
});

test('IPv6 与 IPv4 映射地址判定', () => {
  assert.equal(isPublicAddress('2606:4700::1111'), true);
  assert.equal(isPublicAddress('::ffff:127.0.0.1'), false);
  assert.equal(isPublicAddress('::ffff:8.8.8.8'), true);
  assert.equal(isPublicAddress('::ffff:a02:201'), false); // 映射 10.2.2.1
  assert.equal(isPublicAddress('fe80::1'), false);        // 链路本地
  assert.equal(isPublicAddress('2001:db8::1'), false);    // 文档网段
  assert.equal(isPublicAddress('::1'), false);            // 回环（0xxx 段）
  assert.equal(isPublicAddress('not-an-ip'), false);
  assert.equal(isPublicAddress(''), false);
});

test('固定 lookup 返回已校验地址并按族过滤', () => {
  const addresses = [{ address: '1.2.3.4', family: 4 }, { address: '2606:4700::1111', family: 6 }];
  const lookup = makePinnedLookup(addresses);
  lookup('example.com', (error, address, family) => {
    assert.ifError(error);
    assert.equal(address, '1.2.3.4');
    assert.equal(family, 4);
  });
  lookup('example.com', { family: 6 }, (error, address, family) => {
    assert.ifError(error);
    assert.equal(address, '2606:4700::1111');
    assert.equal(family, 6);
  });
  lookup('example.com', { family: 6, all: true }, (error, entries) => {
    assert.ifError(error);
    assert.deepEqual(entries, [{ address: '2606:4700::1111', family: 6 }]);
  });
  const ipv6Only = makePinnedLookup([{ address: '2606:4700::1111', family: 6 }]);
  ipv6Only('example.com', { family: 4 }, (error) => {
    assert.equal(error?.code, 'ENOTFOUND'); // 该族无已校验地址时拒绝，防止绕过 pin
  });
});
