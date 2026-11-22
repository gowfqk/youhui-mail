import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BACKUP_MAGIC, BACKUP_ENCRYPTED_MAGIC, parseBackupFile, parsePlainBackupFile, encryptBackupFileStreaming, fileSha256Hex } from '../backup-file.js';

function buildPlainPayload(body = Buffer.from('邮汇备份数据库内容。'.repeat(200))) {
  const header = Buffer.from(JSON.stringify({
    version: 1, createdAt: new Date().toISOString(),
    encryptionKey: crypto.randomBytes(32).toString('base64'),
    databaseBytes: body.length, databaseSha256: crypto.createHash('sha256').update(body).digest('hex')
  }), 'utf8');
  return Buffer.concat([BACKUP_MAGIC, header, Buffer.from('\n'), body]);
}

test('明文备份可解析出密钥与完整数据库字节', () => {
  const payload = buildPlainPayload();
  const { key, databaseBytes } = parseBackupFile(payload, '');
  assert.equal(key.length, 32);
  assert.equal(databaseBytes.toString('utf8'), '邮汇备份数据库内容。'.repeat(200));
});

test('流式加密产物可被恢复解析器完整解回', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'youhui-backup-test-'));
  try {
    const sourcePath = path.join(directory, 'mail.sqlite');
    const targetPath = path.join(directory, 'backup.enc');
    // 明文内容必须是完整备份结构（与真实导出一致）；150 KB 内容可跨越流式分块边界
    const body = Buffer.alloc(150 * 1024, 7);
    fs.writeFileSync(sourcePath, buildPlainPayload(body));
    const { header, ciphertextPath } = await encryptBackupFileStreaming(sourcePath, targetPath, 'passphrase-123456');
    assert.equal(ciphertextPath, targetPath);
    const parsedHeader = JSON.parse(header.toString('utf8'));
    assert.equal(parsedHeader.version, 1);
    assert.equal(parsedHeader.kdf, 'scrypt');
    assert.equal(parsedHeader.n, 32768);
    const ciphertext = fs.readFileSync(ciphertextPath);
    assert.equal(parsedHeader.ciphertextBytes, ciphertext.length);
    const encrypted = Buffer.concat([BACKUP_ENCRYPTED_MAGIC, header, Buffer.from('\n'), ciphertext]);
    const parsed = parseBackupFile(encrypted, 'passphrase-123456');
    assert.equal(parsed.databaseBytes.length, body.length);
    assert.ok(parsed.databaseBytes.every((byte) => byte === 7));
    assert.throws(() => parseBackupFile(encrypted, 'wrong-passphrase-654321'), /加密备份密码不正确/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('明文路径拒绝损坏与篡改', () => {
  const payload = buildPlainPayload();
  assert.throws(() => parsePlainBackupFile(Buffer.alloc(64, 0x41)), /不是有效的邮汇备份文件/);
  const tampered = Buffer.from(payload);
  tampered[tampered.length - 1] ^= 0xff;
  assert.throws(() => parsePlainBackupFile(tampered), /不完整、已损坏/);
});

test('fileSha256Hex 与 Buffer 哈希一致', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'youhui-sha-test-'));
  try {
    const filePath = path.join(directory, 'data.bin');
    const data = crypto.randomBytes(64 * 1024 + 33);
    fs.writeFileSync(filePath, data);
    assert.equal(await fileSha256Hex(filePath), crypto.createHash('sha256').update(data).digest('hex'));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
