/* 邮汇 Service Worker：静态资源缓存 + 离线外壳 */
const CACHE = 'youhui-shell-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 不缓存 API 响应（含凭据/邮件数据）
  if (url.pathname.startsWith('/api/')) return;
  // 不缓存 mail-frame（含用户邮件内容）
  if (url.pathname === '/mail-frame') return;

  // hash 版本化资源 → cache-first（immutable）
  if (/-[0-9a-f]{12}\.(?:js|css|png|ico|webmanifest)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        if (res.ok) { const clone = res.clone(); caches.open(CACHE).then((c) => c.put(req, clone)); }
        return res;
      }))
    );
    return;
  }

  // index.html / 源文件 → network-first（保证发版即生效）
  event.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const clone = res.clone(); caches.open(CACHE).then((c) => c.put(req, clone)); }
      return res;
    }).catch(() => caches.match(req).then((cached) => cached || caches.match('/')))
  );
});
