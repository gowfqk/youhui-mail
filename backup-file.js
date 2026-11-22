// 邮汇备份文件（.yhbackup）的格式常量、加解密与解析。
// 导出与导出恢复共享同一实现：流式加密产物必须能被 parseBackupFile 完整解回。
import crypto from 'node:crypto';
import fs from 'node:fs';

export const BACKUP_MAGIC = Buffer.from('YOUHUI-MAIL-BACKUP\n', 'ascii');
export const BACKUP_ENCRYPTED_MAGIC = Buffer.from('YOUHUI-MAIL-ENCRYPTED-BACKUP\n', 'ascii');
export const BACKUP_MAX_BYTES = 250 * 1024 * 1024;

export function decryptWithKey(value, key) {
  const all = Buffer.from(String(value || ''), 'base64');
  if (all.length < 29) throw new Error('备份中的加密数据格式无效。');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, all.subarray(0, 12));
  decipher.setAuthTag(all.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(all.subarray(28)), decipher.final()]).toString('utf8'));
}
export function parsePlainBackupFile(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < BACKUP_MAGIC.length + 2 || buffer.length > BACKUP_MAX_BYTES) {
    throw new Error('备份文件为空、过大或格式无效（最大 250 MB）。');
  }
  if (!buffer.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)) throw new Error('这不是有效的邮汇备份文件。');
  const headerEnd = buffer.indexOf(0x0a, BACKUP_MAGIC.length);
  if (headerEnd < 0 || headerEnd - BACKUP_MAGIC.length > 4096) throw new Error('备份文件头无效。');
  let header;
  try { header = JSON.parse(buffer.subarray(BACKUP_MAGIC.length, headerEnd).toString('utf8')); }
  catch { throw new Error('备份文件头无法读取。'); }
  const key = Buffer.from(String(header.encryptionKey || ''), 'base64');
  const databaseBytes = buffer.subarray(headerEnd + 1);
  if (header.version !== 1 || key.length !== 32 || key.toString('base64') !== header.encryptionKey ||
      !Number.isSafeInteger(header.databaseBytes) || header.databaseBytes !== databaseBytes.length ||
      databaseBytes.length < 100 || databaseBytes.length > BACKUP_MAX_BYTES ||
      !/^[a-f0-9]{64}$/.test(String(header.databaseSha256 || '')) ||
      crypto.createHash('sha256').update(databaseBytes).digest('hex') !== header.databaseSha256) {
    throw new Error('备份文件不完整、已损坏或版本不受支持。');
  }
  return { key, databaseBytes };
}
export function parseBackupFile(buffer, passphrase = '') {
  if (Buffer.isBuffer(buffer) && buffer.subarray(0, BACKUP_ENCRYPTED_MAGIC.length).equals(BACKUP_ENCRYPTED_MAGIC)) {
    if (buffer.length > BACKUP_MAX_BYTES) throw new Error('加密备份文件超过 250 MB 上限。');
    const headerEnd = buffer.indexOf(0x0a, BACKUP_ENCRYPTED_MAGIC.length);
    if (headerEnd < 0 || headerEnd - BACKUP_ENCRYPTED_MAGIC.length > 4096) throw new Error('加密备份文件头无效。');
    let header;
    try { header = JSON.parse(buffer.subarray(BACKUP_ENCRYPTED_MAGIC.length, headerEnd).toString('utf8')); }
    catch { throw new Error('加密备份文件头无法读取。'); }
    const ciphertext = buffer.subarray(headerEnd + 1);
    const salt = Buffer.from(String(header.salt || ''), 'base64');
    const iv = Buffer.from(String(header.iv || ''), 'base64');
    const tag = Buffer.from(String(header.tag || ''), 'base64');
    if (header.version !== 1 || header.kdf !== 'scrypt' || header.n !== 32768 || header.r !== 8 || header.p !== 1 ||
        salt.length !== 16 || iv.length !== 12 || tag.length !== 16 ||
        !Number.isSafeInteger(header.ciphertextBytes) || header.ciphertextBytes !== ciphertext.length || ciphertext.length < 100 ||
        !/^[a-f0-9]{64}$/.test(String(header.ciphertextSha256 || '')) ||
        crypto.createHash('sha256').update(ciphertext).digest('hex') !== header.ciphertextSha256) {
      throw new Error('加密备份不完整、已损坏或版本不受支持。');
    }
    const password = String(passphrase || '');
    if (password.length < 12 || password.length > 1024) throw new Error('请输入创建此加密备份时设置的密码（至少 12 个字符）。');
    try {
      const key = crypto.scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return parsePlainBackupFile(plaintext);
    } catch { throw new Error('加密备份密码不正确，或文件已损坏。'); }
  }
  return parsePlainBackupFile(buffer);
}
export function fileSha256Hex(filePath) {
  return new Promise((resolve, reject) => {
    const digest = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => digest.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(digest.digest('hex')));
  });
}
// 流式加密整库快照：密文写入临时文件并同时累计 sha256，完成后返回头部信息。
// 头部字段与旧内存版完全一致，恢复路径无需感知差异。
export function encryptBackupFileStreaming(sourcePath, targetPath, passphrase) {
  const password = String(passphrase || '');
  if (password.length < 12 || password.length > 1024) throw new Error('加密备份密码须为 12 到 1024 个字符。');
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const digest = crypto.createHash('sha256');
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(targetPath, { mode: 0o600 });
    const fail = (error) => { reject(error); output.destroy(); };
    output.on('error', fail);
    const source = fs.createReadStream(sourcePath);
    source.on('error', fail);
    source.on('data', (chunk) => {
      const block = cipher.update(chunk);
      digest.update(block);
      output.write(block);
    });
    source.on('end', () => {
      try {
        const block = cipher.final();
        digest.update(block);
        output.end(block, () => {
          try { fs.chmodSync(targetPath, 0o600); } catch {}
          resolve({ header: Buffer.from(JSON.stringify({
            version: 1, kdf: 'scrypt', n: 32768, r: 8, p: 1,
            salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'),
            ciphertextBytes: fs.statSync(targetPath).size, ciphertextSha256: digest.digest('hex')
          }), 'utf8'), ciphertextPath: targetPath });
        });
      } catch (error) { fail(error); }
    });
  });
}
