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

test('Docker image includes the runtime mail sanitizer, CSP module and frame document', () => {
  const dockerfile = read('../Dockerfile');
  const copiedServerFiles = dockerfile.match(/^COPY server\.js ai-service\.js mcp-service\.js (.+) \.\/$/m)?.[1]?.split(/\s+/) || [];
  const dockerignore = read('../.dockerignore').split(/\r?\n/);

  for (const filename of ['email-html.js', 'security-policy.js', 'mail-frame.html']) {
    assert.ok(copiedServerFiles.includes(filename), `Docker build must copy ${filename}`);
    assert.ok(dockerignore.includes(`!${filename}`), `Docker build context must include ${filename}`);
  }
  assert.match(dockerfile, /^COPY public \.\/public$/m);
});

test('content-hashed app and iframe assets exactly match their sources', () => {
  const index = read('../public/index.html');
  const appSource = read('../public/app.js');
  const cacheSource = read('../public/mail-list-cache.js');
  const contextActionSource = read('../public/message-context-actions.js');
  const frameSource = read('../public/mail-frame.js');
  const frameHtml = read('../mail-frame.html');
  const styleSource = read('../public/style.css');
  const appName = index.match(/<script src="\/(app-[a-f0-9]{12}\.js)" defer>/)?.[1];
  const cacheName = index.match(/<script src="\/(mail-list-cache-[a-f0-9]{12}\.js)" defer>/)?.[1];
  const contextActionName = index.match(/<script src="\/(message-context-actions-[a-f0-9]{12}\.js)" defer>/)?.[1];
  const frameName = frameHtml.match(/<script src="\/(mail-frame-[a-f0-9]{12}\.js)" defer>/)?.[1];
  const styleName = index.match(/<link rel="stylesheet" href="\/(style-[a-f0-9]{12}\.css)">/)?.[1];

  assert.ok(appName, 'index should reference the hashed app bundle');
  assert.ok(cacheName, 'index should reference the hashed list-cache helper');
  assert.ok(contextActionName, 'index should reference the hashed context-action helper');
  assert.ok(frameName, 'mail frame should reference the hashed frame bundle');
  assert.ok(styleName, 'index should reference the hashed stylesheet');
  assert.ok(index.indexOf(cacheName) < index.indexOf(appName), 'list-cache helper should load before app bundle');
  assert.ok(index.indexOf(cacheName) < index.indexOf(contextActionName) && index.indexOf(contextActionName) < index.indexOf(appName), 'context-action helper should load between cache and app bundles');
  assert.equal(appName, `app-${digest12(appSource)}.js`);
  assert.equal(cacheName, `mail-list-cache-${digest12(cacheSource)}.js`);
  assert.equal(contextActionName, `message-context-actions-${digest12(contextActionSource)}.js`);
  assert.equal(frameName, `mail-frame-${digest12(frameSource)}.js`);
  assert.equal(styleName, `style-${digest12(styleSource)}.css`);
  assert.equal(read(`../public/${appName}`), appSource);
  assert.equal(read(`../public/${cacheName}`), cacheSource);
  assert.equal(read(`../public/${contextActionName}`), contextActionSource);
  assert.equal(read(`../public/${frameName}`), frameSource);
  assert.equal(read(`../public/${styleName}`), styleSource);
});
