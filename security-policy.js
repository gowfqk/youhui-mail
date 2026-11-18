export const APP_CONTENT_SECURITY_POLICY = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

export const MAIL_FRAME_CONTENT_SECURITY_POLICY = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src data: http: https:; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox";

export function securityHeadersForPath(pathname) {
  const isMailFrame = pathname === '/mail-frame';
  return {
    contentSecurityPolicy: isMailFrame ? MAIL_FRAME_CONTENT_SECURITY_POLICY : APP_CONTENT_SECURITY_POLICY,
    xFrameOptions: isMailFrame ? 'SAMEORIGIN' : 'DENY'
  };
}
