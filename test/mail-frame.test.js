import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');
const digest12 = (value) => createHash('sha256').update(value).digest('hex').slice(0, 12);

test('renders email only inside a sandbox without same-origin access', () => {
  const app = read('../public/app.js');
  const frameScript = read('../public/mail-frame.js');
  const frameHtml = read('../mail-frame.html');

  assert.match(app, /setAttribute\('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox'\)/);
  assert.doesNotMatch(app, /allow-same-origin/);
  assert.match(frameHtml, /<style>[\s\S]*<\/style>/);
  assert.match(frameHtml, /<script src="\/mail-frame-[a-f0-9]{12}\.js" defer><\/script>/);
  assert.match(frameScript, /event\.source !== window\.parent/);
  assert.match(app, /此邮件包含 \$\{remoteImageCount\} 张远程图片，默认未加载/);
  assert.match(app, /postMessage\(\{ type: 'load-remote-images' \}, '\*'\)/);
  assert.match(frameScript, /event\.data\.type === 'load-remote-images'\) loadRemoteImagesAfterConsent\(\)/);
});

test('content-hashed app and iframe assets exactly match their sources', () => {
  const index = read('../public/index.html');
  const appSource = read('../public/app.js');
  const frameSource = read('../public/mail-frame.js');
  const frameHtml = read('../mail-frame.html');
  const appName = index.match(/<script src="\/(app-[a-f0-9]{12}\.js)" defer>/)?.[1];
  const frameName = frameHtml.match(/<script src="\/(mail-frame-[a-f0-9]{12}\.js)" defer>/)?.[1];

  assert.ok(appName, 'index should reference the hashed app bundle');
  assert.ok(frameName, 'mail frame should reference the hashed frame bundle');
  assert.equal(appName, `app-${digest12(appSource)}.js`);
  assert.equal(frameName, `mail-frame-${digest12(frameSource)}.js`);
  assert.equal(read(`../public/${appName}`), appSource);
  assert.equal(read(`../public/${frameName}`), frameSource);
});
