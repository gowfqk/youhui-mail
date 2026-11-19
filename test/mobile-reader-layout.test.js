import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

test('mobile reader expands into the viewport and keeps message actions reachable', () => {
  const app = read('../public/app.js');
  const stylesheet = read('../public/style.css');
  const mobileStyles = stylesheet.slice(stylesheet.lastIndexOf('/* Mobile reading mode:'));

  assert.match(app, /classList\.add\('mobile-reading'\)/);
  assert.match(app, /function closeDetailMobile\(\)[\s\S]*?classList\.remove\('mobile-reading'\)/);
  assert.match(app, /function renderDetailPlaceholder\(\)[\s\S]*?classList\.remove\('mobile-reading'\)/);
  assert.match(mobileStyles, /@media\(max-width:800px\)/);
  assert.match(mobileStyles, /\.app-shell\.mobile-reading \.topbar\{display:none\}/);
  assert.match(mobileStyles, /\.app-shell\.mobile-reading \.detail-toolbar\{position:sticky/);
  assert.match(mobileStyles, /\.app-shell\.mobile-reading \.detail-toolbar \.icon-button\{[^}]*min-height:42px/);
  assert.match(mobileStyles, /\.app-shell\.mobile-reading \.detail-view\{[^}]*max-width:none/);
});
