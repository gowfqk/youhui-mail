import 'dotenv/config';
import express from 'express';
import Database from 'better-sqlite3';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import { sanitizeEmailHtml, normalizeContentId } from './email-html.js';
import { securityHeadersForPath } from './security-policy.js';
import { makePinnedLookup, validatedAddresses } from './net-guard.js';
import { extractVerificationCode } from './verification-code.js';
import { hashPassword, verifyPassword, passwordNeedsRehash } from './password-hash.js';
import { BACKUP_MAGIC, BACKUP_ENCRYPTED_MAGIC, BACKUP_MAX_BYTES, parseBackupFile, decryptWithKey, fileSha256Hex, encryptBackupFileStreaming } from './backup-file.js';
import https from 'node:https';
import net from 'node:net';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from 'jose';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachAI } from './ai-service.js';
import { attachMcp } from './mcp-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
process.umask(0o077);
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
fs.chmodSync(DATA_DIR, 0o700);
const KEY_PATH = path.join(DATA_DIR, 'encryption.key');
if (!fs.existsSync(KEY_PATH)) fs.writeFileSync(KEY_PATH, crypto.randomBytes(32), { mode: 0o600, flag: 'wx' });
fs.chmodSync(KEY_PATH, 0o600);
let ENCRYPTION_KEY = fs.readFileSync(KEY_PATH);
if (ENCRYPTION_KEY.length !== 32) throw new Error('加密密钥格式错误：data/encryption.key 必须是 32 字节。');
const RESTORE_PENDING_PATH = path.join(DATA_DIR, '.restore-pending.json');
function writePrivateFile(filePath, contents) {
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, contents, { mode: 0o600, flag: 'wx' });
    fs.chmodSync(temporaryPath, 0o600);
    fs.renameSync(temporaryPath, filePath);
    fs.chmodSync(filePath, 0o600);
  } finally {
    try { fs.rmSync(temporaryPath, { force: true }); } catch {}
  }
}
const db = new Database(path.join(DATA_DIR, 'mail.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS app_config (id INTEGER PRIMARY KEY CHECK (id = 1), password_hash TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS push_devices (
    device_id TEXT PRIMARY KEY, session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE, token_encrypted TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY, label TEXT NOT NULL, email TEXT NOT NULL, provider TEXT NOT NULL,
    imap_host TEXT NOT NULL, imap_port INTEGER NOT NULL, imap_secure INTEGER NOT NULL,
    smtp_host TEXT NOT NULL, smtp_port INTEGER NOT NULL, smtp_secure INTEGER NOT NULL,
    username TEXT NOT NULL, auth_type TEXT NOT NULL, credentials TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS oauth_states (state TEXT PRIMARY KEY, session_hash TEXT NOT NULL, provider TEXT NOT NULL, expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS identity_oauth_states (
    state_hash TEXT PRIMARY KEY, provider TEXT NOT NULL, flow TEXT NOT NULL,
    session_hash TEXT, browser_hash TEXT NOT NULL, nonce TEXT NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS login_identities (
    provider TEXT PRIMARY KEY, subject_hash TEXT NOT NULL UNIQUE, profile TEXT NOT NULL, linked_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS app_preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS notification_checkpoints (
    account_id TEXT PRIMARY KEY, uid_validity TEXT NOT NULL, highest_uid INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS notification_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL,
    message_uid INTEGER NOT NULL, uid_validity TEXT NOT NULL, folder TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL,
    webhook_pending INTEGER NOT NULL DEFAULT 0, webhook_attempts INTEGER NOT NULL DEFAULT 0,
    webhook_next_attempt_at INTEGER NOT NULL DEFAULT 0, webhook_delivered_at INTEGER, webhook_abandoned INTEGER NOT NULL DEFAULT 0,
    fcm_pending INTEGER NOT NULL DEFAULT 0, fcm_attempts INTEGER NOT NULL DEFAULT 0,
    fcm_next_attempt_at INTEGER NOT NULL DEFAULT 0, fcm_delivered_at INTEGER, fcm_abandoned INTEGER NOT NULL DEFAULT 0,
    UNIQUE(account_id, folder, uid_validity, message_uid)
  );
  CREATE TABLE IF NOT EXISTS mobile_oauth_codes (
    code_hash TEXT PRIMARY KEY, provider TEXT NOT NULL, device_state_hash TEXT NOT NULL,
    code_challenge TEXT NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER
  );
`);
// WxPusher has its own retry lifecycle; do not repurpose legacy webhook fields.
for (const [column, definition] of Object.entries({
  wxpusher_pending: 'INTEGER NOT NULL DEFAULT 0', wxpusher_attempts: 'INTEGER NOT NULL DEFAULT 0',
  wxpusher_next_attempt_at: 'INTEGER NOT NULL DEFAULT 0', wxpusher_delivered_at: 'INTEGER', wxpusher_abandoned: 'INTEGER NOT NULL DEFAULT 0'
})) {
  if (!db.prepare('PRAGMA table_info(notification_events)').all().some((item) => item.name === column)) {
    db.exec(`ALTER TABLE notification_events ADD COLUMN ${column} ${definition}`);
  }
}
for (const [column, definition] of Object.entries({
  fcm_pending: 'INTEGER NOT NULL DEFAULT 0', fcm_attempts: 'INTEGER NOT NULL DEFAULT 0',
  fcm_next_attempt_at: 'INTEGER NOT NULL DEFAULT 0', fcm_delivered_at: 'INTEGER', fcm_abandoned: 'INTEGER NOT NULL DEFAULT 0'
})) {
  if (!db.prepare('PRAGMA table_info(notification_events)').all().some((item) => item.name === column)) {
    db.exec(`ALTER TABLE notification_events ADD COLUMN ${column} ${definition}`);
  }
}
// 移动端会话：kind 区分 web/mobile，device_* 记录设备信息（守卫式迁移，向后兼容）
for (const [column, definition] of Object.entries({
  kind: "TEXT NOT NULL DEFAULT 'web'", device_id: 'TEXT', device_label: 'TEXT',
  created_at: 'INTEGER NOT NULL DEFAULT 0', last_seen_at: 'INTEGER NOT NULL DEFAULT 0'
})) {
  if (!db.prepare('PRAGMA table_info(sessions)').all().some((item) => item.name === column)) {
    db.exec(`ALTER TABLE sessions ADD COLUMN ${column} ${definition}`);
  }
}
// 第三方登录 mobile 流：redirect_uri（回环/私有 scheme）、PKCE challenge 与 device_state（明文，仅用于回传校验，非秘密）
for (const [column, definition] of Object.entries({
  redirect_uri: 'TEXT', code_challenge: 'TEXT', device_state: 'TEXT'
})) {
  if (!db.prepare('PRAGMA table_info(identity_oauth_states)').all().some((item) => item.name === column)) {
    db.exec(`ALTER TABLE identity_oauth_states ADD COLUMN ${column} ${definition}`);
  }
}
// 通知事件表的部分索引：必须在守卫迁移补列之后统一创建——
// 全新库的主 schema 里 wxpusher/fcm 列尚未通过 ALTER TABLE 补齐，提前引用会导致启动失败
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_notification_events_webhook_due ON notification_events(webhook_next_attempt_at) WHERE webhook_pending = 1 AND webhook_abandoned = 0;
  CREATE INDEX IF NOT EXISTS idx_notification_events_wxpusher_due ON notification_events(wxpusher_next_attempt_at) WHERE wxpusher_pending = 1 AND wxpusher_abandoned = 0;
  CREATE INDEX IF NOT EXISTS idx_notification_events_fcm_due ON notification_events(fcm_next_attempt_at) WHERE fcm_pending = 1 AND fcm_abandoned = 0;
  CREATE INDEX IF NOT EXISTS idx_notification_events_created_at ON notification_events(created_at);
`);
function recoverPendingRestore() {
  if (!fs.existsSync(RESTORE_PENDING_PATH)) return;
  let pending;
  try { pending = JSON.parse(fs.readFileSync(RESTORE_PENDING_PATH, 'utf8')); }
  catch { throw new Error('检测到未完成的备份恢复记录，无法安全启动。'); }
  const oldKey = Buffer.from(String(pending.oldKey || ''), 'base64');
  const newKey = Buffer.from(String(pending.newKey || ''), 'base64');
  if (!pending.id || oldKey.length !== 32 || newKey.length !== 32) throw new Error('备份恢复记录无效，服务已停止以保护数据。');
  const marker = db.prepare('SELECT value FROM app_preferences WHERE key = ?').get('__system_restore_tx');
  const committed = marker?.value === pending.id;
  const safeKey = committed ? newKey : oldKey;
  writePrivateFile(KEY_PATH, safeKey);
  ENCRYPTION_KEY = safeKey;
  fs.rmSync(RESTORE_PENDING_PATH, { force: true });
  if (!committed) db.prepare('DELETE FROM app_preferences WHERE key = ?').run('__system_restore_tx');
}
recoverPendingRestore();
// 会话与流程状态的过期清理：启动时执行一次，之后随通知 sweep 周期性执行
function pruneExpiredAuthRows() {
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  db.prepare('DELETE FROM oauth_states WHERE expires_at < ?').run(now);
  db.prepare('DELETE FROM identity_oauth_states WHERE expires_at < ?').run(now);
  db.prepare('DELETE FROM mobile_oauth_codes WHERE expires_at < ? OR consumed_at IS NOT NULL').run(now);
}
pruneExpiredAuthRows();
db.prepare('DELETE FROM notification_events WHERE created_at < ?').run(Date.now() - 7 * 24 * 60 * 60_000);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
let restoreInProgress = false;
app.use((req, res, next) => {
  const securityHeaders = securityHeadersForPath(req.path);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', securityHeaders.xFrameOptions);
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', securityHeaders.contentSecurityPolicy);
  next();
});
app.use((req, res, next) => {
  if (restoreInProgress) return res.status(503).json({ error: '备份恢复正在应用，请稍后重新登录。' });
  next();
});
app.use(express.json({ limit: '28mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  index: false,
  // 带 12 位内容摘要的文件名视为版本化资源，可长期缓存；源文件与 index.html 用 no-cache，发版即刻生效
  setHeaders: (res, filePath) => {
    const versioned = /^[\w.-]+-[0-9a-f]{12}\.(?:js|css|png|ico|webmanifest)$/.test(path.basename(filePath));
    res.setHeader('Cache-Control', versioned ? 'public, max-age=31536000, immutable' : 'no-cache');
  }
}));
// send 库在 Windows 含非 ASCII 字符（如中文工作空间名）的绝对路径下会误报 NotFound，
// 改用 fs.readFile 直接读取后发送绕过；express.static 内部走相对路径拼接不受影响。
function sendLocalFile(res, filePath, contentType) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      if (!res.headersSent) res.status(error.code === 'ENOENT' ? 404 : 500).json({ error: '文件读取失败。' });
      return;
    }
    if (!res.headersSent) {
      if (contentType) res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', String(data.length));
    }
    res.end(data);
  });
}
app.get('/mail-frame', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  sendLocalFile(res, path.join(__dirname, 'mail-frame.html'), 'text/html; charset=utf-8');
});
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}
function decrypt(value) {
  const all = Buffer.from(value, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, all.subarray(0, 12));
  decipher.setAuthTag(all.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(all.subarray(28)), decipher.final()]).toString('utf8'));
}
function cookieValue(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}
function appendSetCookie(res, value) {
  const current = res.getHeader('Set-Cookie');
  const values = current ? (Array.isArray(current) ? current : [current]) : [];
  res.setHeader('Set-Cookie', [...values, value]);
}
function setSessionCookie(res, req, token) {
  const secure = req.secure ? '; Secure' : '';
  appendSetCookie(res, `youhui_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`);
}
function clearSessionCookie(res, req) {
  const secure = req.secure ? '; Secure' : '';
  appendSetCookie(res, `youhui_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}
function sessionTokenFrom(req) {
  const header = String(req.get('authorization') || '');
  const bearer = header.match(/^Bearer\s+([A-Za-z0-9_.\-]+)$/i);
  if (bearer) return bearer[1]; // 移动端 Bearer 令牌；安全性由令牌本身保证，不依赖 Origin 校验
  return cookieValue(req, 'youhui_session'); // 网页版 Cookie 不变
}
function auth(req, res, next) {
  const token = sessionTokenFrom(req);
  if (!token) return res.status(401).json({ error: '请先解锁邮箱工作台。' });
  const row = db.prepare('SELECT token_hash, expires_at, kind, device_id, last_seen_at FROM sessions WHERE token_hash = ?').get(hash(token));
  if (!row || row.expires_at < Date.now()) {
    if (row) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.token_hash);
    return res.status(401).json({ error: '登录已过期，请重新解锁。' });
  }
  req.sessionHash = row.token_hash;
  // 移动端会话节流更新 last_seen_at（避免每请求写库）
  if (row.kind === 'mobile' && row.device_id && Date.now() - (row.last_seen_at || 0) > 5 * 60_000) {
    try { db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(Date.now(), row.token_hash); } catch {}
  }
  next();
}
function originGuard(req, res, next) {
  const origin = req.get('origin');
  if (origin) {
    try {
      const sourceOrigin = new URL(origin).origin;
      const expectedOrigin = process.env.APP_BASE_URL
        ? new URL(process.env.APP_BASE_URL).origin
        : `${req.protocol}://${req.get('host')}`;
      if (sourceOrigin !== expectedOrigin) return res.status(403).json({ error: '请求来源校验失败。' });
    } catch { return res.status(403).json({ error: '请求来源无效。' }); }
  }
  next();
}

app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return originGuard(req, res, next);
  next();
});

// 旧格式口令（N=16384）在登录成功后透明升级到当前成本参数
function rehashPasswordIfLegacy(encoded, password) {
  if (!passwordNeedsRehash(encoded)) return;
  try { db.prepare('UPDATE app_config SET password_hash = ? WHERE id = 1').run(hashPassword(password)); } catch {}
}
const loginAttempts = new Map();
function attemptAllowed(req) {
  const key = req.ip || 'unknown';
  const entry = loginAttempts.get(key) || { count: 0, since: Date.now() };
  if (Date.now() - entry.since > 15 * 60_000) { entry.count = 0; entry.since = Date.now(); }
  if (entry.count >= 8) return false;
  entry.count += 1; loginAttempts.set(key, entry); return true;
}

const presets = {
  google: { imapHost: 'imap.gmail.com', imapPort: 993, imapSecure: true, smtpHost: 'smtp.gmail.com', smtpPort: 465, smtpSecure: true },
  microsoft: { imapHost: 'outlook.office365.com', imapPort: 993, imapSecure: true, smtpHost: 'smtp.office365.com', smtpPort: 587, smtpSecure: false },
  yahoo: { imapHost: 'imap.mail.yahoo.com', imapPort: 993, imapSecure: true, smtpHost: 'smtp.mail.yahoo.com', smtpPort: 465, smtpSecure: true },
  icloud: { imapHost: 'imap.mail.me.com', imapPort: 993, imapSecure: true, smtpHost: 'smtp.mail.me.com', smtpPort: 587, smtpSecure: false },
  fastmail: { imapHost: 'imap.fastmail.com', imapPort: 993, imapSecure: true, smtpHost: 'smtp.fastmail.com', smtpPort: 465, smtpSecure: true }
};
const mailboxOAuthDefinitions = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scopes: ['openid', 'email', 'profile', 'https://mail.google.com/']
  },
  microsoft: {
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    userInfoUrl: 'https://graph.microsoft.com/oidc/userinfo',
    scopes: ['openid', 'email', 'profile', 'offline_access', 'https://outlook.office.com/IMAP.AccessAsUser.All', 'https://outlook.office.com/SMTP.Send']
  }
};
const loginOAuthProviders = ['google', 'github', 'cloudflare'];
function emptyOAuthClientConfig() {
  return {
    mailbox: { google: { clientId: '', clientSecret: '' }, microsoft: { clientId: '', clientSecret: '' } },
    login: { google: { clientId: '', clientSecret: '' }, github: { clientId: '', clientSecret: '' }, cloudflare: { configurationUrl: '', clientId: '', clientSecret: '' } }
  };
}
function normalizeOAuthClientConfig(value = {}) {
  const empty = emptyOAuthClientConfig();
  for (const provider of ['google', 'microsoft']) {
    empty.mailbox[provider] = {
      clientId: String(value.mailbox?.[provider]?.clientId || ''),
      clientSecret: String(value.mailbox?.[provider]?.clientSecret || '')
    };
  }
  for (const provider of ['google', 'github']) {
    empty.login[provider] = {
      clientId: String(value.login?.[provider]?.clientId || ''),
      clientSecret: String(value.login?.[provider]?.clientSecret || '')
    };
  }
  empty.login.cloudflare = {
    configurationUrl: String(value.login?.cloudflare?.configurationUrl || ''),
    clientId: String(value.login?.cloudflare?.clientId || ''),
    clientSecret: String(value.login?.cloudflare?.clientSecret || '')
  };
  return empty;
}
function getOAuthClientConfig() {
  const stored = db.prepare('SELECT value FROM app_preferences WHERE key = ?').get('oauth_client_config')?.value;
  return normalizeOAuthClientConfig(stored ? decrypt(stored) : {});
}
function seedOAuthClientConfigFromEnvironment() {
  if (db.prepare('SELECT 1 FROM app_preferences WHERE key = ?').get('oauth_client_config')) return;
  const seeded = normalizeOAuthClientConfig({ mailbox: {
    google: { clientId: process.env.GOOGLE_CLIENT_ID || '', clientSecret: process.env.GOOGLE_CLIENT_SECRET || '' },
    microsoft: { clientId: process.env.MICROSOFT_CLIENT_ID || '', clientSecret: process.env.MICROSOFT_CLIENT_SECRET || '' }
  } });
  if (!Object.values(seeded.mailbox).some((item) => item.clientId || item.clientSecret)) return;
  db.prepare(`INSERT INTO app_preferences (key,value) VALUES ('oauth_client_config',?)`).run(encrypt(seeded));
}
seedOAuthClientConfigFromEnvironment();
function saveOAuthClientConfig(config) {
  db.prepare(`INSERT INTO app_preferences (key,value) VALUES ('oauth_client_config',?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(encrypt(normalizeOAuthClientConfig(config)));
}
function oauthProviderConfigFor(provider) {
  const definition = mailboxOAuthDefinitions[provider];
  const saved = getOAuthClientConfig().mailbox[provider];
  if (!definition || !saved?.clientId || !saved?.clientSecret) return null;
  return { ...definition, clientId: saved.clientId, clientSecret: saved.clientSecret };
}
function publicOAuthProviders() {
  return Object.fromEntries(Object.keys(mailboxOAuthDefinitions).map((key) => [key, Boolean(oauthProviderConfigFor(key))]));
}
function identityCallbackUrl(req, provider) {
  const base = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
  return `${base.replace(/\/$/, '')}/identity/${provider}/callback`;
}
function boundIdentity(provider) {
  const row = db.prepare('SELECT profile,linked_at FROM login_identities WHERE provider = ?').get(provider);
  if (!row) return null;
  try { return { ...decrypt(row.profile), linkedAt: row.linked_at }; } catch { return { label: '已绑定账户', linkedAt: row.linked_at }; }
}
function publicIdentityProviders() {
  return Object.fromEntries(loginOAuthProviders.map((provider) => {
    const config = getOAuthClientConfig().login[provider];
    const configured = Boolean(config?.clientId && config?.clientSecret && (provider !== 'cloudflare' || config.configurationUrl));
    return [provider, configured && Boolean(boundIdentity(provider))];
  }));
}
function callbackUrl(req, provider) {
  const base = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
  return `${base.replace(/\/$/, '')}/oauth/${provider}/callback`;
}
function setOAuthFlowCookie(res, req, token) {
  const secure = req.secure ? '; Secure' : '';
  appendSetCookie(res, `youhui_oauth_flow=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure}`);
}
function clearOAuthFlowCookie(res, req) {
  const secure = req.secure ? '; Secure' : '';
  appendSetCookie(res, `youhui_oauth_flow=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}
function constantTimeTextEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function validateCloudflareConfigurationUrl(value, clientId = '') {
  let url;
  try { url = new URL(value); } catch { throw new Error('Cloudflare Access OIDC 配置端点格式无效。'); }
  const suffix = '/.well-known/openid-configuration';
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash ||
      !url.hostname.endsWith('.cloudflareaccess.com') || !url.pathname.endsWith(suffix)) {
    throw new Error('请填写 Cloudflare Access 提供的 HTTPS OIDC Configuration endpoint。');
  }
  const issuerPath = url.pathname.slice(0, -suffix.length);
  if (!/^\/cdn-cgi\/access\/sso\/oidc\/[^/]+$/.test(issuerPath)) throw new Error('Cloudflare OIDC 配置端点路径不符合 Access 应用格式。');
  let endpointClientId = '';
  try { endpointClientId = decodeURIComponent(issuerPath.split('/').at(-1)); } catch {}
  if (!endpointClientId || (clientId && endpointClientId !== clientId)) throw new Error('Cloudflare OIDC 配置端点中的 Client ID 必须与填写的 Client ID 一致。');
  return url;
}
function cloudflareIssuer(configurationUrl) {
  const discovery = validateCloudflareConfigurationUrl(configurationUrl);
  return `${discovery.origin}${discovery.pathname.slice(0, -'/.well-known/openid-configuration'.length)}`;
}
async function fetchOAuthJson(url, options = {}) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(12_000) });
  const length = Number(response.headers.get('content-length') || 0);
  if (length > 1_000_000) throw new Error('OAuth 服务返回内容过大。');
  const text = await response.text();
  if (text.length > 1_000_000) throw new Error('OAuth 服务返回内容过大。');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('OAuth 服务返回格式无效。'); }
  if (!response.ok) throw new Error(`OAuth 服务请求失败（${response.status}）。`);
  return data;
}
async function loadCloudflareOidcMetadata(config) {
  const discoveryUrl = validateCloudflareConfigurationUrl(config.configurationUrl, config.clientId);
  const issuer = cloudflareIssuer(discoveryUrl.toString());
  const metadata = await fetchOAuthJson(discoveryUrl.toString());
  if (metadata.issuer !== issuer) throw new Error('Cloudflare OIDC issuer 与配置端点不匹配。');
  for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
    let endpoint;
    try { endpoint = new URL(metadata[key]); } catch { throw new Error('Cloudflare OIDC 元数据缺少有效端点。'); }
    if (endpoint.protocol !== 'https:' || endpoint.origin !== discoveryUrl.origin || !endpoint.pathname.startsWith(`${discoveryUrl.pathname.slice(0, -'/.well-known/openid-configuration'.length)}/`) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
      throw new Error('Cloudflare OIDC 元数据包含不受信任的端点。');
    }
  }
  return metadata;
}
const oidcJwksCache = new Map();
function remoteJwks(url) {
  const key = new URL(url).toString();
  if (!oidcJwksCache.has(key)) oidcJwksCache.set(key, createRemoteJWKSet(new URL(key), { timeoutDuration: 8000, cooldownDuration: 30_000, cacheMaxAge: 300_000 }));
  return oidcJwksCache.get(key);
}
async function verifyOidcIdToken(token, { issuer, audience, nonce, jwksUrl }) {
  if (typeof token !== 'string' || token.length > 32_000) throw new Error('OAuth 服务未返回有效的 ID token。');
  const { payload } = await jwtVerify(token, remoteJwks(jwksUrl), { issuer, audience, algorithms: ['RS256', 'ES256'], maxTokenAge: '10m', clockTolerance: 5 });
  if (!payload.sub || typeof payload.sub !== 'string' || !constantTimeTextEqual(payload.nonce, nonce)) throw new Error('ID token 的身份或 nonce 校验失败。');
  if (payload.azp && payload.azp !== audience) throw new Error('ID token 的 authorized party 不匹配。');
  return payload;
}
function loginSubjectHash(provider, subject) {
  return crypto.createHmac('sha256', ENCRYPTION_KEY).update(`${provider}\0${subject}`).digest('hex');
}
function saveBoundIdentity(provider, subject, profile) {
  const safeProfile = {
    label: String(profile.label || provider).slice(0, 120),
    email: String(profile.email || '').slice(0, 320)
  };
  db.prepare(`INSERT INTO login_identities (provider,subject_hash,profile,linked_at) VALUES (?,?,?,?)
    ON CONFLICT(provider) DO UPDATE SET subject_hash=excluded.subject_hash,profile=excluded.profile,linked_at=excluded.linked_at`)
    .run(provider, loginSubjectHash(provider, subject), encrypt(safeProfile), Date.now());
}
async function authenticateLoginProvider(provider, code, req, stateRecord, config) {
  const redirectUri = identityCallbackUrl(req, provider);
  if (provider === 'github') {
    const tokenData = await fetchOAuthJson('https://github.com/login/oauth/access_token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: redirectUri })
    });
    if (!tokenData.access_token) throw new Error('GitHub 未返回访问令牌。');
    const user = await fetchOAuthJson('https://api.github.com/user', {
      headers: { authorization: `Bearer ${tokenData.access_token}`, accept: 'application/vnd.github+json', 'user-agent': 'Youhui-Mail-Workbench' }
    });
    if (!user.id) throw new Error('无法验证 GitHub 用户身份。');
    return { subject: String(user.id), label: String(user.name || user.login || 'GitHub'), email: String(user.email || '') };
  }

  let tokenUrl = 'https://oauth2.googleapis.com/token';
  let jwksUrl = 'https://www.googleapis.com/oauth2/v3/certs';
  let issuer = ['https://accounts.google.com', 'accounts.google.com'];
  let tokenFields = { client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: redirectUri, grant_type: 'authorization_code' };
  const tokenHeaders = { 'content-type': 'application/x-www-form-urlencoded' };
  if (provider === 'cloudflare') {
    const metadata = await loadCloudflareOidcMetadata(config);
    tokenUrl = metadata.token_endpoint; jwksUrl = metadata.jwks_uri; issuer = metadata.issuer;
    const methods = Array.isArray(metadata.token_endpoint_auth_methods_supported)
      ? metadata.token_endpoint_auth_methods_supported
      : ['client_secret_basic'];
    tokenFields = { code, redirect_uri: redirectUri, grant_type: 'authorization_code' };
    if (methods.includes('client_secret_basic')) {
      const credentials = `${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`;
      tokenHeaders.authorization = `Basic ${Buffer.from(credentials).toString('base64')}`;
    } else if (methods.includes('client_secret_post')) {
      tokenFields.client_id = config.clientId; tokenFields.client_secret = config.clientSecret;
    } else throw new Error('Cloudflare OIDC token endpoint 未声明支持的客户端密钥认证方式。');
  }
  const tokenData = await fetchOAuthJson(tokenUrl, {
    method: 'POST', headers: tokenHeaders,
    body: new URLSearchParams(tokenFields)
  });
  const claims = await verifyOidcIdToken(tokenData.id_token, { issuer, audience: config.clientId, nonce: stateRecord.nonce, jwksUrl });
  return {
    subject: claims.sub,
    label: String(claims.name || claims.email || provider),
    email: claims.email_verified === true ? String(claims.email || '') : ''
  };
}
function mapAccount(row) {
  return { ...row, credentials: decrypt(row.credentials) };
}
function getAccount(id) {
  const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  if (!row) return null;
  return mapAccount(row);
}
function accountSummary(row) {
  return { id: row.id, label: row.label, email: row.email, provider: row.provider, authType: row.auth_type, createdAt: row.created_at };
}
function makeImap(account, { maxIdleTime } = {}) {
  const credentials = account.credentials;
  const authData = account.auth_type === 'oauth'
    ? { user: account.username, accessToken: credentials.access_token }
    : { user: account.username, pass: credentials.password };
  return new ImapFlow({
    host: account.imap_host, port: account.imap_port, secure: Boolean(account.imap_secure), auth: authData,
    logger: false, socketTimeout: 30000, greetingTimeout: 15000, connectionTimeout: 20000,
    tls: { rejectUnauthorized: true },
    ...(Number.isFinite(maxIdleTime) ? { maxIdleTime } : {})
  });
}
function makeSmtp(account) {
  const credentials = account.credentials;
  const options = { host: account.smtp_host, port: account.smtp_port, secure: Boolean(account.smtp_secure), connectionTimeout: 20000, greetingTimeout: 15000, socketTimeout: 30000, tls: { rejectUnauthorized: true } };
  if (account.auth_type === 'oauth') options.auth = { type: 'OAuth2', user: account.username, accessToken: credentials.access_token };
  else options.auth = { user: account.username, pass: credentials.password };
  if (!Boolean(account.smtp_secure) && Number(account.smtp_port) === 587) options.requireTLS = true;
  return nodemailer.createTransport(options);
}
async function refreshOAuth(account) {
  if (account.auth_type !== 'oauth') return account;
  const creds = account.credentials;
  if (creds.expires_at && creds.expires_at > Date.now() + 60_000) return account;
  const config = oauthProviderConfigFor(account.provider);
  if (!config || !creds.refresh_token) throw new Error('OAuth 授权已失效，请重新连接此邮箱。');
  const body = new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: creds.refresh_token, grant_type: 'refresh_token' });
  const response = await fetch(config.tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) throw new Error('OAuth 令牌刷新失败，请重新连接邮箱。');
  creds.access_token = payload.access_token;
  if (payload.refresh_token) creds.refresh_token = payload.refresh_token;
  creds.expires_at = Date.now() + (payload.expires_in || 3600) * 1000;
  db.prepare('UPDATE accounts SET credentials = ? WHERE id = ?').run(encrypt(creds), account.id);
  account.credentials = creds;
  return account;
}
async function withFreshAccount(account, fn) {
  await refreshOAuth(account);
  return fn(account);
}
// ---------- IMAP 连接复用池 ----------
// 每个账户保留一条空闲连接，列表、详情、操作与通知扫描直接复用，避免每次请求都重建
// TLS + 登录。并发超出时临时开新连接，用完即关；空闲连接由 ImapFlow 的 auto-IDLE 保活
// （autoIdleDelay 默认 15 秒，会被压在 socketTimeout 30 秒之下），超时未使用则主动关闭。
const imapPool = new Map();
const IMAP_POOL_IDLE_MS = 10 * 60_000;
const mailboxListCache = new Map();
const MAILBOX_LIST_TTL_MS = 5 * 60_000;
function closeImapClientQuietly(client) {
  if (!client) return;
  try { client.logout().catch(() => { try { client.close(); } catch {} }); }
  catch { try { client.close(); } catch {} }
}
function evictPooledImap(accountId, client = null) {
  const entry = imapPool.get(accountId);
  if (!entry || (client && entry.client !== client)) return;
  imapPool.delete(accountId);
  clearTimeout(entry.idleTimer);
  closeImapClientQuietly(entry.client);
}
function armImapPoolIdleTimer(entry) {
  clearTimeout(entry.idleTimer);
  entry.idleTimer = setTimeout(() => evictPooledImap(entry.accountId, entry.client), IMAP_POOL_IDLE_MS);
  entry.idleTimer.unref?.();
}
async function acquireImapLease(account) {
  const entry = imapPool.get(account.id);
  if (entry && !entry.busy && entry.client?.usable) {
    clearTimeout(entry.idleTimer);
    entry.busy = true;
    return { accountId: account.id, client: entry.client, pooled: true };
  }
  if (entry && !entry.busy) evictPooledImap(account.id);
  const client = makeImap(account);
  try { await client.connect(); }
  catch (error) { try { client.close(); } catch {} throw error; }
  return { accountId: account.id, client, pooled: false };
}
async function releaseImapLease(lease) {
  const client = lease?.client;
  if (!client) return;
  if (!client.usable) { evictPooledImap(lease.accountId, client); return; }
  if (lease.pooled) {
    const entry = imapPool.get(lease.accountId);
    if (entry && entry.client === client) {
      entry.busy = false;
      armImapPoolIdleTimer(entry);
      return;
    }
    closeImapClientQuietly(client);
    return;
  }
  if (imapPool.has(lease.accountId)) { closeImapClientQuietly(client); return; }
  // 收养为该账户的空闲连接；确保已有打开的邮箱，让 auto-IDLE 持续产生保活流量
  const entry = { accountId: lease.accountId, client, busy: false, idleTimer: null };
  imapPool.set(lease.accountId, entry);
  const evict = () => evictPooledImap(lease.accountId, client);
  client.once('error', evict);
  client.once('close', evict);
  armImapPoolIdleTimer(entry);
  if (!client.mailbox) {
    try { await client.mailboxOpen('INBOX', { readOnly: true }); }
    catch { evictPooledImap(lease.accountId, client); }
  }
}
async function withImapClient(account, fn) {
  return withFreshAccount(account, async (fresh) => {
    const lease = await acquireImapLease(fresh);
    try { return await fn(lease.client); }
    finally { await releaseImapLease(lease); }
  });
}
function safeError(error) {
  const nestedErrors = Array.isArray(error?.errors) ? error.errors : [];
  const details = [error, ...nestedErrors]
    .map((item) => [item?.message, item?.code, item?.responseCode].filter(Boolean).join(' '))
    .filter(Boolean)
    .join(' ');
  const text = details || String(error?.message || '未知错误');
  if (/password|auth|credential|token|invalid login|authentication|oauth|EAUTH/i.test(text)) return '邮箱认证失败。请检查邮箱地址、应用专用密码或 OAuth 授权。';
  if (/certificate|tls|ssl|ETLS/i.test(text)) return '安全连接失败。请核对服务器、端口和 TLS 设置。';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN|ESOCKET|ECONNECTION|timeout|connect/i.test(text)) return '无法连接邮件服务器。请检查服务器地址、端口，以及主机是否允许 SMTP 出站连接。';
  return text.slice(0, 240);
}

async function verifyAccount(account) {
  return withFreshAccount(account, async (fresh) => {
    const imap = makeImap(fresh);
    try {
      await imap.connect();
      await imap.logout();
    } catch (error) { try { await imap.logout(); } catch {} throw new Error(`IMAP 测试失败：${safeError(error)}`); }
    const smtp = makeSmtp(fresh);
    try { await smtp.verify(); } catch (error) { throw new Error(`SMTP 测试失败：${safeError(error)}`); }
    finally { smtp.close(); }
    return true;
  });
}
function normalizeManual(body) {
  const email = String(body.email || '').trim();
  const username = String(body.username || email).trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('请填写有效的邮箱地址。');
  if (!username) throw new Error('请填写登录用户名。');
  const readPort = (value, fallback) => {
    const n = Number(value ?? fallback);
    if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error('端口必须是 1 到 65535 之间的整数。');
    return n;
  };
  const imapHost = String(body.imapHost || '').trim();
  const smtpHost = String(body.smtpHost || '').trim();
  if (!imapHost || !smtpHost || /[\s/]/.test(imapHost) || /[\s/]/.test(smtpHost)) throw new Error('请填写有效的 IMAP 与 SMTP 服务器地址。');
  if (!body.password) throw new Error('请填写邮箱密码或应用专用密码。');
  return {
    id: crypto.randomUUID(), label: String(body.label || email.split('@')[0]).trim().slice(0, 80) || email,
    email, provider: String(body.provider || 'custom').trim().slice(0, 40),
    imap_host: imapHost, imap_port: readPort(body.imapPort, 993), imap_secure: body.imapSecure === false || body.imapSecure === 'false' ? 0 : 1,
    smtp_host: smtpHost, smtp_port: readPort(body.smtpPort, 465), smtp_secure: body.smtpSecure === true || body.smtpSecure === 'true' ? 1 : 0,
    username, auth_type: 'password', credentials: { password: String(body.password) }, created_at: Date.now()
  };
}
function persistAccount(account) {
  db.prepare(`INSERT INTO accounts (id,label,email,provider,imap_host,imap_port,imap_secure,smtp_host,smtp_port,smtp_secure,username,auth_type,credentials,created_at)
    VALUES (@id,@label,@email,@provider,@imap_host,@imap_port,@imap_secure,@smtp_host,@smtp_port,@smtp_secure,@username,@auth_type,@credentials,@created_at)`)
    .run({ ...account, credentials: encrypt(account.credentials) });
  scheduleNotificationSweep(0);
}
function addressList(list = []) {
  return list.map((item) => ({ name: item.name || '', address: item.address || '' })).filter((x) => x.address);
}
async function listMailboxes(account) {
  // 文件夹列表极少变化；短 TTL 缓存可免去每次列表/搜索前的 LIST 往返
  const cached = mailboxListCache.get(account.id);
  if (cached && cached.expiresAt > Date.now()) return cached.folders;
  const folders = await withImapClient(account, (client) => client.list());
  mailboxListCache.set(account.id, { folders, expiresAt: Date.now() + MAILBOX_LIST_TTL_MS });
  return folders;
}
const logicalNames = {
  INBOX: ['inbox'], Sent: ['sent', 'sent items', '已发送', '已发邮件'], Drafts: ['draft', 'drafts', '草稿'],
  Archive: ['archive', 'all mail', '所有邮件', '归档'], Trash: ['trash', 'deleted items', 'deleted messages', '已删除', '垃圾箱'],
  Spam: ['junk', 'spam', 'bulk', '垃圾邮件']
};
const specialUseByKey = { Sent: ['\\Sent'], Drafts: ['\\Drafts'], Archive: ['\\Archive', '\\All'], Trash: ['\\Trash'], Spam: ['\\Junk'] };
function findFolder(mailboxes, key) {
  if (key === 'INBOX') return mailboxes.find((m) => String(m.path).toUpperCase() === 'INBOX')?.path || 'INBOX';
  const special = specialUseByKey[key] || [];
  const matchSpecial = mailboxes.find((m) => special.some((s) => String(m.specialUse || '').toLowerCase() === s.toLowerCase()));
  if (matchSpecial) return matchSpecial.path;
  const names = logicalNames[key] || [];
  return mailboxes.find((m) => names.includes(String(m.name || m.path).split('/').at(-1).toLowerCase()) || names.includes(String(m.path).toLowerCase()))?.path || null;
}
function messageAddress(envelope, field) { return addressList(envelope?.[field] || []); }
function markMailboxSynced(accountId) {
  db.prepare('INSERT INTO app_preferences (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(`mailbox_last_sync:${accountId}`, String(Date.now()));
}
async function fetchMessages(account, folderKey, page, limit, query, { beforeUid = null } = {}) {
  return withImapClient(account, async (client) => {
    const mailboxes = await listMailboxes(account);
    const starredOnly = folderKey === 'Starred';
    if (starredOnly) {
      const allStarred = [];
      let matched = 0;
      for (const mailbox of mailboxes) {
        if (mailbox.flags?.has('\\Noselect')) continue;
        let lock;
        try {
          lock = await client.getMailboxLock(mailbox.path, { readOnly: true });
          let seqs = await client.search({ flagged: true });
          if (!Array.isArray(seqs)) continue;
          if (query) {
            const queryMatches = await client.search({ or: [{ from: query }, { to: query }, { subject: query }, { text: query }] });
            const querySet = new Set(Array.isArray(queryMatches) ? queryMatches : []);
            seqs = seqs.filter((seq) => querySet.has(seq));
          }
          matched += seqs.length;
          if (!seqs.length) continue;
          const fetched = await client.fetchAll(seqs, { uid: true, envelope: true, flags: true, internalDate: true, size: true });
          allStarred.push(...fetched.map((item) => ({
            accountId: account.id, accountEmail: account.email, accountLabel: account.label, uid: item.uid, folder: mailbox.path,
            subject: item.envelope?.subject || '(无主题)', from: messageAddress(item.envelope, 'from'), to: messageAddress(item.envelope, 'to'),
            date: item.internalDate || item.envelope?.date || null, unread: !(item.flags || new Set()).has('\\Seen'),
            flagged: (item.flags || new Set()).has('\\Flagged'), size: item.size || 0
          })));
        } catch (error) { console.warn(`Starred search skipped mailbox ${mailbox.path}: ${safeError(error)}`); }
        finally { lock?.release(); }
      }
      allStarred.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
      const start = (page - 1) * limit;
      markMailboxSynced(account.id);
      // 光标模式（网页版）：只取严格早于 beforeUid 的最新一页，避免翻页间隙新邮件导致重复
      const windowedStarred = beforeUid ? allStarred.filter((item) => Number(item.uid) < beforeUid) : allStarred;
      const starredPage = beforeUid ? windowedStarred.slice(0, limit) : windowedStarred.slice(start, start + limit);
      return { accountId: account.id, path: '*', messages: starredPage, total: matched };
    }
    const knownKeys = ['INBOX', 'Sent', 'Drafts', 'Archive', 'Trash', 'Spam'];
    const pathName = knownKeys.includes(folderKey) ? findFolder(mailboxes, folderKey) : folderKey;
    if (!pathName) return { accountId: account.id, path: null, messages: [], total: 0 };
    const lock = await client.getMailboxLock(pathName, { readOnly: true });
    try {
      let seqs;
      let total;
      if (beforeUid) {
        // 光标模式：取 uid < beforeUid 中最新的一页；total 保持全量口径，保证 UI 计数稳定。
        // search 按 seq 升序返回，末尾 limit 个即对应最大的 uid。
        const queryTerms = query ? { or: [{ from: query }, { to: query }, { subject: query }, { text: query }] } : null;
        if (query) {
          const all = await client.search(queryTerms);
          total = Array.isArray(all) ? all.length : 0;
        } else total = client.mailbox.exists || 0;
        if (beforeUid <= 1) seqs = []; // 游标已到最早；避免向服务器下发非法的 '1:0' 序列区间
        else {
          const windowed = await client.search(queryTerms ? { ...queryTerms, uid: `1:${beforeUid - 1}` } : { uid: `1:${beforeUid - 1}` });
          seqs = Array.isArray(windowed) ? windowed.slice(-limit) : [];
        }
      } else if (query) {
        const queryTerms = { or: [{ from: query }, { to: query }, { subject: query }, { text: query }] };
        seqs = await client.search(queryTerms);
        if (!Array.isArray(seqs)) seqs = [];
        seqs = seqs.slice().reverse();
        total = seqs.length;
      } else {
        total = client.mailbox.exists || 0;
        seqs = total ? Array.from({ length: total }, (_, i) => total - i) : [];
      }
      const matched = total;
      const start = (page - 1) * limit;
      const pageSeqs = beforeUid ? seqs : seqs.slice(start, start + limit);
      if (!pageSeqs.length) return { accountId: account.id, path: pathName, messages: [], total: matched };
      const fetched = await client.fetchAll(pageSeqs.join(','), { uid: true, envelope: true, flags: true, internalDate: true, size: true });
      const messages = fetched.map((item) => ({
        accountId: account.id, accountEmail: account.email, accountLabel: account.label, uid: item.uid, folder: pathName,
        subject: item.envelope?.subject || '(无主题)', from: messageAddress(item.envelope, 'from'), to: messageAddress(item.envelope, 'to'),
        date: item.internalDate || item.envelope?.date || null, unread: !(item.flags || new Set()).has('\\Seen'),
        flagged: (item.flags || new Set()).has('\\Flagged'), size: item.size || 0
      }));
      messages.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
      return { accountId: account.id, path: pathName, messages, total: matched };
    } finally { lock.release(); }
  });
}
const safeInlineImageTypes = new Set(['image/png','image/jpeg','image/gif','image/webp','image/avif','image/bmp']);
function inlineImageData(attachments = []) {
  const images = new Map();
  let totalBytes = 0;
  for (const attachment of attachments) {
    const contentId = normalizeContentId(attachment.contentId);
    const contentType = String(attachment.contentType || '').split(';')[0].trim().toLowerCase();
    const content = Buffer.isBuffer(attachment.content) ? attachment.content : null;
    if (!contentId || !content || !safeInlineImageTypes.has(contentType) || content.length > 2 * 1024 * 1024 || totalBytes + content.length > 6 * 1024 * 1024) continue;
    totalBytes += content.length;
    images.set(contentId, `data:${contentType};base64,${content.toString('base64')}`);
  }
  return images;
}
async function getMailDetail(account, folderKey, uid, { attachmentsMeta = false } = {}) {
  return withImapClient(account, async (client) => {
    const pathName = folderKey || 'INBOX';
    const lock = await client.getMailboxLock(pathName);
    try {
      const item = await client.fetchOne(Number(uid), { uid: true, source: true, envelope: true, flags: true, internalDate: true }, { uid: true });
      if (!item?.source) throw new Error('找不到这封邮件，可能已被移走或删除。');
      try { await client.messageFlagsAdd(Number(uid), ['\\Seen'], { uid: true }); } catch {}
      const parsed = await simpleParser(item.source);
      const inlineImages = inlineImageData(parsed.attachments || []);
      const cleanHtml = parsed.html ? sanitizeEmailHtml(String(parsed.html), inlineImages) : '';
      return {
        accountId: account.id, email: account.email, uid: item.uid, folder: pathName,
        subject: parsed.subject || item.envelope?.subject || '(无主题)', from: (parsed.from?.value || messageAddress(item.envelope, 'from')),
        to: parsed.to?.value || messageAddress(item.envelope, 'to'), cc: parsed.cc?.value || messageAddress(item.envelope, 'cc'),
        date: parsed.date || item.internalDate || null, text: parsed.text || '', html: cleanHtml,
        messageId: parsed.messageId || '', inReplyTo: parsed.inReplyTo || '', references: parsed.references || '',
        attachments: (parsed.attachments || []).map((a, index) => ({
          index, filename: a.filename || 'attachment', contentType: a.contentType || 'application/octet-stream',
          size: a.size || a.content?.length || 0, contentId: a.contentId || '',
          inline: safeInlineImageTypes.has(String(a.contentType || '').split(';')[0].trim().toLowerCase()),
          ...(attachmentsMeta ? {} : { content: a.content?.toString('base64') || '' })
        }))
      };
    } finally { lock.release(); }
  });
}
async function getMailAttachment(account, folderKey, uid, index) {
  // v1：整封读入内存后取指定附件；后续可升级为 IMAP partial fetch 流式抓取
  return withImapClient(account, async (client) => {
    const pathName = folderKey || 'INBOX';
    const lock = await client.getMailboxLock(pathName);
    try {
      const item = await client.fetchOne(Number(uid), { uid: true, source: true }, { uid: true });
      if (!item?.source) throw new Error('找不到这封邮件，可能已被移走或删除。');
      const parsed = await simpleParser(item.source);
      const attachment = (parsed.attachments || [])[index];
      if (!attachment?.content) throw new Error('附件不存在或已被移除。');
      return attachment;
    } finally { lock.release(); }
  });
}
async function mutateMessage(account, folder, uid, action) {
  return withImapClient(account, async (client) => {
    const mailboxes = await listMailboxes(account);
    const lock = await client.getMailboxLock(folder || 'INBOX');
    try {
      const id = Number(uid);
      if (!Number.isInteger(id) || id < 1) throw new Error('邮件编号无效。');
      if (action === 'read') await client.messageFlagsAdd(id, ['\\Seen'], { uid: true });
      else if (action === 'unread') await client.messageFlagsRemove(id, ['\\Seen'], { uid: true });
      else if (action === 'star') await client.messageFlagsAdd(id, ['\\Flagged'], { uid: true });
      else if (action === 'unstar') await client.messageFlagsRemove(id, ['\\Flagged'], { uid: true });
      else if (action === 'archive' || action === 'delete') {
        const dest = findFolder(mailboxes, action === 'archive' ? 'Archive' : 'Trash');
        if (dest && dest !== folder) await client.messageMove(id, dest, { uid: true });
        else if (action === 'delete') await client.messageFlagsAdd(id, ['\\Deleted'], { uid: true });
        else throw new Error('此邮箱没有可识别的归档文件夹。');
      } else throw new Error('不支持此邮件操作。');
      return { ok: true };
    } finally { lock.release(); }
  });
}
function getStatus(req) {
  const setupRequired = !db.prepare('SELECT id FROM app_config WHERE id = 1').get();
  const token = cookieValue(req, 'youhui_session');
  const valid = token && db.prepare('SELECT 1 FROM sessions WHERE token_hash = ? AND expires_at > ?').get(hash(token), Date.now());
  return { setupRequired, authenticated: Boolean(valid), oauthProviders: publicOAuthProviders(), identityProviders: publicIdentityProviders() };
}
function publicOAuthConfigStatus(req) {
  const config = getOAuthClientConfig();
  const status = (item, callback) => ({ configured: Boolean(item.clientId && item.clientSecret), clientIdSet: Boolean(item.clientId), clientSecretSet: Boolean(item.clientSecret), callbackUrl: callback });
  const mailbox = Object.fromEntries(['google', 'microsoft'].map((provider) => [provider, status(config.mailbox[provider], callbackUrl(req, provider))]));
  const login = Object.fromEntries(loginOAuthProviders.map((provider) => {
    const item = config.login[provider];
    const identity = boundIdentity(provider);
    return [provider, {
      configured: Boolean(item.clientId && item.clientSecret && (provider !== 'cloudflare' || item.configurationUrl)),
      clientIdSet: Boolean(item.clientId), clientSecretSet: Boolean(item.clientSecret),
      configurationUrlSet: provider === 'cloudflare' ? Boolean(item.configurationUrl) : undefined,
      callbackUrl: identityCallbackUrl(req, provider), bound: Boolean(identity),
      label: identity?.label || '', email: identity?.email || '', linkedAt: identity?.linkedAt || null
    }];
  }));
  return { mailbox, login };
}
app.get('/api/status', (req, res) => res.json(getStatus(req)));
app.get('/api/oauth/config', auth, (req, res) => res.json(publicOAuthConfigStatus(req)));
app.put('/api/oauth/config', auth, (req, res) => {
  try {
    const current = getOAuthClientConfig();
    const submitted = req.body || {};
    const next = normalizeOAuthClientConfig(current);
    for (const section of ['mailbox', 'login']) {
      const providers = section === 'mailbox' ? ['google', 'microsoft'] : ['google', 'github', 'cloudflare'];
      for (const provider of providers) {
        const incoming = submitted[section]?.[provider] || {};
        const target = next[section][provider];
        const idName = section === 'login' && provider === 'cloudflare' ? 'clientId' : 'clientId';
        const clientId = String(incoming[idName] || '').trim();
        const clientSecret = String(incoming.clientSecret || '');
        if (clientId.length > 500 || clientSecret.length > 4096) return res.status(400).json({ error: 'OAuth 客户端 ID 或密钥长度超出限制。' });
        if (clientId) target.clientId = clientId;
        if (clientSecret) target.clientSecret = clientSecret;
        if (section === 'login' && provider === 'cloudflare') {
          const configurationUrl = String(incoming.configurationUrl || '').trim();
          if (configurationUrl.length > 1000) return res.status(400).json({ error: 'Cloudflare OIDC 配置端点过长。' });
          if (configurationUrl) target.configurationUrl = validateCloudflareConfigurationUrl(configurationUrl, target.clientId).toString();
          if (target.configurationUrl) validateCloudflareConfigurationUrl(target.configurationUrl, target.clientId);
        }
      }
    }
    saveOAuthClientConfig(next);
    res.json(publicOAuthConfigStatus(req));
  } catch (error) { res.status(400).json({ error: safeError(error) }); }
});
app.post('/api/setup', (req, res) => {
  if (db.prepare('SELECT id FROM app_config WHERE id = 1').get()) return res.status(409).json({ error: '首次设置已完成，请解锁。' });
  const password = String(req.body?.password || '');
  if (password.length < 12) return res.status(400).json({ error: '为保护邮箱，请设置至少 12 位的工作台密码。' });
  db.prepare('INSERT INTO app_config (id,password_hash) VALUES (1,?)').run(hashPassword(password));
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = Date.now() + 30 * 24 * 60 * 60_000;
  db.prepare('INSERT INTO sessions (token_hash,expires_at) VALUES (?,?)').run(hash(token), expires);
  setSessionCookie(res, req, token);
  res.json({ ok: true });
});
app.post('/api/login', (req, res) => {
  if (!attemptAllowed(req)) return res.status(429).json({ error: '尝试次数过多，请 15 分钟后再试。' });
  const row = db.prepare('SELECT password_hash FROM app_config WHERE id = 1').get();
  if (!row) return res.status(409).json({ error: '请先完成首次设置。' });
  const password = String(req.body?.password || '');
  if (!verifyPassword(password, row.password_hash)) return res.status(401).json({ error: '密码不正确。' });
  loginAttempts.delete(req.ip || 'unknown');
  rehashPasswordIfLegacy(row.password_hash, password);
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash,expires_at) VALUES (?,?)').run(hash(token), Date.now() + 30 * 24 * 60 * 60_000);
  setSessionCookie(res, req, token);
  res.json({ ok: true });
});
app.post('/api/logout', auth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionHash);
  clearSessionCookie(res, req); clearOAuthFlowCookie(res, req); res.json({ ok: true });
});
app.delete('/api/identity/:provider', auth, (req, res) => {
  const provider = String(req.params.provider);
  if (!loginOAuthProviders.includes(provider)) return res.status(404).json({ error: '不支持此登录方式。' });
  db.prepare('DELETE FROM login_identities WHERE provider = ?').run(provider);
  res.json(publicOAuthConfigStatus(req));
});

// ---------- 移动端（原生 App）令牌会话 ----------
const mobileDeviceIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function cleanDeviceLabel(value) { return String(value || '').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 80); }
function isMobileRedirectUri(value) {
  // RFC 8252 §7.3：仅允许本机回环 http 与 App 私有 scheme，拒绝远程地址防授权码被劫持
  try {
    const url = new URL(String(value || ''));
    if (url.protocol === 'http:' && !url.username && !url.password) {
      const host = url.hostname;
      return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1';
    }
    return url.protocol === 'com.youhui.mail:';
  } catch { return false; }
}
function insertMobileSession(deviceId, deviceLabel) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = Date.now() + 30 * 24 * 60 * 60_000;
  db.prepare(`INSERT INTO sessions (token_hash,expires_at,kind,device_id,device_label,created_at,last_seen_at)
    VALUES (?,?,?,?,?,?,?)`).run(hash(token), expires, 'mobile', deviceId, deviceLabel, Date.now(), Date.now());
  return { token, expiresAt: expires, session: { deviceId, deviceLabel, kind: 'mobile' } };
}
app.post('/api/mobile/login', (req, res) => {
  if (!attemptAllowed(req)) return res.status(429).json({ error: '尝试次数过多，请 15 分钟后再试。' });
  const row = db.prepare('SELECT password_hash FROM app_config WHERE id = 1').get();
  if (!row) return res.status(409).json({ error: '请先完成首次设置。' });
  const password = String(req.body?.password || '');
  if (!verifyPassword(password, row.password_hash)) return res.status(401).json({ error: '密码不正确。' });
  const deviceId = String(req.body?.deviceId || '').trim();
  if (!mobileDeviceIdPattern.test(deviceId)) return res.status(400).json({ error: '设备标识无效。' });
  loginAttempts.delete(req.ip || 'unknown');
  rehashPasswordIfLegacy(row.password_hash, password);
  res.json(insertMobileSession(deviceId, cleanDeviceLabel(req.body?.deviceLabel)));
});
app.get('/api/mobile/sessions', auth, (req, res) => {
  const rows = db.prepare(`SELECT device_id, device_label, created_at, last_seen_at, expires_at FROM sessions
    WHERE kind = 'mobile' AND expires_at > ? ORDER BY created_at DESC`).all(Date.now());
  res.json({ sessions: rows.map((row) => ({ deviceId: row.device_id, deviceLabel: row.device_label, createdAt: row.created_at, lastSeenAt: row.last_seen_at, expiresAt: row.expires_at })) });
});
app.delete('/api/mobile/sessions/:deviceId', auth, (req, res) => {
  const deviceId = String(req.params.deviceId || '').trim();
  if (!mobileDeviceIdPattern.test(deviceId)) return res.status(400).json({ error: '设备标识无效。' });
  db.prepare(`DELETE FROM sessions WHERE kind = 'mobile' AND device_id = ?`).run(deviceId);
  res.json({ ok: true });
});
function getDefaultAccountId() {
  const saved = db.prepare('SELECT value FROM app_preferences WHERE key = ?').get('default_account_id')?.value || '';
  if (saved && !db.prepare('SELECT 1 FROM accounts WHERE id = ?').get(saved)) {
    db.prepare('DELETE FROM app_preferences WHERE key = ?').run('default_account_id');
    return '';
  }
  return saved;
}
const notificationIntervals = new Set([120, 300, 600]);
function getNotificationConfig() {
  const stored = db.prepare('SELECT value FROM app_preferences WHERE key = ?').get('notification_config')?.value;
  const saved = stored ? decrypt(stored) : {};
  return {
    enabled: saved.enabled !== false,
    intervalSeconds: notificationIntervals.has(Number(saved.intervalSeconds)) ? Number(saved.intervalSeconds) : 120,
    webhookEnabled: saved.webhookEnabled === true,
    webhookUrl: String(saved.webhookUrl || ''),
    webhookSecret: String(saved.webhookSecret || ''),
    pushProvider: saved.pushProvider === 'wxpusher' ? 'wxpusher' : 'webhook',
    wxpusherEnabled: saved.wxpusherEnabled === true,
    wxpusherAppToken: String(saved.wxpusherAppToken || ''),
    wxpusherUids: String(saved.wxpusherUids || ''),
    wxpusherTopicIds: String(saved.wxpusherTopicIds || '')
  };
}
function publicNotificationConfig(config = getNotificationConfig()) {
  return {
    enabled: config.enabled,
    intervalSeconds: config.intervalSeconds,
    webhookEnabled: config.webhookEnabled,
    webhookConfigured: Boolean(config.webhookUrl),
    webhookSecretConfigured: Boolean(config.webhookSecret),
    pushProvider: config.pushProvider,
    wxpusherEnabled: config.wxpusherEnabled,
    wxpusherAppTokenConfigured: Boolean(config.wxpusherAppToken),
    wxpusherUids: config.wxpusherUids,
    wxpusherTopicIds: config.wxpusherTopicIds
  };
}
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const FCM_TOKEN_AUDIENCE = 'https://oauth2.googleapis.com/token';
let fcmAccessTokenCache = null;
function readFcmServiceAccount() {
  let raw = String(process.env.FCM_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    try { raw = fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8').trim(); }
    catch { throw new Error('无法读取 FCM 服务账号文件。'); }
  }
  if (!raw) return null;
  let account;
  try { account = JSON.parse(raw); }
  catch { throw new Error('FCM 服务账号 JSON 格式无效。'); }
  const projectId = String(account?.project_id || '');
  const clientEmail = String(account?.client_email || '');
  const privateKey = String(account?.private_key || '').replace(/\\n/g, '\n');
  if (account?.type !== 'service_account' || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)
      || !/^[^\s@]+@[^\s@]+$/.test(clientEmail) || !privateKey.includes('BEGIN PRIVATE KEY')) {
    throw new Error('FCM 服务账号缺少有效的项目 ID、客户端邮箱或私钥。');
  }
  return { projectId, clientEmail, privateKey };
}
async function getFcmAccessToken() {
  const account = readFcmServiceAccount();
  if (!account) throw new Error('FCM 服务账号尚未配置。');
  const keyFingerprint = hash(`${account.projectId}\n${account.clientEmail}\n${account.privateKey}`);
  if (fcmAccessTokenCache?.fingerprint === keyFingerprint && fcmAccessTokenCache.expiresAt > Date.now() + 60_000) {
    return { projectId: account.projectId, accessToken: fcmAccessTokenCache.accessToken };
  }
  const now = Math.floor(Date.now() / 1000);
  const key = await importPKCS8(account.privateKey, 'RS256');
  const assertion = await new SignJWT({ scope: FCM_SCOPE })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(account.clientEmail)
    .setSubject(account.clientEmail)
    .setAudience(FCM_TOKEN_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
  const response = await fetch(FCM_TOKEN_AUDIENCE, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    signal: AbortSignal.timeout(10_000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.access_token) throw new Error(`FCM OAuth token request failed (${response.status}).`);
  const expiresIn = Math.max(60, Number(result.expires_in) || 3600);
  fcmAccessTokenCache = { fingerprint: keyFingerprint, accessToken: result.access_token, expiresAt: Date.now() + expiresIn * 1000 };
  return { projectId: account.projectId, accessToken: result.access_token };
}
async function sendFcmWake(token) {
  const { projectId, accessToken } = await getFcmAccessToken();
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ message: { token, data: { type: 'mail.new' }, android: { priority: 'HIGH', ttl: '3600s' } } }),
    signal: AbortSignal.timeout(10_000)
  });
  if (response.ok) return;
  const result = await response.json().catch(() => ({}));
  const status = String(result?.error?.status || '');
  const detailCode = (result?.error?.details || []).map((item) => String(item?.errorCode || '')).find(Boolean) || '';
  if (detailCode === 'UNREGISTERED' || (response.status === 404 && status === 'NOT_FOUND')) {
    const error = new Error('FCM registration is no longer valid.');
    error.unregistered = true;
    throw error;
  }
  throw new Error(`FCM message request failed (${response.status}${status ? ` ${status}` : ''}).`);
}
async function validateWebhookUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { throw new Error('Webhook 地址格式无效。'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash || url.href.length > 2048) {
    throw new Error('Webhook 仅支持有效的 HTTPS 地址，不可包含用户名、密码或片段。');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) throw new Error('Webhook 主机必须是公网 HTTPS 地址。');
  let addresses;
  try { addresses = await validatedAddresses(host); }
  catch { throw new Error('Webhook 主机必须解析到公网 IP 地址。'); }
  return { url, addresses };
}
function isWecomWebhook(url) {
  return url.hostname.toLowerCase() === 'qyapi.weixin.qq.com' && url.pathname === '/cgi-bin/webhook/send';
}
function webhookPayload(url, payload) {
  if (!isWecomWebhook(url)) return payload;
  const clean = (value) => String(value || '').replace(/<@/g, '＜@').replace(/[\r\n]+/g, ' ').trim();
  const lines = payload.test ? ['邮汇 Webhook 测试通知', '这是一条测试通知，不代表真实新邮件。'] : [
    '邮汇新邮件通知',
    `邮箱：${clean(payload.account?.email || payload.account?.label) || '未知'}`,
    `发件人：${clean(payload.sender?.name)} ${clean(payload.sender?.email)}`.trim(),
    `主题：${clean(payload.subject) || '（无主题）'}`,
    ...(payload.verificationCode ? [`验证码：${clean(payload.verificationCode)}`] : []),
    ...(payload.receivedAt ? [`时间：${clean(payload.receivedAt)}`] : [])
  ];
  let content = '';
  for (const character of lines.join('\n')) {
    if (Buffer.byteLength(content + character, 'utf8') > 2048) break;
    content += character;
  }
  return { msgtype:'text', text:{ content } };
}
function webhookFailureMessage(error) {
  const status = Number(error?.webhookStatus);
  const wecomCode = Number(error?.wecomCode);
  if (Number.isInteger(wecomCode) && wecomCode !== 0) return `企业微信拒绝了测试通知（错误码 ${wecomCode}），请检查机器人地址、权限和安全设置。`;
  if (Number.isInteger(status) && status >= 100 && status <= 599) return `接收端返回 HTTP ${status}，请检查 Webhook 地址和接收端配置。`;
  if (error?.code === 'ENOTFOUND' || error?.code === 'EAI_AGAIN') return '无法解析 Webhook 域名，请检查地址和服务器 DNS。';
  if (error?.code === 'ETIMEDOUT' || error?.code === 'WEBHOOK_TIMEOUT') return '连接 Webhook 超时，请检查服务器网络及接收端。';
  if (error?.code === 'WEBHOOK_INVALID_RESPONSE') return '企业微信的响应格式异常，请检查机器人地址和服务状态。';
  if (error?.code && /CERT|TLS|SSL/i.test(error.code)) return 'Webhook 的 HTTPS 证书验证失败，请检查接收端证书。';
  return '测试通知未送达，请检查已保存的 Webhook 地址与接收端服务。';
}
function parseWxPusherTargets(value, kind) {
  const items = String(value || '').split(/[\s,，;；]+/).map((item) => item.trim()).filter(Boolean);
  if (kind === 'topicIds') {
    if (items.some((item) => !/^\d+$/.test(item) || !Number.isSafeInteger(Number(item)) || Number(item) <= 0)) throw new Error('WxPusher Topic ID 须为正整数，可用逗号或空格分隔。');
    const unique = [...new Set(items.map(Number))];
    if (unique.length > 5) throw new Error('WxPusher Topic ID 最多支持 5 个。');
    return unique;
  }
  if (items.some((item) => item.length > 256 || /[\r\n]/.test(item))) throw new Error('WxPusher UID 格式无效。');
  const unique = [...new Set(items)];
  if (unique.length > 2000) throw new Error('WxPusher UID 最多支持 2000 个。');
  return unique;
}
function wxPusherText(payload) {
  const clean = (value, max = 300) => String(value || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
  if (payload.test) return `邮汇 WxPusher 测试通知\n这是一条测试通知，不代表真实新邮件。\n时间：${clean(payload.receivedAt || payload.occurredAt, 80)}`;
  const sender = [clean(payload.sender?.name, 120), clean(payload.sender?.email, 254)].filter(Boolean).join(' ');
  const lines = [
    '邮汇新邮件通知',
    `邮箱：${clean(payload.account?.email || payload.account?.label, 320) || '未知'}`,
    `发件人：${sender || '未知'}`,
    `主题：${clean(payload.subject, 240) || '（无主题）'}`,
    `时间：${clean(payload.receivedAt || payload.occurredAt, 80) || '未知'}`,
    ...(payload.verificationCode ? [`验证码：${clean(payload.verificationCode, 32)}`] : [])
  ];
  return lines.join('\n').slice(0, 4000);
}
function sendWxPusher(config, payload) {
  const uids = parseWxPusherTargets(config.wxpusherUids, 'uids');
  const topicIds = parseWxPusherTargets(config.wxpusherTopicIds, 'topicIds');
  if (!config.wxpusherAppToken || (!uids.length && !topicIds.length)) throw new Error('请配置 WxPusher AppToken，以及至少一个 UID 或 Topic ID。');
  const body = JSON.stringify({ appToken:config.wxpusherAppToken, content:wxPusherText(payload), contentType:1, ...(uids.length ? { uids } : {}), ...(topicIds.length ? { topicIds } : {}) });
  return new Promise((resolve, reject) => {
    const request = https.request('https://wxpusher.zjiecode.com/api/send/message', {
      method:'POST', headers:{ 'content-type':'application/json; charset=utf-8', 'content-length':Buffer.byteLength(body), 'user-agent':'Youhui-Mail-WxPusher/1.0' },
      // An explicit ordinary Agent avoids Node 22+ globalAgent proxyEnv from --use-env-proxy.
      agent:new https.Agent({ keepAlive:false, rejectUnauthorized:true, proxyEnv:null }), rejectUnauthorized:true
    }, (response) => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { responseBody += chunk; if (Buffer.byteLength(responseBody) > 65536) response.destroy(Object.assign(new Error('invalid response'), { code:'WXPUSHER_INVALID_RESPONSE' })); });
      response.on('error', reject);
      response.on('end', () => {
        let result;
        try { result = JSON.parse(responseBody); } catch { reject(Object.assign(new Error('invalid JSON'), { code:'WXPUSHER_INVALID_RESPONSE' })); return; }
        if (response.statusCode < 200 || response.statusCode >= 300) { const error = new Error('WxPusher HTTP error'); error.webhookStatus = response.statusCode; reject(error); return; }
        if (Number(result?.code) !== 1000) { const error = new Error('WxPusher rejected task'); error.wxCode = result?.code; reject(error); return; }
        const targets = Array.isArray(result.data) ? result.data : [];
        const failed = targets.filter((item) => Number(item?.code) !== 1000);
        if (failed.length || targets.length === 0) { const error = new Error('WxPusher target acceptance incomplete'); error.wxTargetFailures = failed.length; error.wxTargetTotal = targets.length; reject(error); return; }
        // API code 1000/target codes indicate task acceptance, not end-user delivery.
        resolve({ accepted:true, targets });
      });
    });
    request.setTimeout(8000, () => request.destroy(Object.assign(new Error('timeout'), { code:'WEBHOOK_TIMEOUT' })));
    request.on('error', reject); request.end(body);
  });
}
function deliverWebhook(url, addresses, payload, secret) {
  return new Promise((resolve, reject) => {
    const wecom = isWecomWebhook(url);
    const body = JSON.stringify(webhookPayload(url, payload));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers = { 'content-type':'application/json; charset=utf-8', 'content-length':Buffer.byteLength(body), 'user-agent':'Youhui-Mail-Webhook/1.0', 'x-youhui-event':String(payload.event || 'mail.new'), 'x-youhui-delivery':String(payload.eventId), 'x-youhui-timestamp':timestamp };
    if (secret) headers['x-youhui-signature'] = `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
    // The process-wide proxy is restricted to Google OAuth. Webhooks must use
    // their validated, pinned public addresses directly instead.
    const requestOptions = { method:'POST', headers, lookup:makePinnedLookup(addresses), rejectUnauthorized:true, agent:false };
    if (!net.isIP(url.hostname.replace(/^\[|\]$/g, ''))) requestOptions.servername = url.hostname;
    const request = https.request(url, requestOptions, (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        const error = new Error(`HTTP ${response.statusCode || 0}`); error.webhookStatus = response.statusCode; reject(error); return;
      }
      if (!wecom) { response.resume(); resolve(); return; }
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        responseBody += chunk;
        if (Buffer.byteLength(responseBody, 'utf8') > 65536) response.destroy(Object.assign(new Error('invalid response'), { code:'WEBHOOK_INVALID_RESPONSE' }));
      });
      response.on('error', reject);
      response.on('end', () => {
        try {
          const result = JSON.parse(responseBody);
          if (!Number.isInteger(result.errcode)) throw new Error('invalid response');
          if (result.errcode !== 0) { const error = new Error(`WeCom error ${result.errcode}`); error.wecomCode = result.errcode; reject(error); return; }
          resolve();
        } catch { reject(Object.assign(new Error('invalid response'), { code:'WEBHOOK_INVALID_RESPONSE' })); }
      });
    });
    request.setTimeout(8000, () => request.destroy(Object.assign(new Error('timeout'), { code:'WEBHOOK_TIMEOUT' })));
    request.on('error', reject);
    request.end(body);
  });
}
function eventPayload(account, item, uid, code) {
  const from = messageAddress(item.envelope, 'from')[0] || { name:'', address:'' };
  const subject = String(item.envelope?.subject || '(无主题)').replace(/[\r\n]+/g, ' ').slice(0, 240);
  const receivedAtValue = item.internalDate || item.envelope?.date || new Date();
  const receivedAt = new Date(receivedAtValue).toISOString();
  return {
    event:'mail.new', eventId:0, occurredAt:new Date().toISOString(),
    account:{ label:String(account.label || '').slice(0,80), email:String(account.email || '').slice(0,254) },
    sender:{ name:String(from.name || '').replace(/[\r\n]+/g,' ').slice(0,120), email:String(from.address || '').slice(0,254) },
    subject, receivedAt, verificationCode:code || null,
    summary:code ? `验证码：${code}` : subject
  };
}
function hasActivePushDevice() {
  return Boolean(db.prepare(`SELECT 1 FROM push_devices d JOIN sessions s ON s.token_hash=d.session_hash
    WHERE s.expires_at>? LIMIT 1`).get(Date.now()));
}
async function scanAccountForNotifications(account, config) {
  return withImapClient(account, async (client) => {
    const lock = await client.getMailboxLock('INBOX', { readOnly: true });
    try {
        const mailbox = client.mailbox || {};
        const validity = String(mailbox.uidValidity || '');
        const highest = Math.max(0, Number(mailbox.uidNext || 1) - 1);
        const checkpoint = db.prepare('SELECT uid_validity, highest_uid FROM notification_checkpoints WHERE account_id = ?').get(account.id);
        if (!checkpoint || checkpoint.uid_validity !== validity) {
          db.prepare(`INSERT INTO notification_checkpoints (account_id,uid_validity,highest_uid,updated_at) VALUES (?,?,?,?)
            ON CONFLICT(account_id) DO UPDATE SET uid_validity=excluded.uid_validity, highest_uid=excluded.highest_uid, updated_at=excluded.updated_at`).run(account.id, validity, highest, Date.now());
          return 0;
        }
        const last = Number(checkpoint.highest_uid);
        if (!validity || highest <= last) return 0;
        const end = Math.min(highest, last + 50);
        const fetched = await client.fetchAll(`${last + 1}:${end}`, { uid:true, envelope:true, internalDate:true, size:true }, { uid:true });
        const insertEvent = db.prepare(`INSERT OR IGNORE INTO notification_events
          (account_id,message_uid,uid_validity,folder,payload,created_at,webhook_pending,webhook_next_attempt_at,fcm_pending,fcm_next_attempt_at)
          VALUES (?,?,?,'INBOX',?,?,?,?,?,?)`);
        const updatePayload = db.prepare('UPDATE notification_events SET payload = ? WHERE id = ?');
        let count = 0;
        for (const item of fetched) {
          const uid = Number(item.uid);
          if (!uid || !item.envelope) continue;
          let code = extractVerificationCode(item.envelope.subject || '');
          if (!code && Number(item.size || 0) > 0 && Number(item.size || 0) <= 128 * 1024) {
            try {
              const full = await client.fetchOne(uid, { source:true }, { uid:true });
              if (full?.source) {
                const parsed = await simpleParser(full.source);
                code = extractVerificationCode(`${parsed.subject || ''}\n${String(parsed.text || '').slice(0,12000)}`);
              }
            } catch { /* code extraction is best-effort; never block ordinary mail alerts */ }
          }
          const payload = eventPayload(account, item, uid, code);
          const now = Date.now();
          const result = insertEvent.run(account.id, uid, validity, encrypt(payload), now,
            config.pushProvider === 'webhook' && config.webhookEnabled && config.webhookUrl ? 1 : 0,
            now, hasActivePushDevice() ? 1 : 0, now);
          if (result.changes) {
            const eventId = Number(result.lastInsertRowid);
            payload.eventId = eventId;
            updatePayload.run(encrypt(payload), eventId);
            if (config.pushProvider === 'wxpusher' && config.wxpusherEnabled && config.wxpusherAppToken && (config.wxpusherUids || config.wxpusherTopicIds)) {
              db.prepare('UPDATE notification_events SET wxpusher_pending=1, wxpusher_next_attempt_at=? WHERE id=?').run(now, eventId);
            }
            count += 1;
          }
        }
        db.prepare('UPDATE notification_checkpoints SET highest_uid = ?, updated_at = ? WHERE account_id = ?').run(end, Date.now(), account.id);
        return count;
    } finally { lock.release(); }
  });
}
const notificationIdleMonitors = new Map();
// IDLE 收到新邮件时的定向扫描：3 秒去抖合并连发事件，只扫来源账户，不做全量 sweep
const targetedScanTimers = new Map();
let targetedScanRunning = false;
function scheduleTargetedScan(accountId) {
  if (targetedScanTimers.has(accountId)) return;
  const timer = setTimeout(() => {
    targetedScanTimers.delete(accountId);
    void runTargetedScan(accountId);
  }, 3000);
  targetedScanTimers.set(accountId, timer);
  timer.unref?.();
}
function cancelTargetedScan(accountId) {
  clearTimeout(targetedScanTimers.get(accountId));
  targetedScanTimers.delete(accountId);
}
async function runTargetedScan(accountId) {
  if (targetedScanRunning) { scheduleNotificationSweep(0); return; }
  targetedScanRunning = true;
  try {
    const config = getNotificationConfig();
    if (config.enabled) {
      const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
      if (row) await scanAccountForNotifications(mapAccount(row), config);
      await deliverPendingWebhooks(config);
      await deliverPendingWxPusher(config);
      await deliverPendingFcm(config);
    }
  } catch (error) { console.warn(`Targeted new-mail scan failed for account ${accountId}:`, safeError(error)); }
  finally { targetedScanRunning = false; }
}
function mailboxStatus(accountId) {
  const lastSync = db.prepare('SELECT value FROM app_preferences WHERE key = ?').get(`mailbox_last_sync:${accountId}`)?.value;
  const monitor = notificationIdleMonitors.get(accountId);
  return {
    idleStatus: monitor?.status || 'disabled',
    idleConnectedAt: monitor?.lastConnectedAt || null,
    reconnectAt: monitor?.reconnectAt || null,
    reconnectError: monitor?.reconnectError || '',
    reconnectAttempts: monitor?.failures || 0,
    lastSyncAt: lastSync && Number.isFinite(Number(lastSync)) ? Number(lastSync) : null
  };
}
const notificationIdleRenewMs = 25 * 60_000;
const notificationIdleReconnectBaseMs = 5_000;
const notificationIdleReconnectMaxMs = 5 * 60_000;
const notificationIdleStableMs = 5 * 60_000;
function stopNotificationIdle(accountId) {
  const monitor = notificationIdleMonitors.get(accountId);
  if (!monitor) return;
  monitor.stopped = true;
  notificationIdleMonitors.delete(accountId);
  clearTimeout(monitor.reconnectTimer);
  monitor.reconnectTimer = null;
  const client = monitor.client;
  monitor.client = null;
  if (client) { try { client.close(); } catch {} }
}
function scheduleNotificationIdleReconnect(monitor, client, generation, error) {
  if (notificationIdleMonitors.get(monitor.accountId) !== monitor || monitor.stopped || monitor.generation !== generation || monitor.client !== client || monitor.reconnectTimer) return;
  if (monitor.connectedAt && Date.now() - monitor.connectedAt >= notificationIdleStableMs) monitor.failures = 0;
  monitor.connectedAt = 0;
  monitor.client = null;
  monitor.status = 'reconnecting';
  monitor.reconnectError = error ? safeError(error) : (monitor.reconnectError || 'IMAP 连接已关闭。');
  const delay = Math.min(notificationIdleReconnectBaseMs * (2 ** monitor.failures), notificationIdleReconnectMaxMs);
  monitor.failures += 1;
  monitor.reconnectAt = Date.now() + delay;
  if (error) console.warn(`IMAP IDLE reconnect for account ${monitor.accountId} in ${delay}ms: ${safeError(error)}`);
  if (client) { try { client.close(); } catch {} }
  monitor.reconnectTimer = setTimeout(() => {
    monitor.reconnectTimer = null;
    void connectNotificationIdle(monitor);
  }, delay);
  monitor.reconnectTimer.unref?.();
}
async function connectNotificationIdle(monitor) {
  if (notificationIdleMonitors.get(monitor.accountId) !== monitor || monitor.stopped || monitor.reconnectTimer) return;
  monitor.status = 'connecting';
  monitor.reconnectAt = 0;
  const generation = ++monitor.generation;
  let client = null;
  try {
    const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(monitor.accountId);
    if (!row) { stopNotificationIdle(monitor.accountId); return; }
    const account = mapAccount(row);
    await withFreshAccount(account, async (fresh) => {
      if (notificationIdleMonitors.get(monitor.accountId) !== monitor || monitor.stopped || monitor.generation !== generation) return;
      client = makeImap(fresh, { maxIdleTime: notificationIdleRenewMs });
      monitor.client = client;
      client.on('exists', (event) => {
        if (monitor.client === client && String(event?.path || '').toUpperCase() === 'INBOX') scheduleTargetedScan(monitor.accountId);
      });
      client.on('error', (error) => scheduleNotificationIdleReconnect(monitor, client, generation, error));
      client.on('close', () => scheduleNotificationIdleReconnect(monitor, client, generation));
      await client.connect();
      if (notificationIdleMonitors.get(monitor.accountId) !== monitor || monitor.stopped || monitor.generation !== generation) { try { client.close(); } catch {} return; }
      await client.mailboxOpen('INBOX', { readOnly: true });
      if (notificationIdleMonitors.get(monitor.accountId) === monitor && !monitor.stopped && monitor.generation === generation) {
        monitor.connectedAt = Date.now();
        monitor.lastConnectedAt = monitor.connectedAt;
        monitor.status = 'connected';
        monitor.reconnectError = '';
        console.log(`IMAP IDLE monitoring enabled for account ${monitor.accountId}`);
      }
    });
  } catch (error) {
    scheduleNotificationIdleReconnect(monitor, client, generation, error);
  }
}
function reconcileNotificationIdles(config) {
  const monitored = config.enabled ? db.prepare('SELECT id FROM accounts ORDER BY created_at').all() : [];
  const activeIds = new Set(monitored.map((row) => row.id));
  for (const accountId of notificationIdleMonitors.keys()) if (!activeIds.has(accountId)) stopNotificationIdle(accountId);
  for (const row of monitored) {
    if (notificationIdleMonitors.has(row.id)) continue;
    const monitor = { accountId: row.id, client: null, generation: 0, failures: 0, connectedAt: 0, lastConnectedAt: 0, status: 'connecting', reconnectError: '', reconnectAt: 0, reconnectTimer: null, stopped: false };
    notificationIdleMonitors.set(row.id, monitor);
    void connectNotificationIdle(monitor);
  }
}
async function deliverPendingWebhooks(config) {
  if (config.pushProvider !== 'webhook' || !config.webhookEnabled || !config.webhookUrl) return;
  const due = db.prepare(`SELECT id,payload,webhook_attempts FROM notification_events WHERE webhook_pending=1 AND webhook_abandoned=0 AND webhook_next_attempt_at<=? ORDER BY id LIMIT 5`).all(Date.now());
  for (const row of due) {
    let attempt = Number(row.webhook_attempts) + 1;
    try {
      const { url, addresses } = await validateWebhookUrl(config.webhookUrl);
      const payload = decrypt(row.payload); payload.eventId = row.id;
      await deliverWebhook(url, addresses, payload, config.webhookSecret);
      db.prepare('UPDATE notification_events SET webhook_pending=0, webhook_attempts=?, webhook_delivered_at=? WHERE id=?').run(attempt, Date.now(), row.id);
    } catch (error) {
      const abandoned = attempt >= 4 ? 1 : 0;
      const next = Date.now() + Math.min(15, 2 ** attempt) * 60_000;
      db.prepare('UPDATE notification_events SET webhook_attempts=?, webhook_next_attempt_at=?, webhook_abandoned=? WHERE id=?').run(attempt, next, abandoned, row.id);
      console.warn(`Webhook delivery ${row.id} ${abandoned ? 'abandoned' : 'will retry'}: ${String(error?.message || 'failed').slice(0,80)}`);
    }
  }
}
async function deliverPendingWxPusher(config) {
  if (config.pushProvider !== 'wxpusher' || !config.wxpusherEnabled || !config.wxpusherAppToken) return;
  const due = db.prepare('SELECT id,payload,wxpusher_attempts FROM notification_events WHERE wxpusher_pending=1 AND wxpusher_abandoned=0 AND wxpusher_next_attempt_at<=? ORDER BY id LIMIT 5').all(Date.now());
  for (const row of due) {
    const attempt = Number(row.wxpusher_attempts) + 1;
    try {
      const payload = decrypt(row.payload); payload.eventId = row.id;
      await sendWxPusher(config, payload);
      db.prepare('UPDATE notification_events SET wxpusher_pending=0, wxpusher_attempts=?, wxpusher_delivered_at=NULL WHERE id=?').run(attempt, row.id);
    } catch (error) {
      // Batch API results and network failures can be ambiguous: never resend accepted targets.
      db.prepare('UPDATE notification_events SET wxpusher_pending=0, wxpusher_attempts=?, wxpusher_abandoned=1, wxpusher_delivered_at=NULL WHERE id=?').run(attempt, row.id);
      const summary = Number.isFinite(error?.wxTargetFailures)
        ? `partial/unknown target acceptance (${error.wxTargetFailures}/${error.wxTargetTotal})`
        : 'acceptance unknown or rejected';
      console.warn(`WxPusher delivery ${row.id} stopped without retry: ${summary}`);
    }
  }
}
async function deliverPendingFcm(config) {
  if (!config.enabled) return;
  try { if (!readFcmServiceAccount()) return; }
  catch { console.warn('FCM delivery paused because the service-account configuration is invalid.'); return; }
  const due = db.prepare(`SELECT id,fcm_attempts FROM notification_events WHERE fcm_pending=1 AND fcm_abandoned=0 AND fcm_next_attempt_at<=? ORDER BY id LIMIT 5`).all(Date.now());
  for (const row of due) {
    const devices = db.prepare(`SELECT d.device_id,d.token_hash,d.token_encrypted FROM push_devices d
      JOIN sessions s ON s.token_hash=d.session_hash WHERE s.expires_at>? ORDER BY d.created_at`).all(Date.now());
    const attempt = Number(row.fcm_attempts) + 1;
    if (!devices.length) {
      db.prepare('UPDATE notification_events SET fcm_pending=0,fcm_attempts=?,fcm_abandoned=1 WHERE id=?').run(attempt, row.id);
      continue;
    }
    let failures = 0;
    for (const device of devices) {
      let token;
      try { token = String(decrypt(device.token_encrypted)?.token || ''); }
      catch {
        db.prepare('DELETE FROM push_devices WHERE device_id=? AND token_hash=?').run(device.device_id, device.token_hash);
        continue;
      }
      try { await sendFcmWake(token); }
      catch (error) {
        if (error?.unregistered) {
          db.prepare('DELETE FROM push_devices WHERE device_id=? AND token_hash=?').run(device.device_id, device.token_hash);
        } else {
          failures += 1;
        }
      }
    }
    if (!failures) {
      db.prepare('UPDATE notification_events SET fcm_pending=0,fcm_attempts=?,fcm_delivered_at=? WHERE id=?').run(attempt, Date.now(), row.id);
      continue;
    }
    const abandoned = attempt >= 4 ? 1 : 0;
    const next = Date.now() + Math.min(15, 2 ** attempt) * 60_000;
    db.prepare('UPDATE notification_events SET fcm_attempts=?,fcm_next_attempt_at=?,fcm_abandoned=? WHERE id=?').run(attempt, next, abandoned, row.id);
    console.warn(`FCM delivery ${row.id} ${abandoned ? 'abandoned' : 'will retry'} after transient failure.`);
  }
}
function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  return Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try { results[index] = await worker(items[index]); }
      catch (error) { results[index] = error; }
    }
  })).then(() => results);
}
let notificationSweepTimer = null;
let notificationSweepRunning = false;
let notificationSweepRequested = false;
function scheduleNotificationSweep(delay = 120_000) {
  if (notificationSweepRunning) { notificationSweepRequested = true; return; }
  clearTimeout(notificationSweepTimer);
  notificationSweepTimer = setTimeout(async () => {
    notificationSweepTimer = null;
    if (notificationSweepRunning) { notificationSweepRequested = true; return; }
    notificationSweepRunning = true;
    try {
      const config = getNotificationConfig();
      reconcileNotificationIdles(config);
      pruneExpiredAuthRows();
      if (config.enabled) {
        db.prepare('DELETE FROM notification_events WHERE created_at < ?').run(Date.now() - 7 * 24 * 60 * 60_000);
        const accounts = db.prepare('SELECT * FROM accounts ORDER BY created_at').all().map(mapAccount);
        // 多账户受控并行扫描（并发度 3）；单账户内部保持串行，避免连接风暴
        await mapWithConcurrency(accounts, 3, async (account) => {
          try { await scanAccountForNotifications(account, config); }
          catch (error) { console.warn(`New-mail notification scan skipped for account ${account.id}: ${safeError(error)}`); }
        });
        await deliverPendingWebhooks(config);
        await deliverPendingWxPusher(config);
        await deliverPendingFcm(config);
      }
    } catch (error) { console.warn('New-mail notification sweep failed:', safeError(error)); }
    finally {
      notificationSweepRunning = false;
      const rerun = notificationSweepRequested;
      notificationSweepRequested = false;
      const config = getNotificationConfig();
      scheduleNotificationSweep(rerun ? 0 : config.enabled ? config.intervalSeconds * 1000 : 10 * 60_000);
    }
  }, Math.max(0, delay));
  notificationSweepTimer.unref?.();
}
app.get('/api/accounts', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM accounts ORDER BY created_at').all();
  res.json({ accounts: rows.map((row) => ({ ...accountSummary(row), mailStatus: mailboxStatus(row.id) })), oauthProviders: publicOAuthProviders(), defaultAccountId: getDefaultAccountId() });
});
app.put('/api/preferences/default-account', auth, (req, res) => {
  const accountId = String(req.body?.accountId || '').trim();
  if (accountId && !db.prepare('SELECT 1 FROM accounts WHERE id = ?').get(accountId)) {
    return res.status(400).json({ error: '请选择一个已连接的邮箱账户。' });
  }
  db.prepare(`INSERT INTO app_preferences (key, value) VALUES ('default_account_id', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(accountId);
  scheduleNotificationSweep(0);
  res.json({ defaultAccountId: accountId });
});
app.get('/api/notifications/config', auth, (req, res) => res.json(publicNotificationConfig()));
app.put('/api/notifications/config', auth, async (req, res) => {
  try {
    const previous = getNotificationConfig();
    const pushProvider = req.body?.pushProvider === undefined ? previous.pushProvider : String(req.body.pushProvider);
    if (!['webhook', 'wxpusher'].includes(pushProvider)) return res.status(400).json({ error:'推送类型须为 webhook 或 wxpusher。' });
    const enabled = req.body?.enabled === undefined ? previous.enabled : req.body.enabled !== false;
    const intervalSeconds = req.body?.intervalSeconds === undefined ? previous.intervalSeconds : Number(req.body.intervalSeconds);
    if (!notificationIntervals.has(intervalSeconds)) return res.status(400).json({ error:'请选择支持的检查间隔。' });
    const webhookEnabled = req.body?.webhookEnabled === undefined ? previous.webhookEnabled : req.body.webhookEnabled === true;
    const submittedUrl = String(req.body?.webhookUrl || '').trim();
    const webhookUrl = submittedUrl || previous.webhookUrl;
    const submittedSecret = String(req.body?.webhookSecret || '').trim();
    if (submittedSecret.length > 4096) return res.status(400).json({ error:'Webhook 签名密钥不能超过 4096 个字符。' });
    const webhookSecret = submittedSecret || previous.webhookSecret;
    const wxpusherEnabled = req.body?.wxpusherEnabled === undefined ? previous.wxpusherEnabled : req.body.wxpusherEnabled === true;
    const submittedAppToken = String(req.body?.wxpusherAppToken || '').trim();
    if (submittedAppToken.length > 4096) return res.status(400).json({ error:'WxPusher AppToken 不能超过 4096 个字符。' });
    const wxpusherAppToken = submittedAppToken || previous.wxpusherAppToken;
    const wxpusherUids = req.body?.wxpusherUids === undefined ? previous.wxpusherUids : String(req.body.wxpusherUids || '').trim();
    const wxpusherTopicIds = req.body?.wxpusherTopicIds === undefined ? previous.wxpusherTopicIds : String(req.body.wxpusherTopicIds || '').trim();
    if (wxpusherUids.length > 10000 || wxpusherTopicIds.length > 10000) return res.status(400).json({ error:'WxPusher 接收目标内容过长。' });
    parseWxPusherTargets(wxpusherUids, 'uids');
    parseWxPusherTargets(wxpusherTopicIds, 'topicIds');
    if (webhookEnabled && !webhookUrl) return res.status(400).json({ error:'启用 Webhook 前，请填写 Webhook HTTPS 地址。' });
    if (submittedUrl) await validateWebhookUrl(submittedUrl);
    if (wxpusherEnabled && (!wxpusherAppToken || (!wxpusherUids && !wxpusherTopicIds))) return res.status(400).json({ error:'启用 WxPusher 前，请填写 AppToken 及至少一个 UID 或 Topic ID。' });
    const config = { ...previous, enabled, intervalSeconds, webhookEnabled, webhookUrl, webhookSecret, pushProvider, wxpusherEnabled, wxpusherAppToken, wxpusherUids, wxpusherTopicIds };
    db.prepare(`INSERT INTO app_preferences (key,value) VALUES ('notification_config',?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(encrypt(config));
    if ((previous.webhookEnabled && !webhookEnabled) || (previous.enabled && !enabled)) {
      db.prepare('UPDATE notification_events SET webhook_pending=0,webhook_abandoned=1 WHERE webhook_pending=1').run();
    }
    if ((previous.wxpusherEnabled && (!wxpusherEnabled || previous.wxpusherUids !== wxpusherUids || previous.wxpusherTopicIds !== wxpusherTopicIds || previous.wxpusherAppToken !== wxpusherAppToken)) || (previous.enabled && !enabled)) {
      db.prepare('UPDATE notification_events SET wxpusher_pending=0,wxpusher_abandoned=1 WHERE wxpusher_pending=1').run();
    }
    if (previous.enabled && !enabled) {
      db.prepare('UPDATE notification_events SET fcm_pending=0,fcm_abandoned=1 WHERE fcm_pending=1').run();
    }
    if (previous.pushProvider !== pushProvider) {
      db.prepare('UPDATE notification_events SET webhook_pending=0,webhook_abandoned=1 WHERE webhook_pending=1').run();
      db.prepare('UPDATE notification_events SET wxpusher_pending=0,wxpusher_abandoned=1 WHERE wxpusher_pending=1').run();
    }
    scheduleNotificationSweep(0);
    res.json(publicNotificationConfig(config));
  } catch (error) { res.status(400).json({ error:safeError(error) }); }
});
app.post('/api/notifications/wxpusher/test', auth, async (req, res) => {
  const config = getNotificationConfig();
  if (!config.wxpusherAppToken) return res.status(400).json({ error:'请先保存 WxPusher AppToken，再进行测试。' });
  try {
    const now = new Date().toISOString();
    const result = await sendWxPusher(config, {
      test:true, event:'wxpusher.test', occurredAt:now, receivedAt:now,
      account:{ label:'邮汇工作台测试', email:'' }, sender:{ name:'邮汇工作台', email:'' },
      subject:'WxPusher 测试通知', verificationCode:null
    });
    res.json({ ok:true, accepted:true, code:1000, targetResults:result.targets, message:'WxPusher 已接受推送任务；这不代表最终送达。' });
  } catch (error) {
    const partial = Number(error?.wxTargetFailures) > 0;
    res.status(502).json({ error:partial ? `WxPusher 对部分目标的受理结果不完整（${error.wxTargetFailures}/${error.wxTargetTotal} 个目标报告失败）；为避免重复，本次不自动重试。` : 'WxPusher 推送任务受理失败或结果不确定；为避免重复，本次不自动重试。', ...(Number.isFinite(error?.wxTargetFailures) ? { targetFailures:error.wxTargetFailures, targetTotal:error.wxTargetTotal } : {}) });
  }
});
app.post('/api/notifications/webhook/test', auth, async (req, res) => {
  const config = getNotificationConfig();
  if (!config.webhookUrl) return res.status(400).json({ error:'请先保存 Webhook 地址，再进行测试。' });
  try {
    const { url, addresses } = await validateWebhookUrl(config.webhookUrl);
    const now = new Date().toISOString();
    const payload = {
      event:'webhook.test', eventId:`test-${crypto.randomUUID()}`, occurredAt:now, test:true,
      account:{ label:'邮汇工作台测试', email:'' }, sender:{ name:'邮汇工作台', email:'' },
      subject:'Webhook 测试通知', receivedAt:now, verificationCode:null,
      summary:'这是一条测试通知，不代表真实新邮件。'
    };
    await deliverWebhook(url, addresses, payload, config.webhookSecret);
    res.json({ ok:true, message:'测试通知已成功发送。' });
  } catch (error) {
    res.status(502).json({ error:webhookFailureMessage(error) });
  }
});
app.delete('/api/notifications/webhook', auth, (req, res) => {
  const config = getNotificationConfig();
  config.webhookEnabled = false; config.webhookUrl = ''; config.webhookSecret = '';
  db.prepare(`INSERT INTO app_preferences (key,value) VALUES ('notification_config',?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(encrypt(config));
  db.prepare('UPDATE notification_events SET webhook_pending=0,webhook_abandoned=1 WHERE webhook_pending=1').run();
  scheduleNotificationSweep(0);
  res.json(publicNotificationConfig(config));
});
app.post('/api/push/devices', auth, async (req, res) => {
  const deviceId = String(req.body?.deviceId || '').trim();
  const token = String(req.body?.token || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceId)) {
    return res.status(400).json({ error: '设备标识无效。' });
  }
  if (!token || token.length > 4096 || /[\r\n]/.test(token)) return res.status(400).json({ error: 'FCM 设备令牌无效。' });
  try {
    await getFcmAccessToken();
  } catch {
    return res.status(503).json({ error: 'FCM 服务端尚未配置或授权失败，请检查服务账号配置。' });
  }
  const tokenHash = hash(token);
  const now = Date.now();
  try {
    const register = db.transaction(() => {
      const cursor = Number(db.prepare('SELECT COALESCE(MAX(id),0) AS cursor FROM notification_events').get().cursor);
      db.prepare('DELETE FROM push_devices WHERE token_hash=? AND device_id<>?').run(tokenHash, deviceId);
      db.prepare(`INSERT INTO push_devices (device_id,session_hash,token_hash,token_encrypted,created_at,updated_at)
        VALUES (?,?,?,?,?,?) ON CONFLICT(device_id) DO UPDATE SET session_hash=excluded.session_hash,
        token_hash=excluded.token_hash,token_encrypted=excluded.token_encrypted,updated_at=excluded.updated_at`)
        .run(deviceId, req.sessionHash, tokenHash, encrypt({ token }), now, now);
      return cursor;
    });
    const cursor = register.immediate();
    scheduleNotificationSweep(0);
    res.json({ ok: true, cursor });
  } catch {
    res.status(500).json({ error: '无法保存此设备的推送登记。' });
  }
});
app.delete('/api/push/devices/:deviceId', auth, (req, res) => {
  const deviceId = String(req.params.deviceId || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceId)) {
    return res.status(400).json({ error: '设备标识无效。' });
  }
  db.prepare('DELETE FROM push_devices WHERE device_id=? AND session_hash=?').run(deviceId, req.sessionHash);
  scheduleNotificationSweep(0);
  res.json({ ok: true });
});
app.get('/api/notifications/events', auth, (req, res) => {
  const afterValue = req.query.after;
  const maximum = Number(db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM notification_events').get().id);
  if (afterValue === undefined) return res.json({ events:[], cursor:maximum, defaultAccountId:getDefaultAccountId() });
  const after = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Number.parseInt(String(afterValue), 10) || 0));
  const defaultId = getDefaultAccountId();
  const rows = db.prepare(`SELECT id,payload FROM notification_events WHERE id>? AND created_at>? ORDER BY id LIMIT 50`).all(after, Date.now()-3*24*60*60_000);
  const cursor = rows.length ? Number(rows.at(-1).id) : maximum;
  res.json({ events:rows.map((row) => ({ id:Number(row.id), ...decrypt(row.payload) })), cursor, defaultAccountId:defaultId });
});
function backupTableNames(database) {
  return database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name);
}
function backupTableColumns(database, tableName) {
  const quoted = `"${String(tableName).replaceAll('"', '""')}"`;
  return database.prepare(`PRAGMA table_info(${quoted})`).all().map((column) => ({ name: column.name, type: column.type, notnull: column.notnull, pk: column.pk }));
}
function verifyBackupDatabase(database, key) {
  const integrity = database.pragma('integrity_check');
  if (integrity.length !== 1 || Object.values(integrity[0])[0] !== 'ok') throw new Error('备份数据库完整性检查失败。');
  const required = ['accounts', 'app_config', 'app_preferences', 'ai_config', 'translation_config', 'ai_digests', 'ai_digest_runs'];
  const sourceTables = backupTableNames(database);
  if (required.some((table) => !sourceTables.includes(table)) || !database.prepare('SELECT id FROM app_config WHERE id = 1').get()) {
    throw new Error('备份文件与当前邮汇版本不兼容或未完成首次设置。');
  }
  const foreignKeyErrors = database.pragma('foreign_key_check');
  if (foreignKeyErrors.length) throw new Error('备份数据库的关联完整性检查失败。');
  for (const row of database.prepare('SELECT credentials FROM accounts').all()) decryptWithKey(row.credentials, key);
  for (const row of database.prepare("SELECT value FROM app_preferences WHERE key IN ('oauth_client_config','notification_config')").all()) decryptWithKey(row.value, key);
  for (const row of database.prepare('SELECT profile FROM login_identities').all()) decryptWithKey(row.profile, key);
  for (const row of database.prepare('SELECT payload FROM notification_events').all()) decryptWithKey(row.payload, key);
  for (const row of database.prepare('SELECT config FROM ai_config').all()) decryptWithKey(row.config, key);
  for (const row of database.prepare('SELECT config FROM translation_config').all()) decryptWithKey(row.config, key);
  for (const row of database.prepare('SELECT payload FROM ai_digests').all()) decryptWithKey(row.payload, key);
  return sourceTables;
}
async function exportBackup(req, res, encrypted, passphrase) {
  const temporaryDirectory = fs.mkdtempSync(path.join(DATA_DIR, '.backup-export-'));
  const snapshotPath = path.join(temporaryDirectory, 'mail.sqlite');
  try {
    await db.backup(snapshotPath);
    const snapshot = new Database(snapshotPath);
    try {
      snapshot.transaction(() => {
        snapshot.exec('DELETE FROM sessions; DELETE FROM oauth_states; DELETE FROM identity_oauth_states;');
        snapshot.exec('DELETE FROM push_devices; DELETE FROM ai_digest_runs; UPDATE notification_events SET webhook_pending=0,webhook_abandoned=1 WHERE webhook_pending=1; UPDATE notification_events SET wxpusher_pending=0,wxpusher_abandoned=1 WHERE wxpusher_pending=1; UPDATE notification_events SET fcm_pending=0,fcm_abandoned=1 WHERE fcm_pending=1;');
        snapshot.prepare('DELETE FROM app_preferences WHERE key = ?').run('__system_restore_tx');
      })();
    } finally { snapshot.close(); }
    const snapshotSize = fs.statSync(snapshotPath).size;
    if (snapshotSize > BACKUP_MAX_BYTES - 8192) return res.status(413).json({ error: '数据库超过 250 MB，暂时无法通过浏览器导出。' });
    const filename = `youhui-backup-${new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)}${encrypted ? '-encrypted' : ''}.yhbackup`;
    // 明文直接流式发送；加密路径先流式加密到临时文件，避免把整库读进内存
    let bodyPath = snapshotPath;
    let bodySize = snapshotSize;
    let header;
    if (encrypted) {
      // 加密导出必须保持旧格式：密文内容是完整明文备份（magic + 头 + 数据库字节），
      // 恢复端解密后会先按明文备份结构校验。先流式组装明文文件，再整体流式加密。
      const plainHeader = Buffer.from(JSON.stringify({ version: 1, createdAt: new Date().toISOString(), encryptionKey: ENCRYPTION_KEY.toString('base64'), databaseBytes: snapshotSize, databaseSha256: await fileSha256Hex(snapshotPath) }), 'utf8');
      const plainPath = path.join(temporaryDirectory, 'backup.plain');
      const plainPrefix = Buffer.concat([BACKUP_MAGIC, plainHeader, Buffer.from('\n')]);
      await pipeline(
        fs.createReadStream(snapshotPath),
        async function* (source) {
          yield plainPrefix;
          for await (const chunk of source) yield chunk;
        },
        fs.createWriteStream(plainPath, { mode: 0o600 })
      );
      fs.chmodSync(plainPath, 0o600);
      const result = await encryptBackupFileStreaming(plainPath, path.join(temporaryDirectory, 'backup.enc'), passphrase);
      header = result.header;
      bodyPath = result.ciphertextPath;
      bodySize = Number(JSON.parse(header.toString('utf8')).ciphertextBytes);
    } else {
      header = Buffer.from(JSON.stringify({ version: 1, createdAt: new Date().toISOString(), encryptionKey: ENCRYPTION_KEY.toString('base64'), databaseBytes: snapshotSize, databaseSha256: await fileSha256Hex(snapshotPath) }), 'utf8');
    }
    const prefix = Buffer.concat([encrypted ? BACKUP_ENCRYPTED_MAGIC : BACKUP_MAGIC, header, Buffer.from('\n')]);
    res.setHeader('Content-Type', 'application/vnd.youhui-mail.backup');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(prefix.length + bodySize));
    res.setHeader('X-Backup-Encrypted', encrypted ? 'true' : 'false');
    res.setHeader('Cache-Control', 'no-store, private, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.write(prefix);
    await pipeline(fs.createReadStream(bodyPath), res);
  } catch (error) {
    if (!res.headersSent) res.status(500).json({ error: '无法生成备份，请稍后重试。' });
  } finally {
    try { fs.rmSync(temporaryDirectory, { recursive: true, force: true }); } catch {}
  }
}
app.get('/api/backup/export', auth, (req, res) => exportBackup(req, res, false, ''));
app.post('/api/backup/export', auth, (req, res) => {
  const encrypted = req.body?.encrypted === true;
  const passphrase = String(req.body?.passphrase || '');
  if (encrypted && (passphrase.length < 12 || passphrase.length > 1024)) return res.status(400).json({ error: '加密备份密码须为 12 到 1024 个字符。' });
  return exportBackup(req, res, encrypted, passphrase);
});
app.post('/api/backup/restore', auth, express.raw({ type: 'application/octet-stream', limit: '250mb' }), (req, res) => {
  let temporaryDirectory = '';
  let pendingWritten = false;
  let restoreCommitted = false;
  try {
    const encodedPassphrase = String(req.get('x-backup-passphrase') || '');
    let passphrase = '';
    try { passphrase = decodeURIComponent(encodedPassphrase); }
    catch { return res.status(400).json({ error: '加密备份密码编码无效。' }); }
    const { key: restoredKey, databaseBytes } = parseBackupFile(req.body, passphrase);
    temporaryDirectory = fs.mkdtempSync(path.join(DATA_DIR, '.backup-restore-'));
    const candidatePath = path.join(temporaryDirectory, 'mail.sqlite');
    writePrivateFile(candidatePath, databaseBytes);
    const candidate = new Database(candidatePath, { readonly: true, fileMustExist: true });
    let sourceTables;
    let restoreSourceColumns = new Map();
    const destinationTables = backupTableNames(db);
    // 会话/临时状态类表在恢复时只清空、不拷贝内容（导出时也会清空），
    // 其列结构会随版本演进，因此豁免"缺失"与"列结构"严格比对，保证旧备份可恢复。
    const transientTables = new Set(['sessions', 'oauth_states', 'identity_oauth_states', 'ai_digest_runs', 'push_devices', 'mobile_oauth_codes']);
    try {
      sourceTables = verifyBackupDatabase(candidate, restoredKey);
      const missingTables = destinationTables.filter((table) => !sourceTables.includes(table) && !transientTables.has(table));
      const extraTables = sourceTables.filter((table) => !destinationTables.includes(table));
      if (missingTables.length || extraTables.length) throw new Error('备份文件与当前邮汇版本的数据库结构不一致。');
      for (const tableName of destinationTables) {
        if (!sourceTables.includes(tableName) || transientTables.has(tableName)) continue;
        if (tableName !== 'notification_events' && JSON.stringify(backupTableColumns(db, tableName)) !== JSON.stringify(backupTableColumns(candidate, tableName))) {
          throw new Error('备份文件的数据库结构与当前版本不兼容。');
        }
        if (tableName === 'notification_events') {
          const sourceColumns = backupTableColumns(candidate, tableName);
          restoreSourceColumns.set(tableName, sourceColumns);
          const destinationColumns = new Set(backupTableColumns(db, tableName).map((column) => column.name));
          for (const column of ['id','account_id','message_uid','uid_validity','folder','payload','created_at']) {
            if (!sourceColumns.some((item) => item.name === column) || !destinationColumns.has(column)) throw new Error('备份文件的通知事件表缺少必要字段。');
          }
        }
      }
    }
    finally { candidate.close(); }
    const transactionId = crypto.randomUUID();
    writePrivateFile(RESTORE_PENDING_PATH, JSON.stringify({ id: transactionId, oldKey: ENCRYPTION_KEY.toString('base64'), newKey: restoredKey.toString('base64') }));
    pendingWritten = true;
    restoreInProgress = true;
    db.prepare('ATTACH DATABASE ? AS restore_source').run(candidatePath);
    const quote = (name) => `"${String(name).replaceAll('"', '""')}"`;
    try {
      db.transaction(() => {
        for (const tableName of destinationTables) db.exec(`DELETE FROM main.${quote(tableName)}`);
        for (const tableName of destinationTables) {
          if (transientTables.has(tableName) || !sourceTables.includes(tableName)) continue;
          const destinationColumns = backupTableColumns(db, tableName);
          const sourceNames = new Set((restoreSourceColumns.get(tableName) || []).map((column) => column.name));
          const columns = (tableName === 'notification_events'
            ? destinationColumns.filter((column) => sourceNames.has(column.name))
            : destinationColumns).map((column) => quote(column.name)).join(',');
          const filter = tableName === 'app_preferences' ? " WHERE key <> '__system_restore_tx'" : '';
          db.exec(`INSERT INTO main.${quote(tableName)} (${columns}) SELECT ${columns} FROM restore_source.${quote(tableName)}${filter}`);
        }
        db.prepare('UPDATE main.notification_events SET webhook_pending=0,webhook_abandoned=1 WHERE webhook_pending=1').run();
        db.prepare('UPDATE main.notification_events SET wxpusher_pending=0,wxpusher_abandoned=1 WHERE wxpusher_pending=1').run();
        db.prepare('UPDATE main.notification_events SET fcm_pending=0,fcm_abandoned=1 WHERE fcm_pending=1').run();
        db.prepare('INSERT INTO main.app_preferences (key,value) VALUES (?,?)').run('__system_restore_tx', transactionId);
      }).immediate();
      restoreCommitted = true;
    } finally {
      try { db.prepare('DETACH DATABASE restore_source').run(); } catch {}
    }
    ENCRYPTION_KEY = restoredKey;
    let keySaved = false;
    try { writePrivateFile(KEY_PATH, restoredKey); keySaved = true; } catch {}
    if (keySaved) {
      try { fs.rmSync(RESTORE_PENDING_PATH, { force: true }); } catch {}
      try { db.prepare('DELETE FROM app_preferences WHERE key = ?').run('__system_restore_tx'); } catch {}
    }
    clearSessionCookie(res, req);
    res.setHeader('Cache-Control', 'no-store, private, max-age=0');
    res.json({ ok: true, message: '备份已恢复，所有登录会话已退出。请使用该备份创建时的工作台密码重新登录。' });
  } catch (error) {
    if (!restoreCommitted && pendingWritten) {
      try { fs.rmSync(RESTORE_PENDING_PATH, { force: true }); } catch {}
    }
    if (!res.headersSent) res.status(400).json({ error: error instanceof Error ? error.message : '备份文件无法恢复。' });
  } finally {
    restoreInProgress = false;
    if (temporaryDirectory) { try { fs.rmSync(temporaryDirectory, { recursive: true, force: true }); } catch {} }
  }
});
app.get('/api/presets', auth, (req, res) => res.json({ presets }));
app.post('/api/accounts/test', auth, async (req, res) => {
  try { const account = normalizeManual(req.body || {}); await verifyAccount(account); res.json({ ok: true, message: 'IMAP 收信与 SMTP 发信连接均已验证。' }); }
  catch (error) { res.status(400).json({ error: safeError(error) }); }
});
app.post('/api/accounts', auth, async (req, res) => {
  try {
    const account = normalizeManual(req.body || {});
    await verifyAccount(account);
    persistAccount(account);
    res.status(201).json({ account: accountSummary(account), message: '邮箱已安全连接。' });
  } catch (error) { res.status(400).json({ error: safeError(error) }); }
});
app.delete('/api/accounts/:id', auth, (req, res) => {
  const result = db.prepare('DELETE FROM accounts WHERE id = ?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: '找不到此邮箱账户。' });
  stopNotificationIdle(req.params.id);
  cancelTargetedScan(req.params.id);
  evictPooledImap(req.params.id);
  mailboxListCache.delete(req.params.id);
  db.prepare('DELETE FROM app_preferences WHERE key = ? AND value = ?').run('default_account_id', req.params.id);
  db.prepare('DELETE FROM notification_checkpoints WHERE account_id=?').run(req.params.id);
  db.prepare('DELETE FROM notification_events WHERE account_id=?').run(req.params.id);
  scheduleNotificationSweep(0);
  res.json({ ok: true });
});
app.get('/api/folders', auth, async (req, res) => {
  try {
    const accounts = db.prepare('SELECT * FROM accounts ORDER BY created_at').all().map(mapAccount);
    const rows = await Promise.all(accounts.map(async (account) => {
      try {
        const list = await listMailboxes(account);
        return list.map((m) => ({ accountId: account.id, accountEmail: account.email, path: m.path, name: m.name || m.path, specialUse: m.specialUse || '' }));
      } catch { return []; }
    }));
    res.json({ folders: rows.flat() });
  } catch (error) { res.status(500).json({ error: safeError(error) }); }
});
app.get('/api/mail', auth, async (req, res) => {
  const folder = String(req.query.folder || 'INBOX').slice(0, 200);
  const accountFilter = String(req.query.accountId || 'all');
  const query = String(req.query.q || '').trim().slice(0, 200);
  const page = Math.max(1, Math.min(1000, Number(req.query.page) || 1));
  const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 30));
  // beforeUid 既支持全局数字游标（单账户语义），也支持按账户的 JSON 对象游标
  // {"<accountId>": <uid>}——多账户合并视图下各账户 UID 空间互不相干，必须分别续页
  const beforeUidRaw = String(req.query.beforeUid || '').trim();
  let beforeUids = null;
  if (beforeUidRaw) {
    const parseOne = (value) => {
      const num = Number(value);
      return Number.isSafeInteger(num) && num > 0 ? num : null;
    };
    if (beforeUidRaw.charCodeAt(0) === 0x7b) { // '{'
      try {
        const parsed = JSON.parse(beforeUidRaw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const map = new Map();
          for (const [id, value] of Object.entries(parsed)) {
            const num = parseOne(value);
            if (num && id) map.set(String(id).slice(0, 200), num);
          }
          if (map.size) beforeUids = map;
        }
      } catch { beforeUids = null; }
    } else {
      const num = parseOne(beforeUidRaw);
      if (num) beforeUids = num;
    }
  }
  try {
    let accounts = db.prepare('SELECT * FROM accounts ORDER BY created_at').all().map(mapAccount);
    if (accountFilter !== 'all') accounts = accounts.filter((a) => a.id === accountFilter);
    const results = await Promise.all(accounts.map(async (account) => {
      const accountBefore = typeof beforeUids === 'number' ? beforeUids : beforeUids instanceof Map ? (beforeUids.get(account.id) || null) : null;
      try { return await fetchMessages(account, folder, page, limit, query, { beforeUid: accountBefore }); }
      catch (error) { return { accountId: account.id, path: null, messages: [], total: 0, error: safeError(error) }; }
    }));
    const messages = results.flatMap((result) => result.messages).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    const hasMore = results.some((result) => result.messages.length >= limit);
    res.json({ messages, total: results.reduce((sum, r) => sum + r.total, 0), hasMore, page, limit, folder, errors: results.filter((r) => r.error).map((r) => ({ accountId: r.accountId, error: r.error })) });
  } catch (error) { res.status(500).json({ error: safeError(error) }); }
});
app.get('/api/message/:accountId/:uid', auth, async (req, res) => {
  try {
    const account = getAccount(req.params.accountId);
    if (!account) return res.status(404).json({ error: '找不到此邮箱账户。' });
    // attachments=meta：只返回附件元数据（移动端），省略时保持网页版 base64 内联行为
    const attachmentsMeta = String(req.query.attachments || '') === 'meta';
    res.json(await getMailDetail(account, String(req.query.folder || 'INBOX').slice(0, 200), req.params.uid, { attachmentsMeta }));
  } catch (error) { res.status(400).json({ error: safeError(error) }); }
});
app.get('/api/message/:accountId/:uid/attachment/:index', auth, async (req, res) => {
  try {
    const account = getAccount(req.params.accountId);
    if (!account) return res.status(404).json({ error: '找不到此邮箱账户。' });
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0 || index > 99) return res.status(400).json({ error: '附件序号无效。' });
    const attachment = await getMailAttachment(account, String(req.query.folder || 'INBOX').slice(0, 200), req.params.uid, index);
    const rawType = String(attachment.contentType || '').split(';')[0].trim().toLowerCase();
    const contentType = /^[\w.+-]+\/[\w.+-]+$/.test(rawType) ? rawType : 'application/octet-stream';
    // 仅可信图片类型允许 inline，防止不可信 HTML/SVG 在客户端直接渲染
    const allowInline = String(req.query.disposition || '') === 'inline' && safeInlineImageTypes.has(contentType);
    const filename = String(attachment.filename || 'attachment').replace(/[\r\n"\\]/g, '_').slice(0, 180) || 'attachment';
    const encodedName = encodeURIComponent(filename).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `${allowInline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodedName}`);
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('Content-Length', String(attachment.content.length));
    res.end(attachment.content);
  } catch (error) {
    if (res.headersSent) return;
    res.status(400).json({ error: safeError(error) });
  }
});
app.post('/api/message/:accountId/:uid/action', auth, async (req, res) => {
  try {
    const account = getAccount(req.params.accountId);
    if (!account) return res.status(404).json({ error: '找不到此邮箱账户。' });
    res.json(await mutateMessage(account, String(req.body?.folder || 'INBOX').slice(0, 200), req.params.uid, String(req.body?.action || '')));
  } catch (error) { res.status(400).json({ error: safeError(error) }); }
});
// "已发送"副本的原始 MIME 用 nodemailer 的 buffer 流传输构造，与实际发送走同一 MIME 引擎，
// 避免手工拼接头部折叠、附件编码等边界问题；Bcc 不传入，副本头不含密送对象。
const sentCopyComposer = nodemailer.createTransport({ streamTransport: 'buffer', buffer: true, newline: 'crlf', textEncoding: 'base64' });
async function rawSentMessage({ email, label, to, cc, subject, text, messageId, inReplyTo, references, attachments = [] }) {
  const info = await sentCopyComposer.sendMail({
    from: { name: label, address: email }, to, cc, subject, text,
    messageId, inReplyTo, references,
    attachments: attachments.map((a) => ({ filename: a.filename, content: a.buffer, contentType: a.contentType }))
  });
  return info.message;
}
app.post('/api/send', auth, async (req, res) => {
  try {
    const account = getAccount(String(req.body?.accountId || ''));
    if (!account) return res.status(404).json({ error: '请选择发件邮箱。' });
    const { to, cc, bcc, subject, text, inReplyTo, references } = req.body || {};
    if (!String(to || '').trim()) return res.status(400).json({ error: '请填写收件人。' });
    if (!String(subject || '').trim() && !String(text || '').trim()) return res.status(400).json({ error: '邮件主题和正文不能同时为空。' });
    const body = String(text || '').slice(0, 500_000);
    const incomingAttachments = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
    if (incomingAttachments.length > 10) return res.status(400).json({ error: '单封邮件最多添加 10 个附件。' });
    let attachmentBytes = 0;
    const attachments = incomingAttachments.map((file) => {
      const encoded = String(file?.content || '');
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('附件数据格式无效。');
      const buffer = Buffer.from(encoded, 'base64');
      attachmentBytes += buffer.length;
      if (buffer.length > 15 * 1024 * 1024 || attachmentBytes > 18 * 1024 * 1024) throw new Error('附件总大小不能超过 18 MB，且单个文件不能超过 15 MB。');
      const filename = String(file?.filename || 'attachment').replace(/[\\/\x00-\x1f\x7f]/g, '_').slice(0, 180) || 'attachment';
      const contentType = /^[\w.+-]+\/[\w.+-]+$/.test(String(file?.contentType || '')) ? String(file.contentType) : 'application/octet-stream';
      return { filename, contentType, buffer };
    });
    const sendResult = await withFreshAccount(account, async (fresh) => {
      const messageId = `<${crypto.randomUUID()}@${fresh.email.split('@').at(-1)}>`;
      const transport = makeSmtp(fresh);
      try {
        await transport.sendMail({
          from: { name: fresh.label, address: fresh.email }, to: String(to).slice(0, 5000), cc: String(cc || '').slice(0, 5000), bcc: String(bcc || '').slice(0, 5000),
          subject: String(subject || '').slice(0, 998), text: body, attachments: attachments.map((a) => ({ filename:a.filename, content:a.buffer, contentType:a.contentType })), messageId, inReplyTo: inReplyTo || undefined, references: references || undefined
        });
      } finally { transport.close(); }
      let sentCopySaved = false;
      try {
        sentCopySaved = await withImapClient(fresh, async (imap) => {
          const sentFolder = findFolder(await listMailboxes(fresh), 'Sent');
          if (!sentFolder) return false;
          const source = await rawSentMessage({ email:fresh.email, label:fresh.label, to, cc, subject, text:body, messageId, inReplyTo, references, attachments });
          await imap.append(sentFolder, source, ['\\Seen']);
          return true;
        });
      } catch (error) { console.error('Sent copy save:', safeError(error)); }
      return { sentCopySaved };
    });
    res.json({ ok: true, sentCopySaved: sendResult.sentCopySaved, message: '邮件已发送。', warning: sendResult.sentCopySaved ? '' : '邮件已发送，但此邮箱的“已发送”副本未能自动保存。' });
  } catch (error) { res.status(400).json({ error: safeError(error) }); }
});

async function sendMcpMail(account, { to, cc = '', bcc = '', subject = '', text = '' }) {
  return withFreshAccount(account, async (fresh) => {
    const messageId = `<${crypto.randomUUID()}@${fresh.email.split('@').at(-1)}>`;
    const transport = makeSmtp(fresh);
    try {
      await transport.sendMail({
        from: { name: fresh.label, address: fresh.email }, to, cc, bcc,
        subject, text, messageId
      });
    } finally { transport.close(); }
    let sentCopySaved = false;
    try {
      sentCopySaved = await withImapClient(fresh, async (imap) => {
        const sentFolder = findFolder(await listMailboxes(fresh), 'Sent');
        if (!sentFolder) return false;
        const source = await rawSentMessage({ email: fresh.email, label: fresh.label, to, cc, subject, text, messageId });
        await imap.append(sentFolder, source, ['\\Seen']);
        return true;
      });
    } catch (error) { console.error('MCP sent copy save:', safeError(error)); }
    return {
      ok: true, sentCopySaved, message: '邮件已发送。',
      warning: sentCopySaved ? '' : '邮件已发送，但此邮箱的“已发送”副本未能自动保存。'
    };
  });
}

// ---------- 移动端 OAuth 回环登录（RFC 8252 + PKCE S256）----------
app.get('/api/mobile/identity/:provider/start', async (req, res) => {
  const provider = String(req.params.provider);
  if (!loginOAuthProviders.includes(provider)) return res.status(404).json({ error: '不支持此登录方式。' });
  if (!db.prepare('SELECT id FROM app_config WHERE id=1').get()) return res.status(409).json({ error: '请先设置工作台密码。' });
  if (!boundIdentity(provider)) return res.status(403).json({ error: '此第三方身份尚未绑定，请先使用工作台密码解锁并在设置中绑定。' });
  const config = getOAuthClientConfig().login[provider];
  const configured = Boolean(config?.clientId && config?.clientSecret && (provider !== 'cloudflare' || config.configurationUrl));
  if (!configured) return res.status(400).json({ error: '尚未配置此第三方登录客户端。' });
  const redirectUri = String(req.query.redirect_uri || '');
  if (!isMobileRedirectUri(redirectUri)) return res.status(400).json({ error: 'redirect_uri 必须是本机回环地址（http://127.0.0.1、localhost）或邮汇私有 scheme。' });
  const deviceState = String(req.query.state || '');
  if (!/^[A-Za-z0-9_\-.]{16,128}$/.test(deviceState)) return res.status(400).json({ error: 'state 参数无效。' });
  const codeChallenge = String(req.query.code_challenge || '');
  if (!/^[A-Za-z0-9\-_]{43,128}$/.test(codeChallenge)) return res.status(400).json({ error: 'code_challenge 无效，需要 base64url 编码的 S256 摘要。' });
  if (String(req.query.code_challenge_method || 'S256').toUpperCase() !== 'S256') return res.status(400).json({ error: '仅支持 S256 的 code_challenge_method。' });
  try {
    const state = crypto.randomBytes(32).toString('base64url');
    const nonce = crypto.randomBytes(32).toString('base64url');
    let authorizeUrl;
    if (provider === 'google') authorizeUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
    else if (provider === 'github') authorizeUrl = 'https://github.com/login/oauth/authorize';
    else authorizeUrl = (await loadCloudflareOidcMetadata(config)).authorization_endpoint;
    db.prepare(`INSERT INTO identity_oauth_states
      (state_hash,provider,flow,session_hash,browser_hash,nonce,expires_at,redirect_uri,code_challenge,device_state)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(hash(state), provider, 'mobile', null, '', nonce, Date.now() + 10 * 60_000, redirectUri.slice(0, 2000), codeChallenge, deviceState.slice(0, 128));
    const url = new URL(authorizeUrl);
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('redirect_uri', identityCallbackUrl(req, provider));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', provider === 'github' ? 'read:user' : 'openid email profile');
    url.searchParams.set('state', state);
    if (provider !== 'github') url.searchParams.set('nonce', nonce);
    if (provider === 'google') url.searchParams.set('prompt', 'select_account');
    res.json({ url: url.toString() });
  } catch (error) { res.status(400).json({ error: safeError(error) }); }
});
app.post('/api/mobile/oauth/exchange', (req, res) => {
  const code = String(req.body?.code || '');
  const deviceState = String(req.body?.state || '');
  const codeVerifier = String(req.body?.codeVerifier || '');
  const deviceId = String(req.body?.deviceId || '').trim();
  if (!/^[A-Za-z0-9_\-.]{16,256}$/.test(code)) return res.status(400).json({ error: '一次性授权码无效。' });
  if (!/^[A-Za-z0-9_\-.]{16,128}$/.test(deviceState)) return res.status(400).json({ error: 'state 参数无效。' });
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(codeVerifier)) return res.status(400).json({ error: 'code_verifier 格式无效。' });
  if (!mobileDeviceIdPattern.test(deviceId)) return res.status(400).json({ error: '设备标识无效。' });
  const record = db.prepare('SELECT * FROM mobile_oauth_codes WHERE code_hash = ?').get(hash(code));
  if (!record || record.expires_at < Date.now()) return res.status(400).json({ error: '授权码已过期，请重新发起登录。' });
  if (!constantTimeTextEqual(record.device_state_hash, hash(deviceState))) return res.status(400).json({ error: 'state 校验失败，请重新发起登录。' });
  const expectedChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  if (!constantTimeTextEqual(record.code_challenge, expectedChallenge)) return res.status(400).json({ error: 'PKCE 校验失败，请重新发起登录。' });
  // 单次消费：原子 UPDATE 防重放
  const consume = db.prepare('UPDATE mobile_oauth_codes SET consumed_at = ? WHERE code_hash = ? AND consumed_at IS NULL').run(Date.now(), record.code_hash);
  if (consume.changes !== 1) return res.status(400).json({ error: '授权码已被使用，请重新发起登录。' });
  res.json(insertMobileSession(deviceId, cleanDeviceLabel(req.body?.deviceLabel)));
});

app.get('/api/identity/:provider/start', (req, res, next) => {
  if (req.query.flow === 'bind') return auth(req, res, next);
  next();
}, async (req, res) => {
  const provider = String(req.params.provider);
  const flow = String(req.query.flow || 'login');
  if (!loginOAuthProviders.includes(provider)) return res.status(404).json({ error: '不支持此登录方式。' });
  if (!['login', 'bind'].includes(flow)) return res.status(400).json({ error: '无效的身份验证流程。' });
  if (!db.prepare('SELECT id FROM app_config WHERE id=1').get()) return res.status(409).json({ error: '请先设置工作台密码。' });
  if (flow === 'login') {
    const token = cookieValue(req, 'youhui_session');
    const active = token && db.prepare('SELECT 1 FROM sessions WHERE token_hash=? AND expires_at>?').get(hash(token), Date.now());
    if (active) return res.status(409).json({ error: '工作台已解锁；请在设置中绑定或切换登录身份。' });
    if (!boundIdentity(provider)) return res.status(403).json({ error: '此第三方身份尚未绑定，请先使用工作台密码解锁并在设置中绑定。' });
  }
  const config = getOAuthClientConfig().login[provider];
  const configured = Boolean(config?.clientId && config?.clientSecret && (provider !== 'cloudflare' || config.configurationUrl));
  if (!configured) return res.status(400).json({ error: '尚未配置此第三方登录客户端。' });
  try {
    const state = crypto.randomBytes(32).toString('base64url');
    const browserToken = crypto.randomBytes(32).toString('base64url');
    const nonce = crypto.randomBytes(32).toString('base64url');
    let authorizeUrl;
    if (provider === 'google') authorizeUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
    else if (provider === 'github') authorizeUrl = 'https://github.com/login/oauth/authorize';
    else authorizeUrl = (await loadCloudflareOidcMetadata(config)).authorization_endpoint;
    db.prepare(`INSERT INTO identity_oauth_states (state_hash,provider,flow,session_hash,browser_hash,nonce,expires_at)
      VALUES (?,?,?,?,?,?,?)`).run(hash(state), provider, flow, flow === 'bind' ? req.sessionHash : null, hash(browserToken), nonce, Date.now() + 10 * 60_000);
    setOAuthFlowCookie(res, req, browserToken);
    const url = new URL(authorizeUrl);
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('redirect_uri', identityCallbackUrl(req, provider));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', provider === 'github' ? 'read:user' : 'openid email profile');
    url.searchParams.set('state', state);
    if (provider !== 'github') url.searchParams.set('nonce', nonce);
    if (provider === 'google') url.searchParams.set('prompt', 'select_account');
    res.json({ url: url.toString() });
  } catch (error) { res.status(400).json({ error: safeError(error) }); }
});
app.get('/identity/:provider/callback', async (req, res) => {
  const provider = String(req.params.provider);
  const state = String(req.query.state || '');
  const pending = loginOAuthProviders.includes(provider)
    ? db.prepare('SELECT * FROM identity_oauth_states WHERE state_hash=? AND provider=?').get(hash(state), provider)
    : null;
  const browserHash = hash(cookieValue(req, 'youhui_oauth_flow'));
  const sessionToken = cookieValue(req, 'youhui_session');
  const session = sessionToken ? db.prepare('SELECT token_hash,expires_at FROM sessions WHERE token_hash=?').get(hash(sessionToken)) : null;
  const activeSessionHash = session && session.expires_at > Date.now() ? session.token_hash : '';
  const stateValid = pending && pending.expires_at > Date.now() && (pending.flow === 'mobile' ||
    (constantTimeTextEqual(pending.browser_hash, browserHash) &&
    (pending.flow === 'bind' ? constantTimeTextEqual(pending.session_hash, activeSessionHash) : !activeSessionHash)));
  clearOAuthFlowCookie(res, req);
  if (!stateValid) {
    if (pending) db.prepare('DELETE FROM identity_oauth_states WHERE state_hash=?').run(pending.state_hash);
    return res.redirect('/?identity_error=state');
  }
  db.prepare('DELETE FROM identity_oauth_states WHERE state_hash=?').run(pending.state_hash);
  if (req.query.error || typeof req.query.code !== 'string' || !req.query.code || req.query.code.length > 4096) return res.redirect('/?identity_error=provider');
  try {
    const config = getOAuthClientConfig().login[provider];
    const profile = await authenticateLoginProvider(provider, req.query.code, req, pending, config);
    const subjectHash = loginSubjectHash(provider, profile.subject);
    if (pending.flow === 'mobile') {
      // 移动端流：验证身份后生成一次性 code（TTL 60s、单次、绑定 deviceState），302 回 App 回环地址
      const savedMobile = db.prepare('SELECT subject_hash FROM login_identities WHERE provider=?').get(provider);
      const mobileState = encodeURIComponent(String(pending.device_state || '').slice(0, 128));
      if (!savedMobile || !constantTimeTextEqual(savedMobile.subject_hash, subjectHash)) {
        return res.redirect(`${pending.redirect_uri}${pending.redirect_uri.includes('?') ? '&' : '?'}error=unbound&state=${mobileState}`);
      }
      const oneTimeCode = crypto.randomBytes(32).toString('base64url');
      db.prepare(`INSERT INTO mobile_oauth_codes (code_hash,provider,device_state_hash,code_challenge,expires_at)
        VALUES (?,?,?,?,?)`).run(hash(oneTimeCode), provider, hash(pending.device_state || ''), pending.code_challenge || '', Date.now() + 60_000);
      const loopback = new URL(pending.redirect_uri);
      loopback.searchParams.set('code', oneTimeCode);
      loopback.searchParams.set('state', String(pending.device_state || '').slice(0, 128));
      return res.redirect(loopback.toString());
    }
    if (pending.flow === 'bind') {
      const stillActive = db.prepare('SELECT 1 FROM sessions WHERE token_hash=? AND expires_at>?').get(pending.session_hash, Date.now());
      if (!stillActive || hash(cookieValue(req, 'youhui_session')) !== pending.session_hash) return res.redirect('/?identity_error=session');
      saveBoundIdentity(provider, profile.subject, profile);
      return res.redirect(`/?identity_linked=${encodeURIComponent(provider)}`);
    }
    const saved = db.prepare('SELECT subject_hash FROM login_identities WHERE provider=?').get(provider);
    if (!saved || !constantTimeTextEqual(saved.subject_hash, subjectHash)) return res.redirect('/?identity_error=unbound');
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions (token_hash,expires_at) VALUES (?,?)').run(hash(token), Date.now() + 30 * 24 * 60 * 60_000);
    setSessionCookie(res, req, token);
    return res.redirect('/?identity=connected');
  } catch (error) {
    console.error(`Third-party login callback ${provider}:`, safeError(error));
    return res.redirect('/?identity_error=oauth');
  }
});
app.get('/oauth/:provider/callback', async (req, res) => {
  const provider = String(req.params.provider);
  const config = oauthProviderConfigFor(provider);
  const state = String(req.query.state || '');
  const pending = db.prepare('SELECT * FROM oauth_states WHERE state = ? AND provider = ?').get(state, provider);
  if (!config || !pending || pending.expires_at < Date.now() || pending.session_hash !== hash(cookieValue(req, 'youhui_session'))) {
    if (pending) db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);
    return res.redirect('/?oauth_error=state');
  }
  db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);
  if (req.query.error) return res.redirect(`/?oauth_error=${encodeURIComponent(String(req.query.error).slice(0, 80))}`);
  try {
    const body = new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, code: String(req.query.code || ''), redirect_uri: callbackUrl(req, provider), grant_type: 'authorization_code' });
    const response = await fetch(config.tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
    const tokens = await response.json();
    if (!response.ok || !tokens.access_token) throw new Error('授权码换取令牌失败。');
    const userInfoResponse = await fetch(config.userInfoUrl, { headers: { authorization: `Bearer ${tokens.access_token}` } });
    const userInfo = await userInfoResponse.json();
    const email = String(userInfo.email || userInfo.preferred_username || userInfo.upn || '').trim();
    if (!userInfoResponse.ok || !email) throw new Error('未能从授权服务读取邮箱地址。');
    const preset = presets[provider];
    const account = {
      id: crypto.randomUUID(), label: String(userInfo.name || email.split('@')[0]).slice(0, 80), email, provider,
      imap_host: preset.imapHost, imap_port: preset.imapPort, imap_secure: 1, smtp_host: preset.smtpHost, smtp_port: preset.smtpPort, smtp_secure: preset.smtpSecure ? 1 : 0,
      username: email, auth_type: 'oauth', credentials: { access_token: tokens.access_token, refresh_token: tokens.refresh_token || '', expires_at: Date.now() + (tokens.expires_in || 3600) * 1000 }, created_at: Date.now()
    };
    await verifyAccount(account);
    persistAccount(account);
    res.redirect('/?oauth=connected');
  } catch (error) {
    console.error(`OAuth callback ${provider}:`, safeError(error));
    res.redirect(`/?oauth_error=${encodeURIComponent(safeError(error).slice(0, 120))}`);
  }
});
app.get('/api/oauth/:provider/start', auth, (req, res) => {
  const provider = String(req.params.provider);
  const config = oauthProviderConfigFor(provider);
  if (!config) return res.status(400).json({ error: '尚未配置此 OAuth 应用。请先设置对应的客户端 ID 和密钥。' });
  const state = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO oauth_states (state,session_hash,provider,expires_at) VALUES (?,?,?,?)').run(state, req.sessionHash, provider, Date.now() + 10 * 60_000);
  const url = new URL(config.authorizeUrl);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', callbackUrl(req, provider));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', config.scopes.join(' '));
  url.searchParams.set('state', state);
  if (provider === 'google') { url.searchParams.set('access_type', 'offline'); url.searchParams.set('prompt', 'consent'); }
  res.json({ url: url.toString() });
});
attachAI({ app, auth, db, encrypt, decrypt, mapAccount, withFreshAccount, makeImap, simpleParser });
attachMcp({ app, auth, db, hash, mapAccount, listMailboxes, fetchMessages, getMailDetail, mutateMessage, sendMessage: sendMcpMail, safeError });
app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在。' }));
app.get('*path', (req, res) => {
  // index.html 不缓存，保证发版后浏览器立即拿到新的资源引用
  res.setHeader('Cache-Control', 'no-cache');
  sendLocalFile(res, path.join(__dirname, 'public', 'index.html'), 'text/html; charset=utf-8');
});
app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  if (error?.status === 413 || error?.type === 'entity.too.large') return res.status(413).json({ error: '备份文件超过 250 MB 上限。' });
  res.status(500).json({ error: '服务器遇到问题，请稍后重试。' });
});

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const server = app.listen(port, host, () => {
  console.log(`邮汇邮件工作台已启动：http://${host}:${port}`);
  scheduleNotificationSweep(5000);
  if (!process.env.APP_BASE_URL) console.log('提示：设置 OAuth 时请配置 APP_BASE_URL 为此应用的公开 HTTPS 地址。');
});

// 优雅退出：停止监听并释放 IMAP IDLE 与池化连接，给在途请求 3 秒收尾后强制退出
let shutdownStarted = false;
function shutdownWorkbench(signal) {
  if (shutdownStarted) return;
  shutdownStarted = true;
  console.log(`收到 ${signal}，正在关闭邮汇工作台…`);
  try { server.close(); } catch {}
  try { clearTimeout(notificationSweepTimer); notificationSweepTimer = null; } catch {}
  for (const accountId of [...notificationIdleMonitors.keys()]) stopNotificationIdle(accountId);
  for (const accountId of [...imapPool.keys()]) evictPooledImap(accountId);
  // 1.5 秒收尾窗口：兼容移动端测试 2 秒的 SIGKILL 前提，也给 Docker stop 留出余量
  setTimeout(() => process.exit(0), 1500);
}
process.once('SIGTERM', () => shutdownWorkbench('SIGTERM'));
process.once('SIGINT', () => shutdownWorkbench('SIGINT'));
