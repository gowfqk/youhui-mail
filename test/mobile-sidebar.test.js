import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const stylesheet = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

test('mobile sidebar keeps settings reachable when many mailboxes are connected', () => {
  const mobileShell = stylesheet.slice(stylesheet.indexOf('@media(max-width:800px){\n  .app-shell{height:100dvh;'));

  // 侧栏保持单一滚动容器；账户/文件夹/自定义文件夹不再设内部滚动区，避免嵌套手势导致列表"看不到"
  assert.match(mobileShell, /\.sidebar\{[^}]*overflow-y:auto/);
  assert.match(mobileShell, /\.sidebar-spacer\{display:none\}/);
  assert.match(mobileShell, /\.folder-nav,\.account-nav,\.custom-folder-nav\{flex:0 0 auto;max-height:none;overflow:visible\}/);
  assert.match(mobileShell, /\.account-nav\{[^}]*overflow-y:visible/);
  assert.match(mobileShell, /-webkit-overflow-scrolling:touch/);
});
