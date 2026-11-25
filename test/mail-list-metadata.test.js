import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { countAttachments } from '../mail-list-metadata.js';

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');
const filterSandbox = {};
vm.runInNewContext(read('../public/mail-list-filters.js'), filterSandbox);
const filters = filterSandbox.YouhuiMailListFilters;


test('counts file attachments but excludes inline images and plain message bodies', () => {
  const structure = {
    type: 'multipart/mixed',
    childNodes: [
      { type: 'text/plain' },
      { type: 'image/png', id: 'logo@example.test', disposition: 'inline', dispositionParameters: { filename: 'logo.png' } },
      { type: 'application/pdf', disposition: 'attachment', dispositionParameters: { filename: 'invoice.pdf' } },
      { type: 'application/octet-stream', parameters: { name: 'archive.zip' } }
    ]
  };

  assert.equal(countAttachments(structure), 2);
});

test('counts a nested attached email once and tolerates absent or malformed structure', () => {
  const structure = {
    type: 'multipart/mixed',
    childNodes: [
      { type: 'message/rfc822', disposition: 'attachment', dispositionParameters: { filename: 'forwarded.eml' }, childNodes: [{ type: 'application/pdf', disposition: 'attachment' }] }
    ]
  };

  assert.equal(countAttachments(structure), 1);
  assert.equal(countAttachments(null), 0);
  assert.equal(countAttachments({ type: 'multipart/mixed', childNodes: 'invalid' }), 0);
});

test('list filter recognizes unread state, attachment metadata and verification cues', () => {
  assert.equal(filters.matchesFilter({ unread: true }, 'unread'), true);
  assert.equal(filters.matchesFilter({ unread: false }, 'unread'), false);
  assert.equal(filters.matchesFilter({ hasAttachments: true }, 'attachments'), true);
  assert.equal(filters.matchesFilter({ attachmentCount: 2 }, 'attachments'), true);
  assert.equal(filters.matchesFilter({ subject: 'Your verification code is 849201' }, 'verification'), true);
  assert.equal(filters.matchesFilter({ verificationCode: '849201' }, 'verification'), true);
  assert.equal(filters.matchesFilter({ subject: 'Monthly statement' }, 'verification'), false);
  assert.equal(filters.matchesFilter({ subject: 'Inbox' }, 'all'), true);
});

test('verification code extraction requires a cue and keeps codes bounded', () => {
  assert.equal(filters.extractVerificationCode('Your verification code is 849201'), '849201');
  assert.equal(filters.extractVerificationCode('OTP: 004812'), '004812');
  assert.equal(filters.extractVerificationCode('Order number 849201'), null);
  assert.equal(filters.extractVerificationCode('验证码：123456789'), null);
});

test('production list UI loads the helper before the app bundle and retains MIME metadata in cache', () => {
  const index = read('../public/index.html');
  const cache = read('../public/mail-list-cache.js');
  const helper = index.match(/<script src="([^"]*mail-list-filters-[^"]+)"/);
  const app = index.match(/<script src="([^"]*app-[0-9a-f]{12}\.js)"/);
  assert.ok(helper, 'hashed filter helper is referenced');
  assert.ok(app, 'hashed app bundle is referenced');
  assert.ok(index.indexOf(helper[1]) < index.indexOf(app[1]), 'filter helper loads before app');
  assert.match(cache, /attachmentCount/);
  assert.match(cache, /hasAttachments/);
});

test('production Docker build includes the IMAP metadata helper', () => {
  const dockerfile = read('../Dockerfile');
  const dockerignore = read('../.dockerignore');
  assert.match(dockerfile, /mail-list-metadata\.js/);
  assert.match(dockerignore, /!mail-list-metadata\.js/);
});
