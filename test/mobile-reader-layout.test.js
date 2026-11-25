import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

test('mobile reader expands into the viewport and keeps message actions reachable', () => {
  const app = read('../public/app.js');
  const stylesheet = read('../public/style.css');
  const themeStyles = read('../public/redesign-theme.css');
  const mobileStyles = stylesheet.slice(stylesheet.lastIndexOf('/* Mobile reading mode:'));

  assert.match(app, /classList\.add\('mobile-reading'\)/);
  assert.match(app, /function closeDetailMobile\(\)[\s\S]*?classList\.remove\('mobile-reading'\)/);
  assert.match(app, /function renderDetailPlaceholder\(\)[\s\S]*?classList\.remove\('mobile-reading'\)/);
  assert.match(mobileStyles, /@media\(max-width:800px\)/);
  assert.match(mobileStyles, /\.app-shell\.mobile-reading \.topbar\{display:none\}/);
  assert.match(mobileStyles, /\.app-shell\.mobile-reading \.detail-toolbar\{position:sticky/);
  assert.match(mobileStyles, /\.app-shell\.mobile-reading \.detail-toolbar \.icon-button\{[^}]*min-height:42px/);
  assert.match(mobileStyles, /\.app-shell\.mobile-reading \.detail-view\{[^}]*max-width:none/);
  assert.match(app, /id="detailScrollArea" class="detail-scroll-area"/);
  assert.match(app, /class="detail-actions-bottom"/);
  assert.match(stylesheet, /\.message-list\{[^}]*overflow-y:auto/);
  assert.match(themeStyles, /\.detail-scroll-area\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(themeStyles, /\.detail-pane\s*\{[^}]*display:\s*flex/);
  assert.match(themeStyles, /\.detail-actions-bottom\s*\{[^}]*flex:\s*0 0 auto/);
  assert.match(themeStyles, /\.app-shell\.mobile-reading \.detail-actions\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(themeStyles, /\.workspace\s*\{\s*padding:\s*0 !important;\s*gap:\s*0 !important;/);
  assert.match(themeStyles, /\.list-pane,\s*\.detail-pane\s*\{\s*border:\s*0 !important;\s*border-radius:\s*0 !important;/);
  assert.match(themeStyles, /\.app-shell\.mobile-reading \.sender-meta\s*\{[^}]*padding:\s*0;/);
  assert.match(themeStyles, /\.app-shell\.mobile-reading \.mail-body iframe\s*\{[^}]*max-width:\s*100%/);
});

test('redesign theme targets production mail components with stronger visual hierarchy', () => {
  const themeStyles = read('../public/redesign-theme.css');

  assert.match(themeStyles, /\.list-pane,\s*\.detail-pane\s*\{\s*background:\s*var\(--yh-bg-surface\)/);
  assert.match(themeStyles, /\.message-row\s*\{[^}]*border-radius:\s*13px !important/);
  assert.match(themeStyles, /\.message-row\.selected,\s*\.message-row\.unread\.selected\s*\{/);
  assert.match(themeStyles, /\.detail-view\s*\{[^}]*max-width:\s*960px/);
  assert.match(themeStyles, /\.sender-meta\s*\{[^}]*background:\s*var\(--yh-bg-subtle\)/);
  assert.match(themeStyles, /\.attachment-link\s*\{/);
  assert.doesNotMatch(themeStyles, /\.(?:message-card|detail-body|detail-sender-card)\b/);
});

test('mail details expose verification copy, direct reply and an AI summary action', () => {
  const app = read('../public/app.js');

  assert.match(app, /data-action="ai-summary"/);
  assert.match(app, /data-copy-verification-code=/);
  assert.match(app, /id="quickReplyForm"/);
  assert.match(app, /navigator\.clipboard\?\.writeText/);
  assert.match(app, /inReplyTo:\s*detail\.messageId/);
  assert.match(app, /text:\s*detailBodyPlainText\(detail\)\.slice\(0, 12_000\)/);
});
