import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');
const digest12 = (value) => createHash('sha256').update(value).digest('hex').slice(0, 12);
const sandbox = {};
vm.runInNewContext(read('../public/message-context-actions.js'), sandbox);
const buildMessageActions = sandbox.YouhuiMailContextActions.buildMessageActions;

const compact = (actions) => Array.from(actions, ({ action, label }) => `${action}:${label}`);

test('message context actions reflect unread and starred state', () => {
  assert.deepEqual(compact(buildMessageActions({ unread: true, flagged: false }, 'INBOX')),
    ['read:标为已读', 'star:加星标', 'archive:归档', 'delete:移到垃圾箱']);
  assert.deepEqual(compact(buildMessageActions({ unread: false, flagged: true }, 'INBOX')),
    ['unread:标为未读', 'unstar:取消星标', 'archive:归档', 'delete:移到垃圾箱']);
});

test('does not offer archive in Archive or move-to-Trash again inside Trash', () => {
  assert.deepEqual(compact(buildMessageActions({ unread: false, flagged: false }, 'Archive')),
    ['unread:标为未读', 'star:加星标', 'delete:移到垃圾箱']);
  assert.deepEqual(compact(buildMessageActions({ unread: true, flagged: true, folder: '[Gmail]/Bin' }, 'INBOX', [
    { path: '[Gmail]/Bin', name: 'Trash' }
  ])), ['read:标为已读', 'unstar:取消星标', 'archive:归档']);
});

test('context actions stay within the existing backend action allowlist', () => {
  const allowed = new Set(['read', 'unread', 'star', 'unstar', 'archive', 'delete']);
  for (const action of buildMessageActions({ unread: true, flagged: false }, 'INBOX')) {
    assert.ok(allowed.has(action.action), `unexpected action ${action.action}`);
  }
});

test('email rows retain open behavior and expose pointer and keyboard context-menu triggers', () => {
  const app = read('../public/app.js');
  assert.match(app, /row\.addEventListener\('click', \(\) => openMessage\(/);
  assert.match(app, /row\.addEventListener\('contextmenu'/);
  assert.match(app, /event\.key === 'ContextMenu'/);
  assert.match(app, /event\.shiftKey && event\.key === 'F10'/);
  assert.match(app, /aria-haspopup="menu"/);
  assert.match(app, /setAttribute\('role', 'menu'\)/);
  assert.match(app, /setAttribute\('role', 'menuitem'\)/);
  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape', 'Tab']) {
    assert.ok(app.includes(`event.key === '${key}'`), `menu should handle ${key}`);
  }
  assert.match(app, /document\.addEventListener\('pointerdown'/);
  assert.match(app, /YouhuiMailContextActions\.buildMessageActions\(message, state\.folder, state\.folders\)/);
});

test('context actions reuse the existing endpoint and confirmation flow, then update the list cache', () => {
  const app = read('../public/app.js');
  assert.match(app, /const supported = \['read', 'unread', 'star', 'unstar', 'archive', 'delete'\]/);
  assert.match(app, /api\(`\/api\/message\/\$\{encodeURIComponent\(message\.accountId\)\}\/\$\{message\.uid\}\/action`/);
  assert.match(app, /await askConfirm\(title, copy/);
  assert.match(app, /writeCurrentMessageListCache\(\)/);
  assert.match(app, /if \(sameMessage\(state\.selected, message\)\)/);
  assert.match(app, /String\(left\.folder \|\| state\.folder\) === String\(right\.folder \|\| state\.folder\)/);
  assert.match(app, /mailListCache\.write\(/);
});

test('new helper loads before app and its hashed static asset matches the source', () => {
  const index = read('../public/index.html');
  const helper = read('../public/message-context-actions.js');
  assert.ok(index.indexOf('message-context-actions-') < index.indexOf('app-'), 'context-action helper loads before the app');
  assert.ok(index.includes(`message-context-actions-${digest12(helper)}.js`));
  assert.equal(read(`../public/message-context-actions-${digest12(helper)}.js`), helper);
});
