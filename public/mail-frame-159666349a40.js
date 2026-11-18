const content = document.getElementById('mailFrameContent');
let resizeQueued = false;

function reportHeight() {
  resizeQueued = false;
  const height = Math.ceil(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
  window.parent.postMessage({ type: 'youhui-mail-frame-height', height }, '*');
}

function scheduleHeightReport() {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(reportHeight);
}

function renderEmail(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  content.replaceChildren(template.content);
  content.querySelectorAll('a[href]').forEach((link) => {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  });
  content.querySelectorAll('table').forEach((table) => {
    const scroll = document.createElement('div');
    scroll.className = 'mail-table-scroll';
    table.before(scroll);
    scroll.append(table);
  });
  content.querySelectorAll('img').forEach((image) => image.addEventListener('load', scheduleHeightReport, { once: true }));
  scheduleHeightReport();
}

function loadRemoteImagesAfterConsent() {
  content.querySelectorAll('img[data-external-src]').forEach((image) => {
    const source = image.getAttribute('data-external-src') || '';
    if (!/^https?:\/\//i.test(source)) return;
    image.setAttribute('src', source);
    image.removeAttribute('data-external-src');
    image.addEventListener('load', scheduleHeightReport, { once: true });
    image.addEventListener('error', scheduleHeightReport, { once: true });
  });
}

window.addEventListener('message', (event) => {
  if (event.source !== window.parent || !event.data || typeof event.data !== 'object') return;
  if (event.data.type === 'render-email' && typeof event.data.html === 'string') renderEmail(event.data.html);
  if (event.data.type === 'load-remote-images') loadRemoteImagesAfterConsent();
});

if ('ResizeObserver' in window) new ResizeObserver(scheduleHeightReport).observe(content);
window.addEventListener('load', scheduleHeightReport);
