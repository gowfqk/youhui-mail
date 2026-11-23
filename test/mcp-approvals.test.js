import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import express from 'express';
import Database from 'better-sqlite3';

function makeCipher() {
  const key = crypto.randomBytes(32);
  return {
    encrypt(value) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
    },
    decrypt(value) {
      const all = Buffer.from(value, 'base64');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, all.subarray(0, 12));
      decipher.setAuthTag(all.subarray(12, 28));
      return JSON.parse(Buffer.concat([decipher.update(all.subarray(28)), decipher.final()]).toString('utf8'));
    }
  };
}

function prepareDatabase(db, token) {
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, label TEXT NOT NULL, email TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS mcp_approvals (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('manage_email', 'send_email')),
      account_id TEXT NOT NULL, payload_encrypted TEXT NOT NULL, created_at INTEGER NOT NULL,
      executing INTEGER NOT NULL DEFAULT 0
    );
  `);
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  db.prepare('INSERT OR IGNORE INTO app_preferences (key, value) VALUES (?, ?)').run('mcp_token_hash_full_access', hash);
  db.prepare('INSERT OR IGNORE INTO accounts (id, label, email) VALUES (?, ?, ?)').run('account-1', 'Personal', 'owner@example.test');
}

async function startMcpInstance(db, token, executed, cipher) {
  const moduleUrl = new URL('../mcp-service.js', import.meta.url);
  const { attachMcp } = await import(`${moduleUrl.href}?instance=${crypto.randomUUID()}`);
  const app = express();
  app.use(express.json());
  const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
  attachMcp({
    app,
    auth: (req, res, next) => next(),
    db,
    hash,
    encrypt: cipher.encrypt,
    decrypt: cipher.decrypt,
    mapAccount: (row) => row,
    listMailboxes: async () => [],
    fetchMessages: async () => ({ messages: [], total: 0 }),
    getMailDetail: async () => ({}),
    mutateMessage: async (account, folder, uid, action) => executed.push({ accountId: account.id, folder, uid, action }),
    sendMessage: async () => ({ ok: true }),
    safeError: (error) => error instanceof Error ? error.message : String(error)
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}`, token };
}

async function stopServer(server) {
  if (!server?.listening) return;
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function getApprovals(instance) {
  const response = await fetch(`${instance.baseUrl}/api/mcp/approvals`);
  assert.equal(response.status, 200);
  return (await response.json()).approvals;
}

test('MCP delete approvals persist in SQLite and are visible to an independent app instance', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'youhui-mcp-approvals-'));
  const databasePath = path.join(directory, 'mail.sqlite');
  const token = crypto.randomBytes(32).toString('base64url');
  const cipher = makeCipher();
  const db1 = new Database(databasePath);
  const db2 = new Database(databasePath);
  prepareDatabase(db1, token);
  const executed = [];
  const servers = [];
  t.after(async () => {
    await Promise.all(servers.map(stopServer));
    db2.close();
    db1.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const mcpInstance = await startMcpInstance(db1, token, executed, cipher);
  servers.push(mcpInstance.server);
  const toolResponse = await fetch(`${mcpInstance.baseUrl}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 'delete-1', method: 'tools/call',
      params: { name: 'manage_email', arguments: { accountId: 'account-1', uid: 77, folder: 'INBOX', action: 'delete' } }
    })
  });
  assert.equal(toolResponse.status, 200);
  const toolResult = await toolResponse.json();
  const pending = toolResult.result?.structuredContent;
  assert.equal(pending?.pendingConfirmation, true);
  assert.equal(executed.length, 0, 'MCP must not delete the message before user confirmation');

  const stored = db1.prepare('SELECT payload_encrypted FROM mcp_approvals WHERE id = ?').get(pending.approvalId);
  assert.ok(stored?.payload_encrypted);
  assert.equal(stored.payload_encrypted.includes('owner@example.test'), false, 'approval details should be encrypted at rest');

  const appInstance = await startMcpInstance(db2, token, executed, cipher);
  servers.push(appInstance.server);
  const visible = await getApprovals(appInstance);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].id, pending.approvalId);
  assert.equal(visible[0].kind, 'manage_email');
  assert.equal(visible[0].accountEmail, 'owner@example.test');
  assert.equal(visible[0].folder, 'INBOX');
  assert.equal(visible[0].uid, 77);

  const approveResponse = await fetch(`${appInstance.baseUrl}/api/mcp/approvals/${encodeURIComponent(pending.approvalId)}/approve`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
  });
  assert.equal(approveResponse.status, 200);
  assert.deepEqual(executed, [{ accountId: 'account-1', folder: 'INBOX', uid: 77, action: 'delete' }]);
  assert.deepEqual(await getApprovals(mcpInstance), []);
});
