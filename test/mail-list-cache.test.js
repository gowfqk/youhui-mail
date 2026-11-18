import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

await import('../public/mail-list-cache.js');
const { create } = globalThis.YouhuiMailListCache;
const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

class MemoryStorage {
  #items = new Map();
  get length() { return this.#items.size; }
  key(index) { return [...this.#items.keys()][index] ?? null; }
  getItem(key) { return this.#items.get(key) ?? null; }
  setItem(key, value) { this.#items.set(String(key), String(value)); }
  removeItem(key) { this.#items.delete(key); }
}

const row = (accountId, uid, subject, extra = {}) => ({
  uid, accountId, folder: 'INBOX', subject,
  from: [{ name: `发件人 ${accountId}`, address: `${accountId}@example.test` }],
  date: '2026-11-18T10:00:00.000Z', unread: true, flagged: false, ...extra
});

test('cache hit renders synchronously before refresh and fresh data replaces the cached list', async () => {
  const cache = create(new MemoryStorage());
  const scope = { accountId: 'account-a', folder: 'INBOX', page: 1, query: '' };
  cache.write(scope, { total: 1, messages: [row('account-a', 1, '旧列表')] });
  const updates = [];
  let resolveFetch;
  let fetchStarted = false;
  const pending = cache.load(scope, () => {
    fetchStarted = true;
    return new Promise((resolve) => { resolveFetch = resolve; });
  }, (data, source) => updates.push({ source, subject: data.messages[0]?.subject }));

  assert.deepEqual(updates, [{ source: 'cache', subject: '旧列表' }]);
  assert.equal(fetchStarted, false, 'cached rows are delivered before the fresh request begins');
  await Promise.resolve();
  assert.equal(fetchStarted, true);
  resolveFetch({ total: 1, messages: [row('account-a', 2, '已更新列表')] });
  await pending;

  assert.deepEqual(updates, [
    { source: 'cache', subject: '旧列表' },
    { source: 'network', subject: '已更新列表' }
  ]);
  assert.equal(cache.read(scope).messages[0].subject, '已更新列表');
});

test('account, folder, page and search scopes never reuse another list', () => {
  const cache = create(new MemoryStorage());
  const inboxA = { accountId: 'account-a', folder: 'INBOX', page: 1, query: '' };
  const archiveA = { ...inboxA, folder: 'Archive' };
  const inboxB = { ...inboxA, accountId: 'account-b' };
  const secondPageA = { ...inboxA, page: 2 };
  const searchA = { ...inboxA, query: '合同 2026' };
  for (const [scope, subject] of [[inboxA, 'A 收件箱'], [archiveA, 'A 归档'], [inboxB, 'B 收件箱'], [secondPageA, 'A 第二页'], [searchA, 'A 搜索结果']]) {
    cache.write(scope, { total: 1, messages: [row(scope.accountId, 1, subject, { folder: scope.folder })] });
  }

  assert.equal(cache.read(inboxA).messages[0].subject, 'A 收件箱');
  assert.equal(cache.read(archiveA).messages[0].subject, 'A 归档');
  assert.equal(cache.read(inboxB).messages[0].subject, 'B 收件箱');
  assert.equal(cache.read(secondPageA).messages[0].subject, 'A 第二页');
  assert.equal(cache.read(searchA).messages[0].subject, 'A 搜索结果');
  assert.notEqual(cache.keyFor(inboxA), cache.keyFor(inboxB));
  assert.notEqual(cache.keyFor(inboxA), cache.keyFor(archiveA));
  assert.notEqual(cache.keyFor(inboxA), cache.keyFor(searchA));
});

test('only bounded list metadata is stored; bodies and attachments are excluded', () => {
  const storage = new MemoryStorage();
  const cache = create(storage);
  const scope = { accountId: 'account-a', folder: 'INBOX' };
  cache.write(scope, { total: 1, messages: [row('account-a', 7, '简短主题', {
    text: 'PRIVATE BODY', html: '<p>PRIVATE HTML</p>', attachments: [{ filename: 'private.pdf' }]
  })] });

  const raw = storage.getItem(cache.keyFor(scope));
  assert.doesNotMatch(raw, /PRIVATE BODY|PRIVATE HTML|private\.pdf|attachments|"html"|"text"/);
  assert.equal(cache.read(scope).messages[0].subject, '简短主题');
});

test('account removal clears its lists and aggregate lists without deleting another account cache', () => {
  const cache = create(new MemoryStorage());
  const accountA = { accountId: 'account-a', folder: 'INBOX' };
  const accountB = { accountId: 'account-b', folder: 'INBOX' };
  const all = { accountId: 'all', folder: 'INBOX' };
  for (const scope of [accountA, accountB, all]) cache.write(scope, { total: 1, messages: [row(scope.accountId, 1, scope.accountId)] });

  cache.clearAccount('account-a');
  assert.equal(cache.read(accountA), null);
  assert.equal(cache.read(all), null);
  assert.equal(cache.read(accountB).messages[0].subject, 'account-b');
});

test('app shows cached rows while refreshing and clears cache on logout or account removal', () => {
  const app = read('../public/app.js');
  const index = read('../public/index.html');
  assert.match(app, /mailListCache\.load\(scope/);
  assert.match(app, /mailListCache\.clear\(\)/);
  assert.match(app, /mailListCache\.clearAccount\(account\.id\)/);
  assert.ok(index.indexOf('mail-list-cache-') < index.indexOf('app-'), 'cache helper loads before the app script');
});
