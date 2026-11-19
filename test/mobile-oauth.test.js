import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let dataDir;
let port;
let baseUrl;
let serverProcess;
let testDb;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function codeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

async function findFreePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const freePort = address.port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return freePort;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (serverProcess.exitCode !== null) throw new Error(`test server exited with ${serverProcess.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/mobile/oauth/exchange`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}'
      });
      if (response.status === 400) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('test server did not become ready');
}

async function postExchange(body) {
  return fetch(`${baseUrl}/api/mobile/oauth/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

before(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'youhui-mobile-oauth-'));
  await writeFile(path.join(dataDir, 'encryption.key'), crypto.randomBytes(32), { mode: 0o600 });
  port = await findFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, [path.join(projectRoot, 'server.js')], {
    cwd: dataDir,
    env: {
      PATH: process.env.PATH || '',
      HOME: dataDir,
      NODE_ENV: 'test',
      DATA_DIR: dataDir,
      HOST: '127.0.0.1',
      PORT: String(port),
      APP_BASE_URL: baseUrl
    },
    stdio: 'ignore'
  });
  await waitForServer();
  testDb = new Database(path.join(dataDir, 'mail.sqlite'));
});

after(async () => {
  if (testDb) testDb.close();
  if (serverProcess && serverProcess.exitCode === null && serverProcess.signalCode === null) {
    await new Promise((resolve) => {
      const killTimer = setTimeout(() => serverProcess.kill('SIGKILL'), 2000);
      serverProcess.once('exit', () => {
        clearTimeout(killTimer);
        resolve();
      });
      serverProcess.kill('SIGTERM');
    });
  }
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

test('mobile OAuth exchange binds state, keeps the code after state rejection, and rejects replay', async () => {
  const code = crypto.randomBytes(32).toString('base64url');
  const state = crypto.randomBytes(24).toString('base64url');
  const wrongState = crypto.randomBytes(24).toString('base64url');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const deviceId = crypto.randomUUID();
  testDb.prepare(`INSERT INTO mobile_oauth_codes
    (code_hash, provider, device_state_hash, code_challenge, expires_at)
    VALUES (?, ?, ?, ?, ?)`)
    .run(sha256(code), 'google', sha256(state), codeChallenge(verifier), Date.now() + 60_000);

  const baseBody = { code, codeVerifier: verifier, deviceId, deviceLabel: 'OAuth integration test' };
  const missingState = await postExchange(baseBody);
  assert.equal(missingState.status, 400);
  assert.match((await missingState.json()).error, /state/i);

  const mismatchedState = await postExchange({ ...baseBody, state: wrongState });
  assert.equal(mismatchedState.status, 400);
  assert.match((await mismatchedState.json()).error, /state/i);

  const successfulExchange = await postExchange({ ...baseBody, state });
  assert.equal(successfulExchange.status, 200);
  const session = await successfulExchange.json();
  assert.equal(session.session.kind, 'mobile');
  assert.equal(session.session.deviceId, deviceId);
  assert.equal(typeof session.token, 'string');
  assert.ok(session.token.length >= 40);

  const replay = await postExchange({ ...baseBody, state });
  assert.equal(replay.status, 400);
  assert.match((await replay.json()).error, /使用/);
});
