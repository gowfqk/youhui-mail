import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeContentId, sanitizeEmailHtml } from '../email-html.js';

test('keeps common email inline layout, typography and color styles', () => {
  const cleaned = sanitizeEmailHtml(`<!doctype html><html><head><style>body{display:none}</style></head>
    <body style="margin:0;background-color:#f2f6f7;color:#24343a">
      <table style="width:100%;max-width:600px;border-collapse:collapse;background-color:#fff">
        <tr><td style="padding:16px;border:1px solid #dce5e8;font-family:Arial,sans-serif;font-size:16px;font-weight:600;line-height:1.5;text-align:center;color:#16786d">Your receipt is ready</td></tr>
      </table>
    </body></html>`);

  assert.match(cleaned, /<div style="[^"]*background-color:#f2f6f7/);
  assert.doesNotMatch(cleaned, /<body\b|<style\b|display:none/i);
  for (const css of ['width:100%', 'max-width:600px', 'border-collapse:collapse', 'padding:16px', 'border:1px solid #dce5e8', 'font-family:Arial,sans-serif', 'font-size:16px', 'font-weight:600', 'text-align:center', 'color:#16786d']) {
    assert.ok(cleaned.includes(css), `expected sanitized HTML to keep ${css}`);
  }
});

test('drops overlay, hide, unbounded and resource-loading CSS declarations', () => {
  const cleaned = sanitizeEmailHtml(`<div style="position:fixed;inset:0;z-index:99999;display:none;visibility:hidden;opacity:0;background:url(https://tracker.invalid/a);background-image:url(https://tracker.invalid/b);width:calc(100vw);margin:-999px;color:expression(alert(1));color:#123456">Still readable</div>`);

  assert.match(cleaned, /Still readable/);
  assert.match(cleaned, /color:#123456/);
  assert.doesNotMatch(cleaned, /position|inset|z-index|display:|visibility|opacity|background:|url\(|calc\(|expression|margin:-/i);
});

test('keeps safe CID images inert external images, safe links and unsafe URL removal', () => {
  const inlineImages = new Map([['logo@example.test', 'data:image/png;base64,AAAA']]);
  const cleaned = sanitizeEmailHtml(`<p><a href="https://example.test/path">safe</a> <a href="javascript:alert(1)">unsafe</a></p>
    <img src="cid:logo%40example.test" alt="logo">
    <img src="https://tracker.invalid/pixel.png" style="width:24px;height:24px;background-image:url(https://tracker.invalid/bg.png)">
    <img src="javascript:alert(1)" onerror="alert(1)">
    <form action="https://attacker.invalid"><button>submit</button></form>`, inlineImages);

  assert.match(cleaned, /<a href="https:\/\/example\.test\/path"[^>]*target="_blank"[^>]*rel="noopener noreferrer">safe<\/a>/);
  assert.match(cleaned, /<a target="_blank" rel="noopener noreferrer">unsafe<\/a>/);
  assert.match(cleaned, /<img src="data:image\/png;base64,AAAA" alt="logo"\s*\/>/);
  assert.match(cleaned, /data-external-src="https:\/\/tracker\.invalid\/pixel\.png"/);
  assert.doesNotMatch(cleaned, /<img[^>]*\ssrc="https:\/\/tracker\.invalid/);
  assert.doesNotMatch(cleaned, /javascript:|onerror|<form|<button|url\(/i);
});

test('CID normalization remains compatible with encoded and bracketed MIME identifiers', () => {
  assert.equal(normalizeContentId(' CID:<Logo%40Example.Test> '), 'logo@example.test');
});
