import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const stylesheet = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

test('mobile sidebar keeps settings reachable when many mailboxes are connected', () => {
  const mobileShell = stylesheet.slice(stylesheet.indexOf('@media(max-width:800px){\n  .app-shell{height:100dvh;'));

  assert.match(mobileShell, /\.sidebar\{[^}]*overflow-y:auto/);
  assert.match(mobileShell, /\.account-nav\{[^}]*max-height:min\(30vh,240px\)[^}]*overflow-y:auto/);
  assert.match(mobileShell, /-webkit-overflow-scrolling:touch/);
});
