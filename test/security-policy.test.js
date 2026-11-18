import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_CONTENT_SECURITY_POLICY,
  MAIL_FRAME_CONTENT_SECURITY_POLICY,
  securityHeadersForPath
} from '../security-policy.js';

test('keeps the app CSP strict and grants inline styles only to the isolated mail frame', () => {
  const appHeaders = securityHeadersForPath('/');
  const frameHeaders = securityHeadersForPath('/mail-frame');

  assert.equal(appHeaders.contentSecurityPolicy, APP_CONTENT_SECURITY_POLICY);
  assert.equal(appHeaders.xFrameOptions, 'DENY');
  assert.match(APP_CONTENT_SECURITY_POLICY, /style-src 'self'/);
  assert.doesNotMatch(APP_CONTENT_SECURITY_POLICY, /unsafe-inline/);

  assert.equal(frameHeaders.contentSecurityPolicy, MAIL_FRAME_CONTENT_SECURITY_POLICY);
  assert.equal(frameHeaders.xFrameOptions, 'SAMEORIGIN');
  assert.match(MAIL_FRAME_CONTENT_SECURITY_POLICY, /style-src 'self' 'unsafe-inline'/);
  assert.match(MAIL_FRAME_CONTENT_SECURITY_POLICY, /connect-src 'none'/);
  assert.match(MAIL_FRAME_CONTENT_SECURITY_POLICY, /frame-src 'none'/);
  assert.match(MAIL_FRAME_CONTENT_SECURITY_POLICY, /form-action 'none'/);
  assert.match(MAIL_FRAME_CONTENT_SECURITY_POLICY, /sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox/);
  assert.doesNotMatch(MAIL_FRAME_CONTENT_SECURITY_POLICY, /allow-same-origin/);
});

test('only the exact mail-frame route receives the scoped frame policy', () => {
  assert.equal(securityHeadersForPath('/mail-frame/').contentSecurityPolicy, APP_CONTENT_SECURITY_POLICY);
  assert.equal(securityHeadersForPath('/api/message/a/1').xFrameOptions, 'DENY');
});
