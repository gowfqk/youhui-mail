const state = {
  status: null, accounts: [], defaultAccountId: '', folders: [], folder: 'INBOX', accountId: 'all', cursor: null, cursorStack: [], query: '',
  messages: [], total: 0, selected: null, detail: null, olderFirst: false, threadView: false, busy: false, searchTimer: null, mailListRequestId: 0,
  aiConfig: null, translationConfig: null, notificationConfig: null, oauthConfig: null, mcpConfig: null, aiMessages: [], aiContext: null, aiBusy: false
};
// ---- 语言 / i18n：zh 为默认，localStorage 记忆，切换后整页刷新 ----
const I18N_LANG = (() => {
  try {
    const saved = localStorage.getItem('youhui_lang');
    if (saved === 'en' || saved === 'zh') return saved;
    return (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
  } catch { return 'zh'; }
})();
const I18N_EN = (window.YouhuiI18n && window.YouhuiI18n.en) || {};
const L = (s) => (I18N_LANG === 'en' && typeof s === 'string' && I18N_EN[s] != null) ? I18N_EN[s] : s;
const UI_LOCALE = I18N_LANG === 'en' ? 'en-US' : 'zh-CN';
// 把词典应用到静态 DOM：文本节点按去除首尾空格后的原文精确匹配；placeholder/title/aria-label 按属性值精确匹配
function applyI18nDom(root = document) {
  if (I18N_LANG !== 'en' || !root) return;
  const dict = I18N_EN;
  const tree = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      // 跳过 script/style 内的文本节点（不是 UI 文案，误替换会破坏脚本源码）
      const parent = node.parentElement;
      if (parent && (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const hits = [];
  for (let node = tree.nextNode(); node; node = tree.nextNode()) {
    const trimmed = node.textContent.trim();
    if (trimmed && dict[trimmed] != null) hits.push([node, trimmed, dict[trimmed]]);
  }
  // 替换时保留原始首尾空白（用 replace 定位键、避免破坏缩进）
  for (const [node, key, value] of hits) {
    node.textContent = node.textContent.replace(key, value);
  }
  if (root.querySelectorAll) {
    root.querySelectorAll('[placeholder],[title],[aria-label]').forEach((el) => {
      for (const attr of ['placeholder', 'title', 'aria-label']) {
        const raw = el.getAttribute(attr);
        const trimmed = raw?.trim();
        if (trimmed && dict[trimmed] != null) el.setAttribute(attr, dict[trimmed]);
      }
    });
  }
}
function syncLangToggle() {
  document.querySelectorAll('[data-lang-toggle]').forEach((button) => {
    button.textContent = I18N_LANG === 'en' ? '中文' : 'EN';
    button.title = I18N_LANG === 'en' ? '切换到中文' : 'Switch to English';
  });
}
function toggleLanguage() {
  try { localStorage.setItem('youhui_lang', I18N_LANG === 'en' ? 'zh' : 'en'); } catch {}
  location.reload();
}
// ---- 键盘快捷键：j/k 上下选择、Enter 打开、a 归档、x 删、s 星标、c 写信、/ 搜索、Esc 返回 ----
document.addEventListener('keydown', (event) => {
  if (event.target.matches('input,textarea,select,[contenteditable]') || event.ctrlKey || event.metaKey || event.altKey) return;
  if (!$('#appView') || $('#appView').classList.contains('hidden')) return;
  const rows = state.messages;
  const idx = rows.findIndex((m) => sameMessage(m, state.selected));
  const next = (delta) => {
    const target = rows[Math.max(0, Math.min(rows.length - 1, idx + delta))];
    if (target) { state.selected = target; renderMessages(); }
  };
  switch (event.key) {
    case 'j': case 'ArrowDown': event.preventDefault(); next(1); break;
    case 'k': case 'ArrowUp': event.preventDefault(); next(-1); break;
    case 'Enter': if (idx >= 0) { event.preventDefault(); openMessage(idx); } break;
    case 'a': if (idx >= 0) { event.preventDefault(); performMessageAction('archive', rows[idx]); } break;
    case 'x': if (idx >= 0) { event.preventDefault(); performMessageAction('delete', rows[idx]); } break;
    case 's': if (idx >= 0) { event.preventDefault(); performMessageAction(rows[idx].flagged ? 'unstar' : 'star', rows[idx]); } break;
    case 'c': event.preventDefault(); openCompose(); break;
    case '/': event.preventDefault(); $('#searchInput').focus(); break;
    case 'Escape': if (state.selected) { state.selected = null; state.detail = null; renderDetailPlaceholder(); renderMessages(); } break;
  }
});
document.addEventListener('click', (event) => {
  if (event.target.closest('[data-lang-toggle]')) toggleLanguage();
  if (event.target.closest('[data-theme-toggle]')) {
    const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('youhui_theme', next); } catch {}
    document.querySelectorAll('[data-theme-toggle]').forEach((b) => { b.textContent = next === 'dark' ? '☀️' : '🌙'; });
  }
});
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const mailListCache = window.YouhuiMailListCache.create();
window.addEventListener('message', (event) => {
  const frame = $('#mailBody .mail-body-frame');
  if (!frame || event.source !== frame.contentWindow || !event.data || typeof event.data !== 'object' || event.data.type !== 'youhui-mail-frame-height') return;
  const height = Number(event.data.height);
  if (!Number.isFinite(height)) return;
  frame.height = String(Math.min(6000, Math.max(300, Math.ceil(height))));
});
const folderTitles = { INBOX: '收件箱', Starred: '已加星标', Sent: '已发送', Drafts: '草稿', Archive: '归档', Spam: '垃圾邮件', Trash: '已删除' };
const accountColors = ['#368a80','#b78350','#777eae','#ad6e79','#5d87a1','#8974a3'];
const providerIconData = {
  google: { label:'Google', mark:'<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"/></svg>' }, microsoft: { label:'Microsoft', mark:'<span class="provider-ms-grid"><i></i><i></i><i></i><i></i></span>' },
  yahoo: { label:'Yahoo Mail', mark:'y!' }, icloud: { label:'iCloud Mail', mark:'<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M13.762 4.29a6.51 6.51 0 0 0-5.669 3.332 3.571 3.571 0 0 0-1.558-.36 3.571 3.571 0 0 0-3.516 3A4.918 4.918 0 0 0 0 14.796a4.918 4.918 0 0 0 4.92 4.914 4.93 4.93 0 0 0 .617-.045h14.42c2.305-.272 4.041-2.258 4.043-4.589v-.009a4.594 4.594 0 0 0-3.727-4.508 6.51 6.51 0 0 0-6.511-6.27z"/></svg>' }, fastmail: { label:'Fastmail', mark:'F' },
  '163': { label:'网易邮箱', mark:'163' }, qq: { label:'QQ 邮箱', mark:'<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M21.395 15.035a40 40 0 0 0-.803-2.264l-1.079-2.695c.001-.032.014-.562.014-.836C19.526 4.632 17.351 0 12 0S4.474 4.632 4.474 9.241c0 .274.013.804.014.836l-1.08 2.695a39 39 0 0 0-.802 2.264c-1.021 3.283-.69 4.643-.438 4.673.54.065 2.103-2.472 2.103-2.472 0 1.469.756 3.387 2.394 4.771-.612.188-1.363.479-1.845.835-.434.32-.379.646-.301.778.343.578 5.883.369 7.482.189 1.6.18 7.14.389 7.483-.189.078-.132.132-.458-.301-.778-.483-.356-1.233-.646-1.846-.836 1.637-1.384 2.393-3.302 2.393-4.771 0 0 1.563 2.537 2.103 2.472.251-.03.581-1.39-.438-4.673"/></svg>' }, '126': { label:'网易 126', mark:'126' }, yeah: { label:'Yeah.net', mark:'Y' }, sina: { label:'新浪邮箱', mark:'sina' }, exmail: { label:'腾讯企业邮', mark:'TX' }, aliyun: { label:'阿里企业邮', mark:'ALI' }, '139': { label:'移动 139', mark:'139' }, '189': { label:'电信 189', mark:'189' }, yandex: { label:'Yandex', mark:'Y' }, aol: { label:'AOL', mark:'aol' }, zoho: { label:'Zoho Mail', mark:'<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8.66 6.897a1.299 1.299 0 0 0-1.205.765l-.642 1.44-.062-.385A1.291 1.291 0 0 0 5.27 7.648l-4.185.678A1.291 1.291 0 0 0 .016 9.807l.678 4.18a1.293 1.293 0 0 0 1.27 1.087c.074 0 .143-.01.216-.017l4.18-.678c.436-.07.784-.351.96-.723l2.933 1.307a1.304 1.304 0 0 0 .988.026c.321-.12.575-.365.716-.678l.28-.629.038.276a1.297 1.297 0 0 0 1.455 1.103l3.712-.501a1.29 1.29 0 0 0 1.03.514h4.236c.713 0 1.29-.58 1.291-1.291V9.545c0-.712-.58-1.291-1.291-1.291h-4.236c-.079 0-.155.008-.23.022a1.309 1.309 0 0 0-.275-.288c-.275-.21-.614-.3-.958-.253l-4.197.571c-.155.021-.3.07-.432.14L9.159 7.01a1.27 1.27 0 0 0-.499-.113zm-.025.705c.077 0 .159.013.24.052l2.971 1.324c-.128.238-.18.508-.142.782l.357 2.596h.002l-.745 1.672a.59.59 0 0 1-.777.296l-3.107-1.385-.004-.041-.41-2.526L8.1 7.95a.589.589 0 0 1 .536-.348zm-3.159.733c.125 0 .245.039.343.112.13.09.21.227.237.382l.234 1.446-.56 1.259a1.27 1.27 0 0 0-.026.987c.12.322.364.575.678.717l.295.131a.585.585 0 0 1-.428.314l-4.185.678a.59.59 0 0 1-.674-.485l-.678-4.18a.588.588 0 0 1 .485-.674l4.185-.678c.03-.004.064-.01.094-.01zm11.705.09a.59.59 0 0 1 .415.173 1.287 1.287 0 0 0-.416.947v4.237c0 .033.003.065.005.097l-3.55.482a.586.586 0 0 1-.66-.502l-.191-1.403.899-2.017a1.29 1.29 0 0 0-.333-1.5l3.754-.51c.026-.004.051-.004.077-.004zm1.3.532h4.227c.326 0 .588.266.588.588v4.237a.589.589 0 0 1-.588.588h-4.237a.564.564 0 0 1-.12-.013c.47-.246.758-.765.684-1.318zm-5.988.309.254.113c.296.133.43.48.296.777l-.432.97-.207-1.465a.58.58 0 0 1 .09-.395zm5.39.538.453 3.325a.583.583 0 0 1-.453.65zM6.496 11.545l.17 1.052a.588.588 0 0 1-.293-.776zm3.985 4.344a.588.588 0 0 0-.612.603c0 .358.244.61.601.61a.582.582 0 0 0 .607-.608c0-.35-.242-.605-.596-.605zm5.545 0a.588.588 0 0 0-.612.603c0 .358.245.61.602.61a.582.582 0 0 0 .606-.608c0-.35-.24-.605-.596-.605zm-8.537.018a.047.047 0 0 0-.048.047v.085c0 .026.021.047.048.047h.52l-.623.9a.052.052 0 0 0-.009.027v.027c0 .026.021.047.048.047h.815a.047.047 0 0 0 .047-.047v-.085a.047.047 0 0 0-.047-.047h-.55l.606-.9a.05.05 0 0 0 .008-.026v-.028a.047.047 0 0 0-.047-.047zm5.303 0a.047.047 0 0 0-.047.047v1.086c0 .026.02.047.047.047h.135a.047.047 0 0 0 .047-.047v-.454h.545v.454c0 .026.02.047.047.047h.134a.047.047 0 0 0 .047-.047v-1.086a.047.047 0 0 0-.047-.047h-.134a.047.047 0 0 0-.047.047v.453h-.545v-.453a.047.047 0 0 0-.047-.047zm-2.324.164c.25 0 .372.194.372.425 0 .219-.109.425-.358.426-.242 0-.375-.197-.375-.419 0-.235.108-.432.36-.432zm5.545 0c.25 0 .372.194.372.425 0 .219-.108.425-.358.426-.242 0-.374-.197-.374-.419 0-.235.108-.432.36-.432z"/></svg>' },
  custom: { label:'其他邮箱', mark:'✉' }
};
let toastTimer;
let openMessageContext = null;
const pendingMessageActions = new Set();
let composeFiles = [];
let composeReplyMeta = null;
let composeIsReply = false;
let notificationPollTimer = null;
let notificationPollInFlight = false;
let mcpApprovalPollTimer = null;
let mcpApprovalPollInFlight = false;
let mailboxStatusLastPoll = 0;
let mailboxStatusPollTimer = null;
let mailboxStatusPollInFlight = false;
let mcpApprovals = [];
let mcpApprovalPollError = false;
let mcpTokenRevealPermission = '';
async function api(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !['/api/login','/api/setup','/api/status'].includes(url)) showAuth();
    throw new Error(data.error || (I18N_LANG === 'en' ? `Request failed (${response.status})` : `请求失败 (${response.status})`));
  }
  return data;
}
function toast(message, isError = false) {
  const el = $('#toast'); el.textContent = L(message); el.classList.toggle('error', isError); el.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'), 3200);
}
function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (ch) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
}
function initials(value = '') {
  const s = String(value).trim();
    if (!s) return I18N_LANG === 'en' ? 'Y' : '邮';
  const beforeAt = s.includes('@') ? s.slice(0, s.indexOf('@')) : s;
  return [...beforeAt][0]?.toUpperCase() || (I18N_LANG === 'en' ? 'Y' : '邮');
}
function colorClass(value = '') { let sum = 0; for (const c of value) sum = (sum * 31 + c.charCodeAt(0)) >>> 0; return `tone-${sum % accountColors.length}`; }
function accountProviderIcon(account = {}) {
  const raw = String(account.provider || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  const aliases = { gmail:'google', googlemail:'google', googleworkspace:'google', outlook:'microsoft', office365:'microsoft', microsoft365:'microsoft', hotmail:'microsoft', live:'microsoft', ymail:'yahoo', apple:'icloud', netease:'163', qqmail:'qq' };
  let provider = aliases[raw] || raw;
  if (!providerIconData[provider] || provider === 'custom') {
    const domain = String(account.email || '').trim().toLowerCase().split('@').pop();
    const domainProviders = [
      ['google', ['gmail.com','googlemail.com']], ['microsoft', ['outlook.com','hotmail.com','live.com','msn.com']],
      ['yahoo', ['yahoo.com','yahoo.co.jp','yahoo.com.hk','ymail.com']], ['icloud', ['icloud.com','me.com','mac.com']],
      ['fastmail', ['fastmail.com','fastmail.fm']], ['163', ['163.com']], ['126', ['126.com']], ['yeah', ['yeah.net']],
      ['exmail', ['exmail.qq.com']], ['qq', ['qq.com','foxmail.com']], ['sina', ['sina.com','sina.cn']],
      ['139', ['139.com']], ['189', ['189.cn']], ['aliyun', ['qiye.aliyun.com','aliyun.com']],
      ['zoho', ['zoho.com','zoho.eu']], ['yandex', ['yandex.com','yandex.ru']], ['aol', ['aol.com']]
    ];
    provider = domainProviders.find(([,domains]) => domains.some((d) => domain === d || domain.endsWith(`.${d}`)))?.[0] || 'custom';
  }
  const data = providerIconData[provider] || providerIconData.custom;
  return `<span class="provider-icon provider-${provider}" role="img" aria-label="${data.label}" title="${data.label}">${data.mark}</span>`;
}
function dateShort(value) {
  if (!value) return '';
  const date = new Date(value); if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString(UI_LOCALE, { hour:'2-digit', minute:'2-digit' });
  if (date.getFullYear() === now.getFullYear()) return I18N_LANG === 'en' ? `${date.getMonth()+1}/${date.getDate()}` : `${date.getMonth()+1}月${date.getDate()}日`;
  return date.toLocaleDateString(UI_LOCALE, { year:'numeric', month:'numeric', day:'numeric' });
}
function dateLong(value) {
  if (!value) return '';
  const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(UI_LOCALE, { year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit' });
}
function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes/1024).toFixed(0)} KB`;
  return `${(bytes/1048576).toFixed(1)} MB`;
}
function showAuth() {
  clearMcpTokenReveal();
  state.mailListRequestId += 1;
  mailListCache.clear();
  stopNotificationPolling();
  stopMcpApprovalPolling();
  stopMailboxStatusPolling();
  $('#appView').classList.add('hidden'); $('#authView').classList.remove('hidden');
  const needsSetup = state.status?.setupRequired;
  $('#authTitle').textContent = needsSetup ? L('创建你的私人工作台') : L('欢迎回来');
  $('#authCopy').textContent = needsSetup ? L('先设置一个工作台密码，再安全连接你的邮箱。') : L('输入工作台密码，继续管理你的邮箱。');
  $('#authSubmit').textContent = needsSetup ? L('创建并进入') : L('解锁工作台');
  $('#authPassword').autocomplete = needsSetup ? 'new-password' : 'current-password';
  $('#authPassword').minLength = needsSetup ? 12 : 1;
  $('#authHint').textContent = needsSetup ? L('请设置至少 12 位的密码；它只保护此工作台，不会发送给邮箱服务商。') : L('登录密码只用于解锁此工作台。');
  const enabled = state.status?.identityProviders || {};
  let visible = false;
  $$('[data-external-login]').forEach((button) => {
    const show = !needsSetup && Boolean(enabled[button.dataset.externalLogin]);
    button.classList.toggle('hidden', !show); visible ||= show;
  });
  $('#externalLoginOptions').classList.toggle('hidden', !visible);
}
async function boot() {
  applyI18nDom(); syncLangToggle(); document.documentElement.lang = I18N_LANG === 'en' ? 'en' : 'zh-CN';
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  try {
    state.status = await api('/api/status');
    if (state.status.authenticated) await showApp(); else showAuth();
    const params = new URLSearchParams(location.search);
    if (params.get('oauth') === 'connected') { history.replaceState({}, '', '/'); toast(L('邮箱已通过 OAuth 授权并连接。')); }
    if (params.get('oauth_error')) { history.replaceState({}, '', '/'); toast(`${L('OAuth 连接失败：')}${params.get('oauth_error')}`, true); }
    if (params.get('identity') === 'connected') { history.replaceState({}, '', '/'); toast(L('已使用已绑定身份解锁工作台。')); }
    if (params.get('identity_linked')) { const provider=params.get('identity_linked'); history.replaceState({}, '', '/'); toast(`${provider} ${L(' 身份已绑定。')}`); if (state.status.authenticated) void openSettings('oauth'); }
    if (params.get('identity_error')) { const reason=params.get('identity_error'); history.replaceState({}, '', '/'); toast(reason==='unbound'?L('此身份尚未绑定，仍可使用工作台密码解锁。'):L('第三方登录未完成；请检查配置或重新尝试。'), true); }
  } catch (error) { showAuth(); toast(error.message, true); }
}
$('#authForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = $('#authPassword').value;
  const setup = state.status?.setupRequired;
  const button = $('#authSubmit'); button.disabled = true; button.textContent = setup ? L('正在创建…') : L('正在解锁…');
  try {
    await api(setup ? '/api/setup' : '/api/login', { method:'POST', body:JSON.stringify({ password }) });
    $('#authPassword').value = ''; state.status = { ...state.status, setupRequired:false, authenticated:true }; await showApp();
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; button.textContent = setup ? L('创建并进入') : L('解锁工作台'); }
});
async function startExternalLogin(provider, flow = 'login') {
  try {
    const data = await api(`/api/identity/${encodeURIComponent(provider)}/start?flow=${encodeURIComponent(flow)}`);
    location.href = data.url;
  } catch (error) { toast(error.message, true); }
}
$$('[data-external-login]').forEach((button) => button.addEventListener('click', () => startExternalLogin(button.dataset.externalLogin, 'login')));
async function showApp() {
  $('#authView').classList.add('hidden'); $('#appView').classList.remove('hidden');
  startMcpApprovalPolling();
  await loadAccounts(); await loadFolders(); await loadMessages(); await loadAIConfig(); await loadTranslationConfig(); await loadNotificationConfig(); await loadOAuthConfig();
  startNotificationPolling();
  startMailboxStatusPolling();
}
async function refreshMailboxStatuses() {
  if (mailboxStatusPollInFlight || $('#appView').classList.contains('hidden')) return;
  mailboxStatusPollInFlight = true;
  try {
    const data = await api('/api/accounts');
    state.accounts = Array.isArray(data.accounts) ? data.accounts : [];
    if ($('#settingsDialog')?.open && !$('#settingsPanelAccounts').classList.contains('hidden')) renderManagedAccounts();
  } catch {}
  finally { mailboxStatusPollInFlight = false; }
}
function startMailboxStatusPolling() {
  stopMailboxStatusPolling();
  mailboxStatusPollTimer = setInterval(() => {
    if ($('#settingsDialog')?.open && !$('#settingsPanelAccounts').classList.contains('hidden')) void refreshMailboxStatuses();
  }, 15_000);
}
function stopMailboxStatusPolling() {
  if (mailboxStatusPollTimer) clearInterval(mailboxStatusPollTimer);
  mailboxStatusPollTimer = null; mailboxStatusPollInFlight = false;
}
async function loadAccounts() {
  try {
    const data = await api('/api/accounts'); state.accounts = data.accounts; state.defaultAccountId = data.defaultAccountId || ''; state.status.oauthProviders = data.oauthProviders;
    if (state.defaultAccountId && state.accounts.some((account) => account.id === state.defaultAccountId)) state.accountId = state.defaultAccountId;
    else if (!state.accounts.some((account) => account.id === state.accountId)) state.accountId = 'all';
    renderAccountNav(); renderAccountFilter(); renderComposeAccounts(); renderDefaultMailbox(); updateNotificationScopeNote();
    if ($('#settingsDialog')?.open) renderManagedAccounts();
  } catch (error) { toast(error.message, true); }
}
async function loadFolders() {
  try { state.folders = (await api('/api/folders')).folders; } catch { state.folders = []; }
  renderCustomFolders();
}
function renderCustomFolders() {
  const root = $('#customFolderNav'); if (!root) return;
  const knownNames = new Set(['inbox','sent','sent items','已发送','已发邮件','draft','drafts','草稿','archive','all mail','所有邮件','归档','trash','deleted items','deleted messages','已删除','垃圾箱','junk','spam','bulk','垃圾邮件']);
  const items = state.folders.filter((f) => !knownNames.has(String(f.name || f.path).split('/').at(-1).toLowerCase()) && String(f.path).toUpperCase() !== 'INBOX');
  root.innerHTML = items.length ? `<div class="custom-label">${L('其他文件夹')}</div>` + items.map((f) => `<button class="nav-item custom-folder-item ${state.folder === f.path && state.accountId === f.accountId ? 'active' : ''}" data-custom-path="${escapeHtml(f.path)}" data-account="${escapeHtml(f.accountId)}" title="${escapeHtml(f.path)}"><span class="nav-icon">▤</span><span class="account-label">${escapeHtml(f.name || f.path)}</span><small class="custom-account-label">${escapeHtml(f.accountEmail)}</small></button>`).join('') : '';
  root.querySelectorAll('[data-custom-path]').forEach((button) => button.addEventListener('click', () => { state.folder=button.dataset.customPath; state.accountId=button.dataset.account; state.cursor=null;state.cursorStack.length=0; state.selected=null; state.detail=null; renderTitles(); renderAccountFilter(); renderAccountNav(); renderCustomFolders(); renderDetailPlaceholder(); loadMessages(); closeSidebar(); }));
}
function renderAccountNav() {
  const root = $('#accountNav');
  root.innerHTML = state.accounts.map((account) => `
    <button class="nav-item account-filter-item ${state.accountId === account.id ? 'active' : ''}" data-account="${escapeHtml(account.id)}" title="${escapeHtml(account.email)}">
      ${accountProviderIcon(account)}
      <span class="account-label">${escapeHtml(account.label || account.email)}</span>
    </button>`).join('');
}
function renderAccountFilter() {
  const select = $('#accountFilter');
  select.innerHTML = `<option value="all">${L('所有邮箱')}</option>` + state.accounts.map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.label || a.email)}</option>`).join('');
  select.value = state.accountId;
}
function renderDefaultMailbox() {
  const select = $('#defaultMailboxSelect');
  if (!select) return;
  select.innerHTML = `<option value="">${L('所有邮箱（不指定默认邮箱）')}</option>` + state.accounts.map((account) => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.label || account.email)} · ${escapeHtml(account.email)}</option>`).join('');
  select.value = state.defaultAccountId;
}
function renderComposeAccounts(preferred = '') {
  const select = $('#composeFrom');
  select.innerHTML = state.accounts.map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.label || a.email)} · ${escapeHtml(a.email)}</option>`).join('');
  if (preferred && state.accounts.some((a) => a.id === preferred)) select.value = preferred;
  else if (state.accountId !== 'all' && state.accounts.some((a) => a.id === state.accountId)) select.value = state.accountId;
}
function setFolder(folder) {
  state.folder = folder; state.cursor = null; state.cursorStack.length = 0; state.selected = null; state.detail = null;
  $$('.folder-nav .nav-item').forEach((button) => button.classList.toggle('active', button.dataset.folder === folder));
  renderTitles(); renderDetailPlaceholder(); loadMessages();
}
function renderTitles() {
  const title = L(folderTitles[state.folder] || state.folder);
  $('#currentFolderTitle').textContent = title; $('#listTitle').textContent = title;
}
function renderEmpty() {
  const empty = $('#listEmpty');
  const hasAccounts = state.accounts.length > 0;
  $('#emptyTitle').textContent = hasAccounts ? L('这里暂时没有邮件') : L('连接你的第一个邮箱');
  $('#emptyCopy').textContent = hasAccounts ? L('试试切换文件夹，或用搜索框查找历史邮件。') : L('连接 Gmail、Outlook、Yahoo、163、QQ 或其他 IMAP 邮箱，邮件会实时同步到这里。');
  $('#emptyAddButton').classList.toggle('hidden', hasAccounts);
  empty.classList.remove('hidden'); $('#messageList').innerHTML = '';
}
function renderMessageListData(data, source) {
  const incoming = Array.isArray(data?.messages) ? data.messages : [];
  state.messages = incoming.map((message) => ({ ...message }));
  const total = Number(data?.total);
  state.total = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : state.messages.length;
  if (source === 'cache') {
    $('#syncBanner').textContent = L('显示上次缓存，正在后台刷新…');
    $('#syncBanner').classList.remove('hidden');
  } else if (Array.isArray(data?.errors) && data.errors.length) {
    $('#syncBanner').textContent = data.errors.map((error) => `${state.accounts.find((account) => account.id === error.accountId)?.email || L('邮箱')}：${error.error}`).join(' · ');
    $('#syncBanner').classList.remove('hidden');
  } else {
    $('#syncBanner').classList.add('hidden');
  }
  state.hasMore = data?.hasMore === true;
  $('#messageCount').textContent = state.total > 99 ? '99+' : String(state.total);
  $('#inboxUnread').textContent = state.folder === 'INBOX' ? String(incoming.filter((message) => message.unread).length || '') : '';
  if (state.olderFirst) state.messages.reverse();
  if (state.threadView) {
    const threads = {};
    for (const m of state.messages) {
      const key = m.threadKey || (m.subject || '').toLowerCase();
      if (!threads[key]) { threads[key] = { ...m, threadCount: 1, threadIds: [m] }; }
      else { threads[key].threadCount++; threads[key].threadIds.push(m); if (new Date(m.date) > new Date(threads[key].date)) { threads[key].date = m.date; threads[key].subject = m.subject; } }
    }
    state.messages = Object.values(threads).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    if (!state.olderFirst) state.messages.reverse();
  }
  if (!state.messages.length) renderEmpty();
  else { $('#listEmpty').classList.add('hidden'); renderMessages(); }
  const hasPages = state.cursorStack.length > 0 || state.hasMore;
  $('#listPagination').classList.toggle('hidden', !hasPages);
  $('#pageLabel').textContent = I18N_LANG === 'en' ? `Page ${state.cursorStack.length + 1}` : `第 ${state.cursorStack.length + 1} 页`;
  $('#prevPage').disabled = !state.cursorStack.length;
  $('#nextPage').disabled = !state.hasMore;
}
function currentListScope() {
  // page 字段承载游标键（按账户的 UID 映射），让缓存按"第一页/各游标页"区分
  return { accountId: state.accountId, folder: state.folder, page: state.cursor ? `u${JSON.stringify(state.cursor)}` : 1, query: state.query };
}
async function loadMessages() {
  if ($('#appView').classList.contains('hidden')) return;
  const scope = currentListScope();
  const requestId = ++state.mailListRequestId;
  const list = $('#messageList');
  let hasCachedList = false;
  $('#listEmpty').classList.add('hidden'); $('#syncBanner').classList.add('hidden');
  // 翻页用按账户的 beforeUid 游标，避免新邮件导致跨页重复；是否有下一页由响应的 hasMore 决定
  const params = new URLSearchParams({ folder:scope.folder, accountId:scope.accountId, limit:'30' });
  if (state.query) params.set('q', state.query);
  if (state.cursor) params.set('beforeUid', JSON.stringify(state.cursor));
  try {
    const refresh = mailListCache.load(scope, () => api(`/api/mail?${params}`), (data, source) => {
      if (requestId !== state.mailListRequestId) return;
      if (source === 'cache') hasCachedList = true;
      renderMessageListData(data, source);
    });
    if (!hasCachedList) {
      list.innerHTML = `<div class="loading"><span class="spinner"></span>${L('正在从邮箱服务器读取…')}</div>`;
      $('#listEmpty').classList.add('hidden');
    }
    await refresh;
  } catch (error) {
    if (requestId !== state.mailListRequestId) return;
    if (hasCachedList) {
      $('#syncBanner').textContent = `${L('邮件列表暂时无法刷新，继续显示上次缓存：')}${error.message}`;
      $('#syncBanner').classList.remove('hidden');
      return;
    }
    state.messages = []; state.total = 0; list.innerHTML = ''; $('#messageCount').textContent = '—';
    $('#listPagination').classList.add('hidden');
    $('#listEmpty').classList.remove('hidden'); $('#emptyTitle').textContent = L('邮件暂时无法读取'); $('#emptyCopy').textContent = error.message; $('#emptyAddButton').classList.toggle('hidden', state.accounts.length > 0);
  }
}
function renderMessages() {
  const list = $('#messageList');
  closeMessageContextMenu();
  const scrollTop = list.scrollTop;
  list.innerHTML = state.messages.map((m, index) => {
    const sender = m.from?.[0]?.name || m.from?.[0]?.address || L('未知发件人');
    const fromEmail = m.from?.[0]?.address || '';
    const account = state.accounts.find((a) => a.id === m.accountId);
    const preview = fromEmail && sender !== fromEmail ? fromEmail : (account && state.accounts.length > 1 ? account.email : '');
    const selected = state.selected && state.selected.uid === m.uid && state.selected.accountId === m.accountId;
    const threadBadge = m.threadCount > 1 ? `<span class="thread-badge">${m.threadCount}</span>` : '';
    return `<article class="message-row ${m.unread?'unread':''} ${selected?'selected':''}" data-idx="${index}" tabindex="0" role="button" aria-haspopup="menu" aria-expanded="false" aria-label="${L('打开邮件：')}${escapeHtml(m.subject)}">
      <span class="sender-avatar ${colorClass(fromEmail || sender)}">${escapeHtml(initials(sender))}</span>
      <div class="message-content"><div class="message-line"><span class="message-sender">${escapeHtml(sender)}${threadBadge}</span><time class="message-time">${escapeHtml(dateShort(m.date))}</time></div>
      <div class="message-subject">${escapeHtml(m.subject || L('(无主题)'))}</div><div class="message-preview">${escapeHtml(preview || L('点击查看邮件内容'))}</div>
      <div class="message-foot"><span class="mail-chip">${escapeHtml(account?.label || account?.email || m.accountEmail || '')}</span>${m.flagged?'<span class="star-mark">★</span>':''}</div></div></article>`;
  }).join('');
  $$('.message-row', list).forEach((row) => {
    row.addEventListener('click', () => openMessage(Number(row.dataset.idx)));
    row.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      openMessageContextMenu(state.messages[Number(row.dataset.idx)], row, event.clientX, event.clientY);
    });
    row.addEventListener('keydown', (event) => {
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault();
        const bounds = row.getBoundingClientRect();
        openMessageContextMenu(state.messages[Number(row.dataset.idx)], row, bounds.left + 18, bounds.bottom - 4);
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openMessage(Number(row.dataset.idx)); }
    });
  });
  list.scrollTop = scrollTop;
}
function sameMessage(left, right) {
  return Boolean(left && right && String(left.accountId) === String(right.accountId) && String(left.uid) === String(right.uid) && String(left.folder || state.folder) === String(right.folder || state.folder));
}
function messageActionKey(message) {
  return `${String(message?.accountId || '')}:${String(message?.folder || state.folder)}:${String(message?.uid ?? '')}`;
}
function closeMessageContextMenu({ restoreFocus = false } = {}) {
  const menu = $('#messageContextMenu');
  const trigger = openMessageContext?.trigger;
  if (!menu && !openMessageContext) return;
  openMessageContext = null;
  if (menu) { menu.classList.add('hidden'); menu.replaceChildren(); }
  trigger?.setAttribute('aria-expanded', 'false');
  if (restoreFocus && trigger?.isConnected) trigger.focus();
}
function ensureMessageContextMenu() {
  const existing = $('#messageContextMenu');
  if (existing) return existing;
  const menu = document.createElement('div');
  menu.id = 'messageContextMenu';
  menu.className = 'mail-context-menu hidden';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', L('邮件操作'));
  menu.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-context-action]');
    if (!button || button.disabled || !openMessageContext) return;
    event.preventDefault();
    const message = openMessageContext.message;
    const action = button.dataset.contextAction;
    closeMessageContextMenu({ restoreFocus: true });
    void performMessageAction(action, message);
  });
  menu.addEventListener('keydown', (event) => {
    const items = $$('[role="menuitem"]:not(:disabled)', menu);
    const current = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const offset = event.key === 'ArrowDown' ? 1 : -1;
      items[(current + offset + items.length) % items.length]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      items[event.key === 'Home' ? 0 : items.length - 1]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeMessageContextMenu({ restoreFocus: true });
    } else if (event.key === 'Tab') {
      closeMessageContextMenu({ restoreFocus: true });
    }
  });
  document.body.append(menu);
  document.addEventListener('pointerdown', (event) => {
    if (!menu.classList.contains('hidden') && !menu.contains(event.target)) closeMessageContextMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && openMessageContext && !menu.contains(document.activeElement)) closeMessageContextMenu({ restoreFocus: true });
  });
  window.addEventListener('resize', () => closeMessageContextMenu());
  document.addEventListener('scroll', () => closeMessageContextMenu(), true);
  return menu;
}
function openMessageContextMenu(message, trigger, x, y) {
  if (!message || !trigger) return;
  const actions = window.YouhuiMailContextActions.buildMessageActions(message, state.folder, state.folders);
  const menu = ensureMessageContextMenu();
  closeMessageContextMenu();
  openMessageContext = { message, trigger };
  menu.replaceChildren();
  const key = messageActionKey(message);
  actions.forEach((item) => {
    if (item.destructive) {
      const separator = document.createElement('div');
      separator.className = 'mail-context-separator';
      separator.setAttribute('role', 'separator');
      menu.append(separator);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `mail-context-item${item.destructive ? ' is-danger' : ''}`;
    button.setAttribute('role', 'menuitem');
    button.tabIndex = -1;
    button.dataset.contextAction = item.action;
    button.disabled = pendingMessageActions.has(key);
    button.textContent = L(item.label);
    menu.append(button);
  });
  menu.style.left = '0px'; menu.style.top = '0px';
  menu.classList.remove('hidden');
  const bounds = menu.getBoundingClientRect();
  const margin = 8;
  menu.style.left = `${Math.max(margin, Math.min(x, window.innerWidth - bounds.width - margin))}px`;
  menu.style.top = `${Math.max(margin, Math.min(y, window.innerHeight - bounds.height - margin))}px`;
  trigger.setAttribute('aria-expanded', 'true');
  menu.querySelector('[role="menuitem"]:not(:disabled)')?.focus();
}
function writeCurrentMessageListCache() {
  const messages = state.olderFirst ? [...state.messages].reverse() : [...state.messages];
  mailListCache.write(
    currentListScope(),
    { messages, total: state.total }
  );
}
function updateDetailMessageActions(message) {
  if (!sameMessage(state.selected, message)) return;
  state.selected.unread = message.unread;
  state.selected.flagged = message.flagged;
  const pane = $('#detailPane');
  const readButton = $('[data-action="read"], [data-action="unread"]', pane);
  if (readButton) {
    const action = message.unread ? 'read' : 'unread';
    const label = message.unread ? L('标为已读') : L('标为未读');
    readButton.dataset.action = action; readButton.title = label; readButton.setAttribute('aria-label', label);
  }
  const starButton = $('[data-action="star"], [data-action="unstar"]', pane);
  if (starButton) {
    const action = message.flagged ? 'unstar' : 'star';
    const label = message.flagged ? L('取消星标') : L('加星标');
    starButton.dataset.action = action; starButton.title = label; starButton.setAttribute('aria-label', label);
    starButton.textContent = message.flagged ? '★' : '☆';
  }
}
async function performMessageAction(action, message) {
  const supported = ['read', 'unread', 'star', 'unstar', 'archive', 'delete'];
  if (!message || !supported.includes(action)) return;
  const key = messageActionKey(message);
  if (pendingMessageActions.has(key)) return;
  pendingMessageActions.add(key);
  try {
    if (action === 'delete' || action === 'archive') {
      const isTrash = action === 'delete';
      const title = isTrash ? '移到垃圾箱？' : '归档这封邮件？';
      const copy = isTrash ? '邮件会移到此邮箱的“已删除”文件夹；通常可在清空垃圾箱前恢复。' : '邮件会移动到此邮箱的归档文件夹。';
      if (!await askConfirm(title, copy, isTrash ? '移到垃圾箱' : '归档', isTrash)) return;
    }
    await api(`/api/message/${encodeURIComponent(message.accountId)}/${message.uid}/action`, {
      method: 'POST', body: JSON.stringify({ folder: message.folder || state.folder, action })
    });
    if (action === 'archive' || action === 'delete') {
      const countBefore = state.messages.length;
      state.messages = state.messages.filter((item) => !sameMessage(item, message));
      state.total = Math.max(0, state.total - (countBefore - state.messages.length));
      if (sameMessage(state.selected, message)) {
        state.selected = null; state.detail = null; renderDetailPlaceholder();
      }
    } else {
      if (action === 'read') message.unread = false;
      if (action === 'unread') message.unread = true;
      if (action === 'star') message.flagged = true;
      if (action === 'unstar') message.flagged = false;
      updateDetailMessageActions(message);
    }
    writeCurrentMessageListCache();
    renderMessages();
    toast(({ read:'已标为已读', unread:'已标为未读', star:'已加星标', unstar:'已取消星标', archive:'邮件已归档', delete:'邮件已移到垃圾箱' })[action] || '已完成');
    await loadMessages();
  } catch (error) { toast(error.message, true); }
  finally { pendingMessageActions.delete(key); }
}
function renderDetailPlaceholder() {
  const pane = $('#detailPane'); pane.classList.remove('mobile-open'); pane.classList.add('empty-detail');
  $('#appView').classList.remove('mobile-reading');
  pane.innerHTML = `<div class="detail-placeholder"><div class="placeholder-icon">✉</div><h2>${L('选一封邮件开始阅读')}</h2><p>${L('你的邮件会安全地从对应邮箱实时读取。')}</p></div>`;
}
function addressText(list = []) { return list.map((x) => x.name ? `${x.name} <${x.address}>` : x.address).join(', '); }
function normalizeClientCid(value = '') {
  let cid = String(value || '').trim().replace(/^cid:/i, '').replace(/^<|>$/g, '').trim();
  try { cid = decodeURIComponent(cid); } catch {}
  return cid.toLowerCase();
}
async function openMessage(index) {
  const message = state.messages[index]; if (!message) return;
  state.selected = message; state.detail = null; updateAIControls(); renderMessages();
  const pane = $('#detailPane'); pane.classList.remove('empty-detail'); pane.classList.add('mobile-open');
  $('#appView').classList.add('mobile-reading');
  pane.scrollTop = 0;
  pane.innerHTML = `<div class="loading"><span class="spinner"></span>${L('正在读取邮件正文…')}</div>`;
  try {
    // attachments=meta：只取附件元数据；附件与超预算的内嵌图按需从附件端点获取
    const params = new URLSearchParams({ folder:message.folder || state.folder, attachments:'meta' });
    const detail = await api(`/api/message/${encodeURIComponent(message.accountId)}/${message.uid}?${params}`);
    state.detail = detail; message.unread = false; renderMessages(); renderDetail(detail, message); updateAIControls();
  } catch (error) { pane.innerHTML = `<div class="detail-placeholder"><div class="placeholder-icon">!</div><h2>${L('邮件读取失败')}</h2><p>${escapeHtml(error.message)}</p><button class="button button-quiet detail-back">${L('返回')}</button></div>`; $('.detail-back', pane)?.addEventListener('click', closeDetailMobile); }
}
function renderDetail(detail, message) {
  const account = state.accounts.find((a) => a.id === detail.accountId);
  const sender = detail.from?.[0]?.name || detail.from?.[0]?.address || L('未知发件人');
  const to = addressText(detail.to) || detail.email;
  const pane = $('#detailPane'); pane.classList.remove('empty-detail');
  pane.innerHTML = `<article class="detail-view">
    <div class="detail-toolbar"><button class="icon-button detail-back" data-action="back" aria-label="${L('返回邮件列表')}" title="${L('返回')}">←</button><div class="detail-actions">
      <button class="icon-button" data-action="archive" title="${L('归档')}" aria-label="${L('归档')}">▣</button><button class="icon-button" data-action="delete" title="${L('移到已删除')}" aria-label="${L('移到已删除')}">⌫</button>
      <button class="icon-button" data-action="${message.unread?'read':'unread'}" title="${message.unread?L('标为已读'):L('标为未读')}" aria-label="${message.unread?L('标为已读'):L('标为未读')}">◉</button><button class="icon-button" data-action="${message.flagged?'unstar':'star'}" title="${message.flagged?L('取消星标'):L('加星标')}" aria-label="${message.flagged?L('取消星标'):L('加星标')}">${message.flagged?'★':'☆'}</button><button class="icon-button" data-action="translate" title="${L('使用已配置的专用翻译 API 翻译为简体中文')}" aria-label="${L('翻译为简体中文')}">译</button><button class="icon-button" data-action="eml" title="${L('导出为 .eml 文件')}" aria-label="${L('导出为 .eml 文件')}">⬇</button>
    </div><button class="icon-button" data-action="refresh" title="${L('刷新邮件')}">⟳</button></div>
    <h1 class="detail-subject">${escapeHtml(detail.subject || L('(无主题)'))}</h1>
    <div class="sender-meta"><span class="sender-avatar ${colorClass(detail.from?.[0]?.address || sender)}">${escapeHtml(initials(sender))}</span><div class="sender-info"><div class="sender-info-main"><strong>${escapeHtml(sender)}</strong><span>&lt;${escapeHtml(detail.from?.[0]?.address || '')}&gt;</span></div><div class="sender-detail-line">${L('发给 ')}${escapeHtml(to)}${detail.cc?.length ? ` · ${L('抄送 ')}${escapeHtml(addressText(detail.cc))}` : ''}</div></div><time class="detail-date">${escapeHtml(dateLong(detail.date))}</time></div>
    <div class="detail-divider"></div>
    <div class="mail-body" id="mailBody"></div>
    <section id="mailTranslation" class="mail-translation hidden" aria-live="polite" aria-label="${L('简体中文译文')}"></section>
    ${detail.attachments?.length ? `<div class="attachment-list">${detail.attachments.map((a,i)=>`<a class="attachment-link" download="${escapeHtml(a.filename)}" href="/api/message/${encodeURIComponent(detail.accountId)}/${encodeURIComponent(message.uid)}/attachment/${i}?folder=${encodeURIComponent(message.folder || state.folder)}"><span class="attachment-icon">⌑</span><span>${escapeHtml(a.filename)}<br><small>${escapeHtml(formatSize(a.size))}</small></span></a>`).join('')}</div>`:''}
    <div class="detail-account-tag"><span class="status-dot"></span>${escapeHtml(account?.label || account?.email || detail.email)} · ${L('原始邮箱')}</div>
    <div class="detail-actions-bottom"><button class="button button-primary" data-action="reply">↶ ${L('回复')}</button></div>
  </article>`;
  const body = $('#mailBody', pane);
  if (detail.html) {
    const emailHtml = String(detail.html);
    const inertTemplate = document.createElement('template');
    inertTemplate.innerHTML = emailHtml;
    const remoteImageCount = inertTemplate.content.querySelectorAll('img[data-external-src]').length;
    const frame = document.createElement('iframe');
    frame.className = 'mail-body-frame';
    frame.title = L('邮件正文');
    frame.setAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox');
    frame.referrerPolicy = 'no-referrer';
    frame.height = '320';
    frame.src = '/mail-frame';
    // 超出内联预算的 cid 图片在服务端被标记为 data-cid-src；这里按需取回后回填到沙箱内
    const attachmentByCid = new Map();
    for (const item of detail.attachments || []) {
      if (item.inline && item.contentId) attachmentByCid.set(normalizeClientCid(item.contentId), item);
    }
    const pendingCids = [...inertTemplate.content.querySelectorAll('img[data-cid-src]')]
      .map((image) => normalizeClientCid(image.getAttribute('data-cid-src')))
      .filter((cid, index, all) => cid && all.indexOf(cid) === index && attachmentByCid.has(cid));
    const resolveInlineImages = async () => {
      const folder = message.folder || state.folder;
      for (const cid of pendingCids) {
        const index = (detail.attachments || []).indexOf(attachmentByCid.get(cid));
        try {
          const response = await fetch(`/api/message/${encodeURIComponent(detail.accountId)}/${encodeURIComponent(message.uid)}/attachment/${index}?folder=${encodeURIComponent(folder)}&disposition=inline`, { credentials: 'same-origin' });
          if (!response.ok) continue;
          const blob = await response.blob();
          const src = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('inline image read failed')); reader.readAsDataURL(blob); });
          frame.contentWindow?.postMessage({ type: 'render-cid-image', cid, src }, '*');
        } catch {}
      }
    };
    frame.addEventListener('load', () => {
      frame.contentWindow?.postMessage({ type: 'render-email', html: emailHtml }, '*');
      void resolveInlineImages();
    }, { once: true });
    if (remoteImageCount) {
      const notice = document.createElement('div'); notice.className = 'remote-image-notice';
      const copy = document.createElement('p'); copy.textContent = I18N_LANG === 'en' ? `This message contains ${remoteImageCount} remote images, blocked by default. Loading them may reveal your IP address and visit time to the image host.` : `此邮件包含 ${remoteImageCount} 张远程图片，默认未加载。加载后，图片来源网站可能获知你的 IP 地址和访问时间。`;
      const load = document.createElement('button'); load.type = 'button'; load.textContent = L('加载外部图片');
      load.addEventListener('click', () => { frame.contentWindow?.postMessage({ type: 'load-remote-images' }, '*'); notice.remove(); }, { once:true });
      notice.append(copy, load); body.append(notice);
    }
    body.append(frame);
  } else { const pre = document.createElement('div'); pre.className='mail-body-text'; pre.textContent = detail.text || L('(此邮件没有可显示的正文。)'); body.append(pre); }
  $$('[data-action]', pane).forEach((button) => button.addEventListener('click', () => handleDetailAction(button.dataset.action, message, detail)));
}
function closeDetailMobile() {
  $('#detailPane').classList.remove('mobile-open');
  $('#appView').classList.remove('mobile-reading');
}
async function handleDetailAction(action, message, detail) {
  if (action === 'back') return closeDetailMobile();
  if (action === 'refresh') return openMessage(state.messages.findIndex((m) => m.uid === message.uid && m.accountId === message.accountId));
  if (action === 'translate') return translateEmail(detail);
  if (action === 'eml') {
    const folder = message.folder || state.folder;
    window.open(`/api/message/${encodeURIComponent(detail.accountId)}/${encodeURIComponent(message.uid)}/eml?folder=${encodeURIComponent(folder)}`, '_blank');
    return;
  }
  if (action === 'reply') return openCompose({ accountId:detail.accountId, to:detail.from?.[0]?.address || '', subject:/^re:/i.test(detail.subject)?detail.subject:`Re: ${detail.subject}`, inReplyTo:detail.messageId || detail.inReplyTo, references:[detail.references,detail.messageId].filter(Boolean).join(' '), quoted:`\n\n—— 原邮件 ——\n${detail.text || '[HTML 邮件内容]'}\n` });
  if (['read', 'unread', 'star', 'unstar', 'archive', 'delete'].includes(action)) return performMessageAction(action, message);
}
function normalizeTranslationSpacing(value) {
  return String(value || '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ')
    .split('\n').map((line) => line.trimEnd()).join('\n')
    .replace(/\n(?:[ \t]*\n){2,}/g, '\n\n').trim();
}
function mailTextForTranslation(detail) {
  const text = String(detail?.text || '').trim();
  if (text) return text;
  if (!detail?.html) return '';
  const parsed = new DOMParser().parseFromString(detail.html, 'text/html');
  parsed.querySelectorAll('script,style,noscript').forEach((node) => node.remove());
  return String(parsed.body?.textContent || '').replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n').trim();
}
async function translateEmail(detail) {
  const source = mailTextForTranslation(detail);
  if (!source) { toast(L('这封邮件没有可翻译的正文。'), true); return; }
  if (!state.translationConfig) await loadTranslationConfig();
  if (!state.translationConfig?.configured) {
    await openSettings('translation');
    translationSettingsStatus('请先填写并保存当前翻译服务商的凭据。');
    return;
  }
  const button = $('#detailPane [data-action="translate"]');
  const panel = $('#mailTranslation');
  if (!button || !panel || button.disabled) return;
  const sourceLimit = 12_000;
  const truncated = source.length > sourceLimit;
  let text = source.slice(0, sourceLimit);
  if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
  const showResult = (text, isError = false) => {
    panel.classList.remove('hidden'); panel.classList.toggle('error', isError); panel.replaceChildren();
    const heading = document.createElement('strong'); heading.className = 'mail-translation-heading'; heading.textContent = L('简体中文译文');
    const body = document.createElement('div'); body.className = 'mail-translation-content'; body.textContent = text;
    panel.append(heading, body); return body;
  };
  button.disabled = true; button.setAttribute('aria-busy', 'true');
  showResult(L('正在翻译…'));
  try {
    const result = await api('/api/translation/translate', { method:'POST', body:JSON.stringify({ text }) });
    const translation = normalizeTranslationSpacing(result.translation);
    if (!translation) throw new Error(L('翻译服务没有返回译文。'));
    const body = showResult(translation);
    const note = document.createElement('small'); note.className = 'mail-translation-note';
  const providerName = ({niutrans:L('小牛翻译'),google:'Google Cloud Translation',azure:'Azure Translator'})[result.provider] || L('专用翻译 API');
  note.textContent = `${truncated ? L('邮件较长，本次仅发送前 12,000 个字符；') : ''}${L('由')}${providerName}${L('，请核对译文中的日期、金额和专有名词。')}`;
    panel.append(note);
  } catch (error) { showResult(error.message || '翻译失败，请稍后重试。', true); }
  finally { button.disabled = false; button.removeAttribute('aria-busy'); }
}
function openCompose(options = {}) {
  if (!state.accounts.length) { toast('请先连接一个邮箱账户。', true); return openAccountDialog(); }
  $('#composeForm').reset(); $('#composeError').classList.add('hidden'); $('#composeTitle').textContent = options.to ? L('回复邮件') : L('新邮件');
  composeReplyMeta = options.to ? { accountId: options.accountId || '', inReplyTo: options.inReplyTo || '', references: options.references || '' } : null;
  composeIsReply = Boolean(options.to);
  composeFiles = []; renderComposeFiles();
  renderComposeAccounts(options.accountId || '');
  $('#composeTo').value = options.to || ''; $('#composeSubject').value = options.subject || '';
  $('#composeBody').value = options.quoted || ''; $('#composeCc').value = '';
  $('#composeDialog').showModal();
  if (options.to) $('#composeBody').focus(); else $('#composeTo').focus();
}
$('#composeButton').addEventListener('click', () => openCompose());
$('#composeForm').addEventListener('submit', async (event) => {
  event.preventDefault(); $('#composeError').classList.add('hidden');
  const button = $('#sendButton'); button.disabled = true; button.innerHTML = `<span class="spinner"></span>${L('正在发送…')}`;
  const detail = state.detail;
  const payload = { accountId:$('#composeFrom').value, to:$('#composeTo').value, cc:$('#composeCc').value, subject:$('#composeSubject').value, text:$('#composeBody').value, attachments:composeFiles };
  if (composeIsReply && composeReplyMeta) { payload.inReplyTo = composeReplyMeta.inReplyTo; payload.references = composeReplyMeta.references; }
  else if (detail && composeIsReply) { payload.inReplyTo = detail.messageId || detail.inReplyTo; payload.references = [detail.references, detail.messageId].filter(Boolean).join(' '); }
  try {
    if ($('#scheduleEnabled')?.checked) {
      const scheduledAt = new Date($('#scheduleTime').value).getTime();
      if (!scheduledAt || scheduledAt <= Date.now()) { $('#composeError').textContent = L('定时发送时间无效，请选择未来时间。'); $('#composeError').classList.remove('hidden'); return; }
      payload.scheduledAt = scheduledAt;
      const result = await api('/api/schedule', { method:'POST', body:JSON.stringify(payload) });
      $('#composeDialog').close(); toast(L('定时发送已安排。')); composeFiles = []; renderComposeFiles();
      return;
    }
    const result = await api('/api/send', { method:'POST', body:JSON.stringify(payload) });
    $('#composeDialog').close(); toast(result.warning || result.message || L('邮件已发送。'), Boolean(result.warning)); composeFiles = []; renderComposeFiles();
    if (state.folder === 'Sent') await loadMessages();
  } catch (error) { $('#composeError').textContent = error.message; $('#composeError').classList.remove('hidden'); }
  finally { button.disabled = false; button.innerHTML = `<span>${L('发送邮件')}</span><span>↗</span>`; }
});
$('#composeMinimize').addEventListener('click', () => $('#composeDialog').close());
$('#scheduleEnabled').addEventListener('change', (e) => { $('#scheduleTime').disabled = !e.target.checked; });
$('#composeFiles').addEventListener('change', async (event) => {
  const files = [...event.target.files]; event.target.value = '';
  const currentBytes = composeFiles.reduce((sum, file) => sum + file.size, 0);
  if (composeFiles.length + files.length > 10) return toast('单封邮件最多添加 10 个附件。', true);
  if (files.some((file) => file.size > 15 * 1024 * 1024) || currentBytes + files.reduce((sum, file) => sum + file.size, 0) > 18 * 1024 * 1024) return toast('附件总大小不能超过 18 MB，单个文件不能超过 15 MB。', true);
  try {
    const encoded = await Promise.all(files.map((file) => new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve({ filename:file.name, contentType:file.type || 'application/octet-stream', size:file.size, content:String(reader.result).split(',').at(-1) }); reader.onerror = () => reject(new Error('附件读取失败。')); reader.readAsDataURL(file);
    })));
    composeFiles.push(...encoded); renderComposeFiles();
  } catch (error) { toast(error.message, true); }
});
function renderComposeFiles() {
  const root = $('#composeFileList'); if (!root) return;
  root.innerHTML = composeFiles.map((file,index) => `<span class="attachment-token"><span class="attachment-paper">▤</span><span class="attachment-token-name">${escapeHtml(file.filename)}</span><small>${escapeHtml(formatSize(file.size))}</small><button type="button" data-remove-attachment="${index}" title="${L('移除附件')}" aria-label="${L('移除 ')}${escapeHtml(file.filename)}">×</button></span>`).join('');
  root.querySelectorAll('[data-remove-attachment]').forEach((button) => button.addEventListener('click', () => { composeFiles.splice(Number(button.dataset.removeAttachment),1); renderComposeFiles(); }));
}

function updateOAuthChoices(provider = $('#providerPreset').value) {
  const enabled = state.status?.oauthProviders || {};
  const showGoogle = provider === 'google' && Boolean(enabled.google);
  const showMicrosoft = provider === 'microsoft' && Boolean(enabled.microsoft);
  $('#googleOAuthButton').classList.toggle('hidden', !showGoogle);
  $('#microsoftOAuthButton').classList.toggle('hidden', !showMicrosoft);
  $('#oauthChoices').classList.toggle('hidden', !showGoogle && !showMicrosoft);
}
function openAccountDialog() {
  $('#accountForm').reset(); $('#providerPreset').value = 'custom'; $('#accountFormError').classList.add('hidden'); $('#connectSubmit').disabled = false;
  updateOAuthChoices('custom');
  $('#accountDialog').showModal();
}
$('#topAddButton').addEventListener('click', openAccountDialog); $('#addAccountQuick').addEventListener('click', openAccountDialog); $('#emptyAddButton').addEventListener('click', openAccountDialog);
const presets = {
  google:{imapHost:'imap.gmail.com',imapPort:993,imapSecure:true,smtpHost:'smtp.gmail.com',smtpPort:465,smtpSecure:true},
  microsoft:{imapHost:'outlook.office365.com',imapPort:993,imapSecure:true,smtpHost:'smtp.office365.com',smtpPort:587,smtpSecure:false},
  yahoo:{imapHost:'imap.mail.yahoo.com',imapPort:993,imapSecure:true,smtpHost:'smtp.mail.yahoo.com',smtpPort:465,smtpSecure:true},
  icloud:{imapHost:'imap.mail.me.com',imapPort:993,imapSecure:true,smtpHost:'smtp.mail.me.com',smtpPort:587,smtpSecure:false},
  fastmail:{imapHost:'imap.fastmail.com',imapPort:993,imapSecure:true,smtpHost:'smtp.fastmail.com',smtpPort:465,smtpSecure:true},
  '163':{imapHost:'imap.163.com',imapPort:993,imapSecure:true,smtpHost:'smtp.163.com',smtpPort:465,smtpSecure:true},
  '126':{imapHost:'imap.126.com',imapPort:993,imapSecure:true,smtpHost:'smtp.126.com',smtpPort:465,smtpSecure:true},
  yeah:{imapHost:'imap.yeah.net',imapPort:993,imapSecure:true,smtpHost:'smtp.yeah.net',smtpPort:465,smtpSecure:true},
  qq:{imapHost:'imap.qq.com',imapPort:993,imapSecure:true,smtpHost:'smtp.qq.com',smtpPort:465,smtpSecure:true},
  exmail:{imapHost:'imap.exmail.qq.com',imapPort:993,imapSecure:true,smtpHost:'smtp.exmail.qq.com',smtpPort:465,smtpSecure:true},
  sina:{imapHost:'imap.sina.com',imapPort:993,imapSecure:true,smtpHost:'smtp.sina.com',smtpPort:465,smtpSecure:true},
  '139':{imapHost:'imap.139.com',imapPort:993,imapSecure:true,smtpHost:'smtp.139.com',smtpPort:465,smtpSecure:true},
  '189':{imapHost:'imap.189.cn',imapPort:993,imapSecure:true,smtpHost:'smtp.189.cn',smtpPort:465,smtpSecure:true},
  aliyun:{imapHost:'imap.qiye.aliyun.com',imapPort:993,imapSecure:true,smtpHost:'smtp.qiye.aliyun.com',smtpPort:465,smtpSecure:true},
  zoho:{imapHost:'imap.zoho.com',imapPort:993,imapSecure:true,smtpHost:'smtp.zoho.com',smtpPort:465,smtpSecure:true},
  yandex:{imapHost:'imap.yandex.com',imapPort:993,imapSecure:true,smtpHost:'smtp.yandex.com',smtpPort:465,smtpSecure:true},
  aol:{imapHost:'imap.aol.com',imapPort:993,imapSecure:true,smtpHost:'smtp.aol.com',smtpPort:465,smtpSecure:true}
};
$('#providerPreset').addEventListener('change', (event) => {
  updateOAuthChoices(event.target.value);
  const values = presets[event.target.value]; if (!values) return;
  const form = $('#accountForm');
  for (const [key,value] of Object.entries(values)) { const field=form.elements[key]; if (field.type==='checkbox') field.checked=value; else field.value=value; }
});
$('#accountForm').elements.email.addEventListener('blur', () => { const form=$('#accountForm'); if (!form.elements.username.value) form.elements.username.value=form.elements.email.value; if (!form.elements.label.value) form.elements.label.value=form.elements.email.value.split('@')[0]; });
$('#accountForm').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form));
  values.imapSecure=form.elements.imapSecure.checked; values.smtpSecure=form.elements.smtpSecure.checked;
  $('#accountFormError').classList.add('hidden'); const button=$('#connectSubmit'); button.disabled=true; button.innerHTML=`<span class="spinner"></span>${L('正在验证连接…')}`;
  try {
    const data=await api('/api/accounts',{method:'POST',body:JSON.stringify(values)});
    $('#accountDialog').close(); toast(data.message || '邮箱已连接。'); await loadAccounts(); await loadFolders();
    state.accountId=data.account.id; renderAccountNav(); renderAccountFilter(); renderComposeAccounts(); await loadMessages();
  } catch(error) { $('#accountFormError').textContent=error.message; $('#accountFormError').classList.remove('hidden'); }
  finally { button.disabled=false; button.innerHTML=`<span>${L('验证并连接')}</span><span class="button-arrow">→</span>`; }
});
async function startOAuth(provider) {
  try { const data=await api(`/api/oauth/${provider}/start`); location.href=data.url; }
  catch(error) { toast(error.message,true); }
}
$('#googleOAuthButton').addEventListener('click',()=>startOAuth('google'));
$('#microsoftOAuthButton').addEventListener('click',()=>startOAuth('microsoft'));

function setSettingsTab(name = 'accounts') {
  const selected = ['accounts', 'ai', 'translation', 'notifications', 'oauth', 'mcp', 'backup'].includes(name) ? name : 'accounts';
  $$('[data-settings-tab]').forEach((button) => {
    const active = button.dataset.settingsTab === selected;
    button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active));
  });
  $$('[data-settings-panel]').forEach((panel) => panel.classList.toggle('hidden', panel.dataset.settingsPanel !== selected));
}
async function openSettings(tab = 'accounts') {
  const dialog = $('#settingsDialog');
  if (!dialog.open) {
    if (!state.aiConfig) await loadAIConfig();
    if (!state.translationConfig) await loadTranslationConfig();
    if (!state.notificationConfig) await loadNotificationConfig();
    if (!state.oauthConfig) await loadOAuthConfig();
    await refreshMailboxStatuses();
    await renderManagedAccounts();
    fillAISettingsForm(); fillTranslationSettingsForm(); fillNotificationSettingsForm(); fillOAuthSettingsForm();
    dialog.showModal();
  }
  setSettingsTab(tab);
  if (tab === 'mcp') await loadMcpConfig();
}
$$('[data-settings-tab]').forEach((button) => button.addEventListener('click', () => { setSettingsTab(button.dataset.settingsTab); if (button.dataset.settingsTab === 'mcp') { void loadMcpConfig(); } else if (button.dataset.settingsTab === 'accounts') { void refreshMailboxStatuses(); } }));
$('#manageAccountsButton').addEventListener('click', () => { void openSettings('accounts'); });
$('#settingsAddButton').addEventListener('click',()=>{ $('#settingsDialog').close(); openAccountDialog(); });
$('#saveDefaultMailbox').addEventListener('click', async () => {
  const button = $('#saveDefaultMailbox'); const status = $('#defaultMailboxStatus');
  button.disabled = true; status.textContent = L('正在保存…'); status.classList.remove('error');
  try {
    const result = await api('/api/preferences/default-account', { method:'PUT', body:JSON.stringify({ accountId:$('#defaultMailboxSelect').value }) });
    state.defaultAccountId = result.defaultAccountId || '';
    updateNotificationScopeNote();
    if (state.folder === 'INBOX') {
      state.accountId = state.defaultAccountId || 'all'; state.cursor = null; state.cursorStack.length = 0; state.selected = null; state.detail = null;
      renderAccountNav(); renderAccountFilter(); renderDetailPlaceholder(); await loadMessages();
    }
    renderDefaultMailbox(); status.textContent = state.defaultAccountId ? L('已保存；刷新或重新进入时会默认显示此邮箱的收件箱。') : L('已清除默认邮箱设置。');
  } catch (error) { status.textContent = L(error.message); status.classList.add('error'); }
  finally { button.disabled = false; }
});
async function renderManagedAccounts() {
  const root=$('#managedAccounts');
  if(!state.accounts.length){ root.innerHTML=`<div class="settings-empty">${L('尚未连接邮箱账户。')}</div>`;return; }
  root.innerHTML=state.accounts.map(a=>{
    const status=a.mailStatus||{};
    const idleLabel=L((({connected:'已连接',connecting:'连接中',reconnecting:'重连中',disabled:'未启用'})[status.idleStatus])||'状态未知');
    const lastSync=status.lastSyncAt?dateLong(status.lastSyncAt):L('尚无成功同步');
    const reconnectError=status.reconnectError?`<span class="managed-sync-error">${L('重连错误：')}${escapeHtml(status.reconnectError)}</span>`:'';
    return `<div class="managed-account">${accountProviderIcon(a)}<div class="managed-main"><strong>${escapeHtml(a.label||a.email)}</strong><span>${escapeHtml(a.email)} · ${a.authType==='oauth'?L('OAuth 安全授权'):'IMAP / SMTP'}</span><span class="managed-sync-info">IMAP / IDLE：${idleLabel} · ${L('最近成功同步：')}${escapeHtml(lastSync)}${status.reconnectAttempts?` · ${L(' · 重连 ')}${Number(status.reconnectAttempts)}${L(' 次')}`:''}</span>${reconnectError}</div><span class="managed-badge">${L('已连接')}</span><button class="remove-account" data-remove="${escapeHtml(a.id)}" title="${L('移除此账户')}" aria-label="${L('移除此账户')}">×</button></div>`;
  }).join('');
  $$('[data-remove]',root).forEach(button=>button.addEventListener('click',async()=>{
    const account=state.accounts.find(a=>a.id===button.dataset.remove); if(!account)return;
    if(!await askConfirm('移除此邮箱账户？',`将从邮汇中移除 ${account.email} 的连接凭据。服务器上的邮件不会被删除。`, '移除账户', true))return;
    try{await api(`/api/accounts/${encodeURIComponent(account.id)}`,{method:'DELETE'});mailListCache.clearAccount(account.id);state.accounts=state.accounts.filter(a=>a.id!==account.id);if(state.defaultAccountId===account.id)state.defaultAccountId='';if(state.accountId===account.id)state.accountId=state.defaultAccountId||'all';await renderManagedAccounts();renderDefaultMailbox();updateNotificationScopeNote();renderAccountNav();renderAccountFilter();renderComposeAccounts();await loadFolders();await loadMessages();toast('邮箱连接已移除。');}
    catch(error){toast(error.message,true);}
  }));
}
let confirmResolver;
function askConfirm(title,copy,acceptLabel='确认',danger=false){
  $('#confirmTitle').textContent=L(title);$('#confirmCopy').textContent=L(copy);$('#confirmAccept').textContent=L(acceptLabel);$('#confirmAccept').classList.toggle('button-danger',danger);$('#confirmAccept').classList.toggle('button-primary',!danger);
  $('#confirmDialog').showModal(); return new Promise(resolve=>{confirmResolver=resolve;});
}
$('#confirmCancel').addEventListener('click',()=>{if(confirmResolver)confirmResolver(false);confirmResolver=null;$('#confirmDialog').close();});
$('#confirmAccept').addEventListener('click',()=>{if(confirmResolver)confirmResolver(true);confirmResolver=null;$('#confirmDialog').close();});
$('#confirmDialog').addEventListener('close',()=>{if(confirmResolver)confirmResolver(false);confirmResolver=null;});
function backupStatus(message, isError = false) {
  const status = $('#backupSettingsStatus');
  status.textContent = L(message); status.classList.toggle('error', isError);
}
$('#backupEncryptEnabled').addEventListener('change', (event) => {
  const enabled = event.currentTarget.checked;
  $('#backupPassphraseFields').classList.toggle('hidden', !enabled);
  if (!enabled) { $('#backupPassphrase').value = ''; $('#backupPassphraseConfirm').value = ''; }
});
$('#downloadBackupButton').addEventListener('click', async () => {
  const button = $('#downloadBackupButton');
  const encrypted = $('#backupEncryptEnabled').checked;
  const passphrase = $('#backupPassphrase').value;
  const passphraseConfirm = $('#backupPassphraseConfirm').value;
  if (encrypted && (passphrase.length < 12 || passphrase.length > 1024)) return backupStatus('加密备份密码须为 12 到 1024 个字符。', true);
  if (encrypted && passphrase !== passphraseConfirm) return backupStatus('两次输入的备份密码不一致。', true);
  button.disabled = true; backupStatus(encrypted ? '正在生成并加密备份…' : '正在创建备份…');
  try {
    const response = await fetch('/api/backup/export', { method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ encrypted, passphrase:encrypted?passphrase:'' }) });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      if (response.status === 401) showAuth();
      throw new Error(result.error || `备份失败 (${response.status})`);
    }
    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition') || '';
    const filename = disposition.match(/filename="([^"]+)"/)?.[1] || `youhui-backup-${new Date().toISOString().slice(0, 10)}.yhbackup`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = filename;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    backupStatus(`备份已生成${encrypted?'并已加密':''}（${(blob.size / 1024 / 1024).toFixed(1)} MB）。${encrypted?'请妥善记住备份密码；工作台不会保存它。':'未加密文件含邮箱凭据恢复密钥，请妥善保管。'}`);
  } catch (error) { backupStatus(error.message || '无法生成备份。', true); }
  finally { button.disabled = false; $('#backupPassphrase').value=''; $('#backupPassphraseConfirm').value=''; }
});
$('#chooseBackupFileButton').addEventListener('click', () => $('#backupRestoreFile').click());
$('#backupRestoreFile').addEventListener('change', async (event) => {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.yhbackup')) {
    backupStatus('请选择邮汇导出的 .yhbackup 文件。', true); input.value = ''; return;
  }
  if (file.size > 250 * 1024 * 1024) {
    backupStatus('备份文件超过 250 MB 上限。', true); input.value = ''; return;
  }
  let encrypted = false;
  let passphrase = '';
  try {
    const prefix = await file.slice(0, 64).arrayBuffer();
    encrypted = new TextDecoder().decode(prefix).startsWith('YOUHUI-MAIL-ENCRYPTED-BACKUP\n');
  } catch { backupStatus('无法读取备份文件头。', true); input.value=''; return; }
  if (encrypted) {
    const entered = window.prompt(I18N_LANG === 'en' ? 'This backup is encrypted. Enter the passphrase set when it was created (at least 12 characters).' : '此备份已加密。请输入创建备份时设置的密码（至少 12 个字符）。');
    if (entered === null) { input.value=''; return; }
    passphrase = entered;
    if (passphrase.length < 12 || passphrase.length > 1024) { backupStatus('备份密码须为 12 到 1024 个字符。', true); input.value=''; return; }
  }
  const confirmed = await askConfirm('恢复备份并替换当前数据？', `将从“${file.name}”完整替换此工作台的邮箱账户、设置和配置；当前所有登录会话会退出。此操作无法撤销，请确保已有当前数据备份。`, '恢复并替换', true);
  if (!confirmed) { passphrase = ''; input.value = ''; return; }
  const button = $('#chooseBackupFileButton');
  button.disabled = true; backupStatus('正在验证并恢复备份，请保持此页面打开…');
  try {
    const response = await fetch('/api/backup/restore', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream', ...(encrypted ? { 'X-Backup-Passphrase': encodeURIComponent(passphrase) } : {}) }, body: file });
    passphrase = '';
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) showAuth();
      throw new Error(result.error || `恢复失败 (${response.status})`);
    }
    input.value = '';
    $('#settingsDialog').close();
    state.status = { setupRequired: false, authenticated: false, identityProviders: {} };
    showAuth();
    toast(result.message || '备份已恢复，请重新登录。');
  } catch (error) { backupStatus(error.message || '无法恢复此备份。', true); }
  finally { button.disabled = false; passphrase = ''; }
});
$$('[data-close]').forEach(button=>button.addEventListener('click',()=>{const dialog=document.getElementById(button.dataset.close);dialog?.close();}));
$$('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog && event.detail>=2)dialog.close();}));

$('#refreshButton').addEventListener('click',async()=>{
  if (state.folder === 'INBOX' && state.defaultAccountId && state.accountId !== state.defaultAccountId) {
    state.accountId = state.defaultAccountId; state.cursor = null; state.cursorStack.length = 0; state.selected = null; state.detail = null;
    renderAccountNav(); renderAccountFilter(); renderDetailPlaceholder();
  }
  await loadFolders(); await loadMessages(); toast('已从邮箱服务器刷新。');
});
$('#accountFilter').addEventListener('change',event=>{state.accountId=event.target.value;state.cursor=null;state.cursorStack.length=0;renderAccountNav();loadMessages();});
$('#accountNav').addEventListener('click',event=>{const button=event.target.closest('[data-account]');if(!button)return;state.accountId=button.dataset.account;state.cursor=null;state.cursorStack.length=0;renderAccountFilter();renderAccountNav();loadMessages();});
$$('.folder-nav [data-folder]').forEach(button=>button.addEventListener('click',()=>setFolder(button.dataset.folder)));
$('#searchInput').addEventListener('input',event=>{clearTimeout(state.searchTimer);state.query=event.target.value.trim();state.cursor=null;state.cursorStack.length=0;state.searchTimer=setTimeout(loadMessages,350);});
$('#searchInput').addEventListener('keydown',event=>{if(event.key==='Enter'){clearTimeout(state.searchTimer);state.query=event.target.value.trim();state.cursor=null;state.cursorStack.length=0;loadMessages();}});
$('#sortButton').addEventListener('click',()=>{state.olderFirst=!state.olderFirst;renderMessages();});
$('#threadButton').addEventListener('click',()=>{state.threadView=!state.threadView;state.selected=null;state.detail=null;renderMessageListData({messages:state.threadView?[]:state.messages,total:state.total,hasMore:state.hasMore}, 'local');loadMessages();});
$('#prevPage').addEventListener('click',()=>{if(state.cursorStack.length){state.cursor=state.cursorStack.pop();state.selected=null;loadMessages();}});
$('#nextPage').addEventListener('click',()=>{if(state.hasMore){state.cursorStack.push(state.cursor);const next={...(state.cursor||{})};for(const message of state.messages){const uid=Number(message.uid);if(!uid)continue;const known=next[message.accountId];if(known===undefined||uid<known)next[message.accountId]=uid;}state.cursor=next;state.selected=null;loadMessages();}});
$('#logoutButton').addEventListener('click',async()=>{try{await api('/api/logout',{method:'POST'});}catch{}state.accounts=[];state.selected=null;state.detail=null;state.aiConfig=null;state.translationConfig=null;state.aiMessages=[];state.aiContext=null;state.status={...(state.status||{}),authenticated:false};closeAIChat(false);showAuth();toast('工作台已锁定。');});
$('#mobileMenu').addEventListener('click',()=>{$('#sidebar').classList.add('open');$('#sidebarShade').classList.add('visible');});
$('#mobileCloseSidebar').addEventListener('click',closeSidebar);$('#sidebarShade').addEventListener('click',closeSidebar);
function closeSidebar(){$('#sidebar').classList.remove('open');$('#sidebarShade').classList.remove('visible');}
$$('.folder-nav .nav-item').forEach(button=>button.addEventListener('click',closeSidebar));

async function loadAIConfig() {
  try { state.aiConfig = await api('/api/ai/config'); }
  catch { state.aiConfig = null; }
  updateAIControls();
}
async function loadTranslationConfig() {
  try { state.translationConfig = await api('/api/translation/config'); }
  catch { state.translationConfig = null; }
}
async function loadNotificationConfig() {
  try { state.notificationConfig = await api('/api/notifications/config'); }
  catch { state.notificationConfig = null; }
  updateNotificationScopeNote();
  if ($('#settingsDialog')?.open) fillNotificationSettingsForm();
}
async function loadOAuthConfig() {
  try { state.oauthConfig = await api('/api/oauth/config'); }
  catch { state.oauthConfig = null; }
  if ($('#settingsDialog')?.open) fillOAuthSettingsForm();
}
function clearMcpTokenReveal() {
  const input = $('#mcpTokenValue');
  if (input) input.value = '';
  $('#mcpTokenReveal')?.classList.add('hidden');
  mcpTokenRevealPermission = '';
}
const mcpPermissionDefinitions = [
  { id:'read_only', label:'只读', description:'查看账户、文件夹、搜索和读取邮件（读取会标记为已读）。' },
  { id:'email_management', label:'邮件管理', description:'只读权限，并可标记读/未读、加星、归档；移入已删除必须确认。' },
  { id:'send_mail', label:'发送邮件', description:'只读权限，并可提交邮件待确认；确认后才会发送。' },
  { id:'full_access', label:'完全访问', description:'包含当前全部 MCP 邮件工具；发送邮件与移入已删除仍须逐项确认。' }
];
function selectedMcpAccountScope(row) {
  if (row.querySelector('[data-mcp-scope-all]')?.checked) return 'all';
  const ids = [...row.querySelectorAll('[data-mcp-scope-account]:checked')].map((input) => input.value);
  if (!ids.length) throw new Error('请至少选择一个邮箱，或选择“全部已连接邮箱”。');
  return ids;
}
function describeMcpAccountScope(scope) {
  if (scope === 'all') return L('全部已连接邮箱');
  const accounts = state.mcpConfig?.accounts || [];
  return scope.map((id) => accounts.find((account) => String(account.id) === String(id))?.email || accounts.find((account) => String(account.id) === String(id))?.label || L('已选邮箱')).join('、');
}
function renderMcpPermissions() {
  const root = $('#mcpPermissionRows');
  const permissions = state.mcpConfig?.permissions || {};
  const accounts = state.mcpConfig?.accounts || [];
  root.innerHTML = mcpPermissionDefinitions.map((item) => {
    const config = permissions[item.id] || {};
    const configured = Boolean(config.configured);
    const allAccounts = config.accountScope !== 'selected';
    const selectedIds = Array.isArray(config.accountIds) ? config.accountIds.map(String) : [];
    const status = config.legacy ? L('旧令牌（已降为只读）') : configured ? (allAccounts ? `${L('已启用 · ')}${L('全部已连接邮箱')}` : `${L('已启用 · ')}${selectedIds.length}${L(' 个邮箱')}`) : L('尚未创建');
    const accountOptions = accounts.length ? accounts.map((account) => {
      const id = escapeHtml(account.id);
      return `<label class="mcp-scope-account"><input type="checkbox" data-mcp-scope-account value="${id}" ${!allAccounts && selectedIds.includes(String(account.id)) ? 'checked' : ''}><span>${escapeHtml(account.label || account.email || account.id)}<small>${escapeHtml(account.email || '')}</small></span></label>`;
    }).join('') : '<small class="mcp-scope-empty">尚未连接邮箱；选择“全部”可包含以后添加的邮箱。</small>';
    return `<article class="mcp-permission-row" data-permission-row="${item.id}"><div class="mcp-permission-info"><strong>${L(item.label)}</strong><span>${L(item.description)}</span><small>${status}</small></div><fieldset class="mcp-scope-fieldset"><legend>${L('允许访问的邮箱')}</legend><label class="mcp-scope-all"><input type="checkbox" data-mcp-scope-all ${allAccounts ? 'checked' : ''}><span>${L('全部已连接邮箱')}</span></label><div class="mcp-scope-accounts">${accountOptions}</div></fieldset><div class="mcp-permission-actions"><button class="button button-quiet" type="button" data-mcp-token-action="create" data-permission="${item.id}">${configured?L('轮换令牌'):L('创建令牌')}</button>${configured?`<button class="button button-quiet" type="button" data-mcp-token-action="save-scope" data-permission="${item.id}">${L('保存范围')}</button><button class="button button-quiet mcp-revoke-button" type="button" data-mcp-token-action="revoke" data-permission="${item.id}">${L('撤销')}</button>`:''}</div></article>`;
  }).join('');
}
async function loadMcpConfig() {
  clearMcpTokenReveal();
  try {
    state.mcpConfig = await api('/api/mcp/config');
    $('#mcpEndpoint').textContent = state.mcpConfig.endpoint || '—';
    renderMcpPermissions();
    $('#mcpSettingsStatus').textContent = '';
    $('#mcpSettingsStatus').classList.remove('error');
    await pollMcpApprovals();
  } catch (error) {
    state.mcpConfig = null;
    $('#mcpEndpoint').textContent = L('无法读取 MCP 配置');
    $('#mcpSettingsStatus').textContent = error.message;
    $('#mcpSettingsStatus').classList.add('error');
  }
}
$('#mcpPermissionRows').addEventListener('change', (event) => {
  const row = event.target.closest('.mcp-permission-row');
  if (!row) return;
  if (event.target.matches('[data-mcp-scope-all]') && event.target.checked) {
    row.querySelectorAll('[data-mcp-scope-account]').forEach((input) => { input.checked = false; });
  } else if (event.target.matches('[data-mcp-scope-account]') && event.target.checked) {
    const all = row.querySelector('[data-mcp-scope-all]');
    if (all) all.checked = false;
  }
});
$('#mcpPermissionRows').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-mcp-token-action]');
  if (!button) return;
  const permission = button.dataset.permission;
  const action = button.dataset.mcpTokenAction;
  const row = button.closest('.mcp-permission-row');
  const configured = Boolean(state.mcpConfig?.permissions?.[permission]?.configured);
  let accountIds;
  if (action === 'create' || action === 'save-scope') {
    try { accountIds = selectedMcpAccountScope(row); }
    catch (error) { const status = $('#mcpSettingsStatus'); status.textContent = L(error.message); status.classList.add('error'); return; }
  }
  if (action === 'create' && configured && !await askConfirm('轮换此 MCP 令牌？', `现有令牌会立即失效；新令牌只可访问：${describeMcpAccountScope(accountIds)}。已连接的 Agent 需要更新。`, '轮换令牌', true)) return;
  if (action === 'revoke' && !await askConfirm('撤销此 MCP 令牌？', '使用此令牌的 Agent 会立即失去对应权限；其他权限的令牌不受影响。', '撤销令牌', true)) return;
  button.disabled = true;
    const status = $('#mcpSettingsStatus'); status.textContent = action === 'create' ? L('正在创建或轮换令牌…') : action === 'save-scope' ? L('正在保存邮箱范围…') : L('正在撤销令牌…'); status.classList.remove('error');
  try {
    if (action === 'create') {
      const result = await api('/api/mcp/token', { method:'POST', body:JSON.stringify({ permission, accountIds }) });
      if (!state.mcpConfig) state.mcpConfig = { permissions:{} };
      state.mcpConfig.permissions[permission] = { ...state.mcpConfig.permissions?.[permission], configured:true, legacy:false, accountScope:accountIds === 'all' ? 'all' : 'selected', accountIds:accountIds === 'all' ? [] : accountIds };
      renderMcpPermissions();
      $('#mcpTokenValue').value = result.token;
      $('#mcpTokenScope').textContent = `${L(mcpPermissionDefinitions.find((item)=>item.id===permission)?.label || 'MCP')}${L('新令牌')}`;
      $('#mcpTokenReveal').classList.remove('hidden'); mcpTokenRevealPermission = permission;
      const endpoint = state.mcpConfig?.endpoint || `${location.origin}/mcp`;
      const mcpJson = JSON.stringify({ mcpServers: { 'youhui-mail': { url: endpoint, headers: { Authorization: `Bearer ${result.token}` } } } }, null, 2);
      $('#mcpConfigPreview').textContent = mcpJson;
      status.textContent = L('令牌仅显示这一次；请复制到可信任的 Agent 配置中。关闭设置后无法再次查看。');
    } else if (action === 'save-scope') {
      const result = await api(`/api/mcp/token/${encodeURIComponent(permission)}/scope`, { method:'POST', body:JSON.stringify({ accountIds }) });
      state.mcpConfig.permissions[permission] = { ...state.mcpConfig.permissions[permission], ...result };
      renderMcpPermissions();
      status.textContent = `${L('已保存范围：')}${describeMcpAccountScope(accountIds)}${L('。')}`;
    } else if (action === 'revoke') {
      await api(`/api/mcp/token/${encodeURIComponent(permission)}`, { method:'DELETE' });
      state.mcpConfig.permissions[permission] = { configured:false, legacy:false, accountScope:'all', accountIds:[] };
      if (mcpTokenRevealPermission === permission) clearMcpTokenReveal();
      renderMcpPermissions(); status.textContent = L('此权限令牌已撤销。');
    }
  } catch (error) { status.textContent = L(error.message); status.classList.add('error'); }
  finally { button.disabled = false; }
});
$('#copyMcpToken').addEventListener('click', async () => {
  const token = $('#mcpTokenValue').value;
  if (!token) return;
  try {
    await navigator.clipboard.writeText(token);
    $('#mcpSettingsStatus').textContent = L('令牌已复制。请只粘贴到可信任的 MCP Agent 配置中。');
    $('#mcpSettingsStatus').classList.remove('error');
  } catch {
    $('#mcpTokenValue').focus(); $('#mcpTokenValue').select();
    $('#mcpSettingsStatus').textContent = L('无法自动复制；已选中令牌，请使用设备的复制操作。');
    $('#mcpSettingsStatus').classList.remove('error');
  }
});
$('#copyMcpConfig').addEventListener('click', async () => {
  const config = $('#mcpConfigPreview')?.textContent;
  if (!config) return;
  try {
    await navigator.clipboard.writeText(config);
    $('#mcpSettingsStatus').textContent = L('MCP 配置已复制。请粘贴到 MCP 客户端的 mcpServers 设置中。');
    $('#mcpSettingsStatus').classList.remove('error');
  } catch {
    const range = document.createRange(); range.selectNodeContents($('#mcpConfigPreview'));
    getSelection().removeAllRanges(); getSelection().addRange(range);
  }
});
function renderMcpApprovals() {
  const root = $('#mcpApprovalList');
  const banner = $('#mcpApprovalBanner');
  const list = Array.isArray(mcpApprovals) ? mcpApprovals : [];
  banner.classList.toggle('hidden', (!list.length && !mcpApprovalPollError) || $('#appView').classList.contains('hidden'));
  $('#mcpApprovalBannerText').textContent = mcpApprovalPollError
    ? L('暂时无法检查待确认操作，点击查看并重试。')
    : list.length ? (I18N_LANG === 'en' ? `${list.length} MCP mail actions awaiting confirmation` : `有 ${list.length} 项待确认的 MCP 邮件操作`) : L('有待确认的 MCP 邮件操作');
  if (!list.length) {
    root.innerHTML = `<div class="settings-empty">${mcpApprovalPollError ? L('暂时无法读取待确认操作，请稍后重试。') : L('目前没有待确认操作。')}</div>`;
    return;
  }
  root.innerHTML = list.map((item) => {
    const send = item.kind === 'send_email';
    const title = send ? `${L('待发送：')}${item.subject || L('(无主题)')}` : L('待移入已删除');
    const details = send
      ? `<div class="mcp-approval-address"><strong>${L('收件人：')}</strong>${escapeHtml(item.to || '')}${item.cc?`<br><strong>${L('抄送：')}</strong>${escapeHtml(item.cc)}`:''}${item.bcc?`<br><strong>${L('密送：')}</strong>${escapeHtml(item.bcc)}`:''}</div><pre class="mcp-approval-preview">${escapeHtml(item.text || L('(无正文)'))}</pre>`
      : `<div class="mcp-approval-address">${escapeHtml(item.accountEmail || '')} · ${escapeHtml(item.folder || 'INBOX')} · UID ${Number(item.uid) || ''}</div>`;
    const date = item.createdAt ? dateLong(item.createdAt) : '';
    return `<article class="mcp-approval-card"><div class="mcp-approval-head"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(item.accountLabel || item.accountEmail || '')}${date?` · ${escapeHtml(date)}`:''}</small></div>${details}<div class="mcp-approval-actions"><button class="button button-primary" type="button" data-mcp-approval-action="approve" data-approval-id="${escapeHtml(item.id)}">${send?L('确认并发送'):L('确认移入已删除')}</button><button class="button button-quiet" type="button" data-mcp-approval-action="deny" data-approval-id="${escapeHtml(item.id)}">${L('拒绝')}</button></div></article>`;
  }).join('');
}
async function pollMcpApprovals() {
  if (mcpApprovalPollInFlight || $('#appView').classList.contains('hidden')) return;
  mcpApprovalPollInFlight = true;
  try {
    const data = await api('/api/mcp/approvals');
    mcpApprovals = Array.isArray(data.approvals) ? data.approvals : [];
    mcpApprovalPollError = false;
    renderMcpApprovals();
  } catch {
    mcpApprovalPollError = true;
    renderMcpApprovals();
  }
  finally { mcpApprovalPollInFlight = false; }
}
function startMcpApprovalPolling() {
  stopMcpApprovalPolling();
  void pollMcpApprovals();
  mcpApprovalPollTimer = setInterval(() => void pollMcpApprovals(), 10_000);
}
function stopMcpApprovalPolling() {
  if (mcpApprovalPollTimer) clearInterval(mcpApprovalPollTimer);
  mcpApprovalPollTimer = null; mcpApprovalPollInFlight = false; mcpApprovals = []; mcpApprovalPollError = false;
  if ($('#mcpApprovalBanner')) $('#mcpApprovalBanner').classList.add('hidden');
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void pollMcpApprovals();
});
window.addEventListener('focus', () => { void pollMcpApprovals(); });
$('#mcpApprovalList').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-mcp-approval-action]');
  if (!button) return;
  const id = button.dataset.approvalId;
  const approval = mcpApprovals.find((item) => item.id === id);
  if (!approval) return;
  const send = approval.kind === 'send_email';
  if (button.dataset.mcpApprovalAction === 'approve') {
    const copy = send
      ? `${L('将从 ')}${approval.accountEmail || approval.accountLabel || L('所选邮箱')}${L(' 发送给 ')}${approval.to || L('未指定收件人')}。${L('主题：')}${approval.subject || L('(无主题)')}。\n\n${String(approval.text || '').slice(0,4000)}`
      : (I18N_LANG === 'en' ? `Move UID ${approval.uid} in ${approval.folder || 'INBOX'} of ${approval.accountEmail || approval.accountLabel || L('所选邮箱')} to Trash. This is not a permanent deletion.` : `将把 ${approval.accountEmail || approval.accountLabel || '所选邮箱'} 中 ${approval.folder || 'INBOX'} 的邮件 UID ${approval.uid} 移入“已删除”。这不是永久删除。`);
    if (!await askConfirm(send?L('确认发送这封邮件？'):L('确认移入已删除？'), copy, send?L('确认并发送'):L('移入已删除'), true)) return;
  }
  button.disabled = true;
  try {
    if (button.dataset.mcpApprovalAction === 'approve') {
      const result = await api(`/api/mcp/approvals/${encodeURIComponent(id)}/approve`, { method:'POST', body:JSON.stringify({}) });
      toast(send ? (result.result?.warning || result.result?.message || L('邮件已发送。')) : L('邮件已移入已删除。'), Boolean(result.result?.warning));
    } else {
      await api(`/api/mcp/approvals/${encodeURIComponent(id)}/deny`, { method:'POST', body:JSON.stringify({}) });
      toast(L('已拒绝此 MCP 操作。'));
    }
    await pollMcpApprovals();
  } catch (error) { toast(error.message, true); await pollMcpApprovals(); }
});
$('#reviewMcpApprovals').addEventListener('click', () => { void openSettings('mcp'); });
$('#settingsDialog').addEventListener('close', clearMcpTokenReveal);
function fillOAuthSettingsForm() {
  const config = state.oauthConfig;
  if (!config) return;
  const inputStatus = {
    mailGoogleClientId: config.mailbox?.google?.clientIdSet,
    mailGoogleClientSecret: config.mailbox?.google?.clientSecretSet,
    mailMicrosoftClientId: config.mailbox?.microsoft?.clientIdSet,
    mailMicrosoftClientSecret: config.mailbox?.microsoft?.clientSecretSet,
    loginGoogleClientId: config.login?.google?.clientIdSet,
    loginGoogleClientSecret: config.login?.google?.clientSecretSet,
    loginGithubClientId: config.login?.github?.clientIdSet,
    loginGithubClientSecret: config.login?.github?.clientSecretSet,
    loginCloudflareClientId: config.login?.cloudflare?.clientIdSet,
    loginCloudflareClientSecret: config.login?.cloudflare?.clientSecretSet,
    loginCloudflareConfigurationUrl: config.login?.cloudflare?.configurationUrlSet
  };
  for (const [id, configured] of Object.entries(inputStatus)) {
    const input = $(`#${id}`); input.value = '';
    input.placeholder = configured ? L('已配置；留空保留已保存值') : (id.includes('Secret') ? L('输入客户端密钥') : id.includes('ConfigurationUrl') ? L('粘贴 Cloudflare Access 配置端点') : L('输入客户端 ID'));
  }
  const callbacks = {
    mailGoogleCallback: config.mailbox.google.callbackUrl,
    mailMicrosoftCallback: config.mailbox.microsoft.callbackUrl,
    loginGoogleCallback: config.login.google.callbackUrl,
    loginGithubCallback: config.login.github.callbackUrl,
    loginCloudflareCallback: config.login.cloudflare.callbackUrl
  };
  for (const [id, url] of Object.entries(callbacks)) $(`#${id}`).textContent = url || '—';
  const identityStatus = { google:'identityGoogleStatus', github:'identityGithubStatus', cloudflare:'identityCloudflareStatus' };
  for (const [provider, id] of Object.entries(identityStatus)) {
    const item = config.login[provider];
    const status = $(`#${id}`);
    status.textContent = item.bound ? (I18N_LANG === 'en' ? `Linked${item.label ? ` · ${item.label}` : ''}${item.email ? ` (${item.email})` : ''}` : `已绑定${item.label ? ` · ${item.label}` : ''}${item.email ? ` (${item.email})` : ''}`) : L('未绑定');
    const bind = $(`[data-bind-identity="${provider}"]`);
    const unbind = $(`[data-unbind-identity="${provider}"]`);
    bind.disabled = !item.configured; bind.textContent = item.bound ? L('重新绑定') : L('绑定');
    unbind.disabled = !item.bound;
  }
  $('#oauthSettingsStatus').textContent = '';
  $('#oauthSettingsStatus').classList.remove('error');
}
function updateNotificationScopeNote() {
  const note = $('#notificationScopeNote'); if (!note) return;
  const account = state.accounts.find((item) => item.id === state.defaultAccountId);
  note.textContent = account
    ? (I18N_LANG === 'en' ? `Notification scope: only the default mailbox “${account.label || account.email}” is checked; change the default mailbox to switch.` : `当前通知范围：只检查默认邮箱“${account.label || account.email}”；更改默认邮箱后按新账户检查。`)
    : L('当前通知范围：所有已连接邮箱；设置默认邮箱后只检查该账户。');
}
function notificationPermissionText() {
  if (!('Notification' in window)) return L('此浏览器不支持系统通知。');
  if (Notification.permission === 'granted') return L('浏览器通知已允许；工作台不在前台时会显示系统通知。');
  if (Notification.permission === 'denied') return L('浏览器通知已被拒绝；请在浏览器站点设置中改为允许。');
  return L('尚未授权；点击右侧按钮后，浏览器会询问是否允许通知。');
}
function fillNotificationSettingsForm() {
  const config = state.notificationConfig || { enabled:true, intervalSeconds:120, webhookEnabled:false, webhookConfigured:false, webhookSecretConfigured:false };
  $('#notificationChecksEnabled').checked = config.enabled !== false;
  $('#notificationInterval').value = String(config.intervalSeconds || 120);
  $('#notificationProvider').value = config.pushProvider === 'wxpusher' ? 'wxpusher' : 'webhook';
  $('#webhookEnabled').checked = Boolean(config.webhookEnabled);
  $('#wxpusherEnabled').checked = Boolean(config.wxpusherEnabled);
  $('#webhookUrl').value = '';
  $('#webhookUrl').placeholder = config.webhookConfigured ? L('已保存；留空保留，填写新地址可替换') : 'https://hooks.example.com/your-endpoint';
  $('#webhookSecret').value = '';
  $('#webhookSecret').placeholder = config.webhookSecretConfigured ? L('已保存；留空保留，输入新密钥可替换') : L('输入可选的签名密钥');
  const appTokenConfigured = Boolean(config.wxpusherAppTokenConfigured);
  $('#wxpusherAppToken').value = '';
  $('#wxpusherAppToken').placeholder = appTokenConfigured ? L('已保存；留空保留，输入新 AppToken 可替换') : L('输入 WxPusher AppToken');
  $('#wxpusherAppTokenHint').textContent = appTokenConfigured ? L('AppToken 已配置（值不回传）；留空保存会保留现有值。') : L('AppToken 尚未配置。');
  const uidValues = String(config.wxpusherUids || '');
  const topicValues = String(config.wxpusherTopicIds || '');
  $('#wxpusherUids').value = uidValues;
  $('#wxpusherTopicIds').value = topicValues;
  $('#wxpusherUidsHint').textContent = uidValues ? L('显示当前已保存 UID；可直接编辑或清空。清空后若 Topic ID 也为空将无法保存。') : L('尚未配置 UID；可逐行或逗号分隔输入。');
  $('#wxpusherTopicIdsHint').textContent = topicValues ? L('显示当前已保存 topicId；可直接编辑或清空。清空后若 UID 也为空将无法保存。') : L('尚未配置 topicId；可逐行或逗号分隔输入。');
  $('#clearWebhookConfig').disabled = !config.webhookConfigured && !config.webhookSecretConfigured;
  $('#testWebhook').disabled = !config.webhookConfigured;
  $('#testWxpusher').disabled = !config.wxpusherAppTokenConfigured || (!uidValues.trim() && !topicValues.trim());
  updateNotificationProviderFields();
  $('#browserNotificationStatus').textContent = notificationPermissionText();
  $('#notificationsSettingsStatus').textContent = '';
  $('#notificationsSettingsStatus').classList.remove('error');
  updateNotificationScopeNote();
}
function updateNotificationProviderFields() {
  const wxpusher = $('#notificationProvider').value === 'wxpusher';
  $('#webhookProviderFields').classList.toggle('hidden', wxpusher);
  $('#wxpusherProviderFields').classList.toggle('hidden', !wxpusher);
  $('#clearWebhookConfig').classList.toggle('hidden', wxpusher);
  $('#testWebhook').classList.toggle('hidden', wxpusher);
  $('#testWxpusher').classList.toggle('hidden', !wxpusher);
}
$('#notificationProvider').addEventListener('change', updateNotificationProviderFields);
function notificationCursorRead() {
  if (state.notificationCursor !== null && Number.isSafeInteger(state.notificationCursor)) return state.notificationCursor;
  try {
    const saved = localStorage.getItem('youhui_notification_cursor');
    if (saved !== null && /^\d+$/.test(saved) && Number.isSafeInteger(Number(saved))) {
      state.notificationCursor = Number(saved); return state.notificationCursor;
    }
  } catch {}
  return null;
}
function notificationCursorWrite(value) {
  const cursor = Math.max(0, Number(value) || 0);
  state.notificationCursor = cursor;
  try { localStorage.setItem('youhui_notification_cursor', String(cursor)); } catch {}
}
function notifyNewMail(events) {
  if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
  const ordered = events.slice().sort((a,b) => Number(Boolean(b.verificationCode)) - Number(Boolean(a.verificationCode)) || a.id - b.id);
  const visible = ordered.slice(0, 3);
  for (const event of visible) {
  const sender = String(event.sender?.name || event.sender?.email || L('新邮件')).slice(0,100);
  const subject = String(event.subject || L('(无主题)')).slice(0,160);
  const title = event.verificationCode ? `${L('验证码：')}${event.verificationCode}` : sender;
  const body = event.verificationCode ? `${sender} · ${subject}` : `${subject} · ${event.account?.label || event.account?.email || L('邮汇')}`;
    try {
      const notification = new Notification(title, { body, tag:`youhui-mail-${event.id}`, renotify:false });
      notification.onclick = () => { window.focus(); notification.close(); };
    } catch {}
  }
  if (ordered.length > visible.length) {
    try { new Notification(I18N_LANG === 'en' ? `${ordered.length-visible.length} more new messages` : `还有 ${ordered.length-visible.length} 封新邮件`, { body:L('打开邮汇查看收件箱。'), tag:`youhui-mail-batch-${ordered.at(-1).id}`, renotify:false }); } catch {}
  }
}
async function pollNotificationEvents() {
  if (notificationPollInFlight || $('#appView').classList.contains('hidden')) return;
  notificationPollInFlight = true;
  try {
    let cursor = notificationCursorRead();
    if (cursor === null) {
      const initial = await api('/api/notifications/events');
      notificationCursorWrite(initial.cursor);
      return;
    }
    const data = await api(`/api/notifications/events?after=${encodeURIComponent(cursor)}`);
    const events = Array.isArray(data.events) ? data.events : [];
    if (events.length) {
      notifyNewMail(events);
      if (!document.hidden && state.folder === 'INBOX' && !state.query) void loadMessages();
    }
    notificationCursorWrite(Math.max(cursor, Number(data.cursor) || cursor));
  } catch {}
  finally { notificationPollInFlight = false; }
}
function startNotificationPolling() {
  stopNotificationPolling();
  void pollNotificationEvents();
  notificationPollTimer = setInterval(() => void pollNotificationEvents(), 30_000);
}
function stopNotificationPolling() {
  if (notificationPollTimer) clearInterval(notificationPollTimer);
  notificationPollTimer = null; notificationPollInFlight = false;
}
$('#enableBrowserNotifications').addEventListener('click', async () => {
  const status = $('#browserNotificationStatus');
  if (!('Notification' in window)) { status.textContent = notificationPermissionText(); return; }
  try { await Notification.requestPermission(); }
  catch {}
  status.textContent = notificationPermissionText();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !$('#appView').classList.contains('hidden')) void pollNotificationEvents();
});
function updateAIControls() {
  const configured = Boolean(state.aiConfig?.configured);
  const hasMail = Boolean(state.detail && state.selected);
  for (const selector of ['#aiExplainButton','#aiDraftButton','#aiAttachEmailButton']) {
    const button = $(selector); if (button) button.disabled = !hasMail || state.aiBusy;
  }
  const digestButton = $('#aiDigestButton'); if (digestButton) digestButton.disabled = !configured || state.aiBusy;
  const sendButton = $('#aiSendButton'); if (sendButton) sendButton.disabled = !configured || state.aiBusy;
  const input = $('#aiChatInput'); if (input) input.disabled = !configured || state.aiBusy;
  const status = $('#aiModelStatus');
  if (status) status.textContent = configured
    ? `${state.aiConfig.providerName || L('自定义服务商')} · ${state.aiConfig.model} · ${L('API 已配置')}${state.aiConfig.dailySummaryEnabled ? `${L(' · 每日摘要 ')}${state.aiConfig.dailySummaryTime}${L('（香港时间）')}` : ''}`
    : L('尚未配置模型 API');
  const label = $('#aiContextLabel'); const clear = $('#aiClearContext');
  if (label) {
    label.textContent = state.aiContext ? `${L('已附上：')}${state.aiContext.subject || L('当前邮件')}` : '';
    label.classList.toggle('hidden', !state.aiContext);
  }
  if (clear) clear.classList.toggle('hidden', !state.aiContext);
  if (digestButton && !configured) digestButton.title = L('请先配置模型 API');
  renderAIConversation();
}
function makeAIEmailContext(detail = state.detail) {
  if (!detail) return null;
  const account = state.accounts.find((item) => item.id === detail.accountId);
  return {
    accountEmail: detail.email || account?.email || '',
    subject: String(detail.subject || '(无主题)'),
    from: addressText(detail.from || []),
    date: dateLong(detail.date),
    text: String(detail.text || '').slice(0, 12_000)
  };
}
function makeAIReplyContext(detail = state.detail) {
  const fromAddress = detail?.from?.[0]?.address || '';
  if (!detail || !fromAddress) return null;
  return {
    accountId: detail.accountId,
    to: fromAddress,
    subject: /^re:/i.test(detail.subject || '') ? detail.subject : `Re: ${detail.subject || ''}`,
    inReplyTo: detail.messageId || detail.inReplyTo || '',
    references: [detail.references, detail.messageId].filter(Boolean).join(' ')
  };
}
function renderAIConversation() {
  const root = $('#aiChatMessages'); if (!root) return;
  root.replaceChildren();
  if (!state.aiMessages.length) {
    const welcome = document.createElement('p'); welcome.className = 'ai-welcome';
    welcome.textContent = state.aiConfig?.configured
      ? L('你好，我可以回答问题、解释你主动选择的邮件，或帮你起草回复。所有回复草稿都需要你检查后再发送。')
      : L('可配置任意兼容 OpenAI Chat Completions 的服务商 HTTPS API，自定义服务商名称和地址后即可开始对话。邮件只会在你明确选择功能后发送给模型。');
    root.append(welcome);
  }
  for (const message of state.aiMessages) {
    const wrapper = document.createElement('article'); wrapper.className = `ai-message ${message.role}${message.error ? ' ai-error-message' : ''}`;
    const label = document.createElement('span'); label.className = 'ai-message-label'; label.textContent = message.role === 'user' ? L('你') : L('AI 助手');
    const bubble = document.createElement('div'); bubble.className = 'ai-message-bubble'; bubble.textContent = message.content;
    wrapper.append(label, bubble);
    if (message.role === 'assistant' && message.replyContext && !message.error) {
      const actions = document.createElement('div'); actions.className = 'ai-message-actions';
      const insert = document.createElement('button'); insert.type = 'button'; insert.textContent = L('插入回复草稿');
      insert.addEventListener('click', () => applyAIReplyDraft(message)); actions.append(insert); wrapper.append(actions);
    }
    root.append(wrapper);
  }
  if (state.aiBusy) {
    const loading = document.createElement('div'); loading.className = 'ai-chat-status';
    const spinner = document.createElement('span'); spinner.className = 'spinner';
    loading.append(spinner, document.createTextNode(` ${L(' 正在处理…')}`)); root.append(loading);
  }
  root.scrollTop = root.scrollHeight;
}
async function applyAIReplyDraft(message) {
  const current = ['#composeTo','#composeCc','#composeSubject','#composeBody'].some((selector) => $(selector).value.trim()) || composeFiles.length > 0;
  if (current && !await askConfirm('替换当前邮件草稿？','插入 AI 回复会替换收件人、主题和正文，并清空当前附件；不会发送邮件。','替换草稿')) return;
  openCompose({ ...message.replyContext, quoted: message.content });
}
function openAIChat() {
  $('#aiChatPanel').classList.remove('hidden');
  $('#aiToggleButton').setAttribute('aria-expanded','true');
  updateAIControls();
  if (state.aiConfig?.configured && state.aiConfig.dailySummaryEnabled) void loadLatestAIDigest();
  if (state.aiConfig?.configured) $('#aiChatInput').focus();
  else $('#aiSettingsButton').focus();
}
function closeAIChat(returnFocus = true) {
  $('#aiChatPanel').classList.add('hidden');
  $('#aiToggleButton').setAttribute('aria-expanded','false');
  if (returnFocus) $('#aiToggleButton').focus();
}
function dailyDigestScope() {
  if (state.aiConfig?.dailySummaryEnabled && state.aiConfig.dailySummaryAccountId) return state.aiConfig.dailySummaryAccountId;
  return state.accountId || 'all';
}
function dailyDigestScopeLabel(scope) {
  if (scope === 'all') return L('所有邮箱');
  const account = state.accounts.find((item) => item.id === scope);
  return account?.label || account?.email || L('所选邮箱');
}
async function loadLatestAIDigest() {
  const scope = dailyDigestScope();
  try {
    const data = await api(`/api/ai/digest/latest?accountId=${encodeURIComponent(scope)}`);
    const digest = data.digest;
    if (!digest || state.aiMessages.some((message) => message.digestDay === digest.day && message.digestScope === scope)) return;
    state.aiMessages.push({ role:'assistant', content: I18N_LANG === 'en' ? `Daily digest (${digest.day} · ${dailyDigestScopeLabel(scope)})\n\n${digest.summary}` : `每日摘要（${digest.day} · ${dailyDigestScopeLabel(scope)}）\n\n${digest.summary}`, digestDay:digest.day, digestScope:scope });
    renderAIConversation();
  } catch {}
}
async function sendAIMessage(prompt, { intent='chat', context=null, replyContext=null } = {}) {
  if (!state.aiConfig?.configured) { openAISettings(); return; }
  if (state.aiBusy) return;
  if (context) state.aiContext = context;
  const message = String(prompt || '').trim(); if (!message) return;
  const history = state.aiMessages.filter((item) => !item.error && ['user','assistant'].includes(item.role)).slice(-14).map(({role,content}) => ({role,content}));
  state.aiMessages.push({ role:'user', content:message });
  if (state.aiMessages.length > 60) state.aiMessages = state.aiMessages.slice(-60);
  state.aiBusy = true; updateAIControls();
  try {
    const data = await api('/api/ai/chat', { method:'POST', body:JSON.stringify({ message, history, intent, emailContext:state.aiContext }) });
    state.aiMessages.push({ role:'assistant', content:data.reply, ...(intent === 'reply' && replyContext ? {replyContext} : {}) });
  } catch (error) { state.aiMessages.push({ role:'assistant', content:error.message || L('模型请求失败。'), error:true }); }
  finally { state.aiBusy = false; updateAIControls(); }
}
async function requestDailyAIDigest() {
  if (!state.aiConfig?.configured) { openAISettings(); return; }
  if (state.aiBusy) return;
  const scope = dailyDigestScope();
  const history = state.aiMessages.filter((item) => !item.error && ['user','assistant'].includes(item.role)).slice(-14).map(({role,content}) => ({role,content}));
  state.aiMessages.push({ role:'user', content: I18N_LANG === 'en' ? `Generate a 24-hour inbox digest (${dailyDigestScopeLabel(scope)}).` : `生成最近 24 小时的收件摘要（${dailyDigestScopeLabel(scope)}）。` });
  state.aiBusy = true; updateAIControls();
  try {
    const data = await api('/api/ai/digest', { method:'POST', body:JSON.stringify({ accountId:scope }) });
    const digest = data.digest;
    state.aiMessages.push({ role:'assistant', content: I18N_LANG === 'en' ? `Inbox digest (${digest.day} · ${dailyDigestScopeLabel(scope)} · ${digest.messageCount} messages)\n\n${digest.summary}` : `收件摘要（${digest.day} · ${dailyDigestScopeLabel(scope)} · ${digest.messageCount} 封）\n\n${digest.summary}`, digestDay:digest.day, digestScope:scope });
  } catch (error) { state.aiMessages.push({ role:'assistant', content:error.message || L('摘要生成失败。'), error:true }); }
  finally { state.aiBusy = false; updateAIControls(); }
}
function renderAIDailyAccounts(selected = 'all') {
  const select = $('#aiDailyAccount'); if (!select) return;
  select.replaceChildren();
  select.add(new Option(I18N_LANG === 'en' ? `All connected mailboxes (${state.accounts.length})` : `所有已连接邮箱（${state.accounts.length}）`, 'all'));
  for (const account of state.accounts) select.add(new Option(`${account.label || account.email} · ${account.email}`, account.id));
  select.value = state.accounts.some((account) => account.id === selected) ? selected : 'all';
}
function fillAISettingsForm() {
  const config = state.aiConfig || {};
  const providerDefault = new URL(config.baseUrl || 'https://api.openai.com/v1').hostname === 'api.openai.com' ? 'OpenAI' : L('自定义服务商');
  $('#aiProviderName').value = config.providerName || providerDefault;
  $('#aiBaseUrl').value = config.baseUrl || 'https://api.openai.com/v1';
  $('#aiModel').value = config.model || 'gpt-4o-mini';
  $('#aiApiKey').value = '';
  $('#aiApiKey').placeholder = config.hasApiKey ? L('已保存；留空保留，输入新 Key 可替换') : L('输入模型 API Key');
  $('#aiDailyEnabled').checked = Boolean(config.dailySummaryEnabled);
  $('#aiDailyTime').value = config.dailySummaryTime || '08:00';
  renderAIDailyAccounts(config.dailySummaryAccountId || 'all');
  $('#aiDeleteConfig').disabled = !config.configured;
  $('#aiSettingsStatus').textContent = '';
  $('#aiSettingsStatus').classList.remove('error');
}
async function openAISettings() {
  await openSettings('ai');
}
function aiSettingsPayload() {
  return {
    providerName:$('#aiProviderName').value.trim(), baseUrl:$('#aiBaseUrl').value.trim(), model:$('#aiModel').value.trim(), apiKey:$('#aiApiKey').value,
    dailySummaryEnabled:$('#aiDailyEnabled').checked, dailySummaryTime:$('#aiDailyTime').value || '08:00',
    dailySummaryAccountId:$('#aiDailyAccount').value || 'all'
  };
}
function aiSettingsStatus(text, isError = false) {
  const node = $('#aiSettingsStatus'); node.textContent = L(text); node.classList.toggle('error', isError);
}
function updateTranslationProviderFields() {
  const provider = $('#translationProvider').value;
  $$('[data-translation-provider-fields]').forEach((panel) => panel.classList.toggle('hidden', panel.dataset.translationProviderFields !== provider));
  const config = state.translationConfig || {};
  const configured = provider === 'niutrans' ? Boolean(config.hasNiuTransAppId && config.hasNiuTransApiKey)
    : provider === 'google' ? Boolean(config.hasGoogleApiKey) : Boolean(config.hasAzureApiKey);
  translationSettingsStatus(configured ? '当前服务商的凭据已保存。' : '当前服务商尚未配置。');
}
function translationSettingsStatus(text, isError = false) {
  const node = $('#translationSettingsStatus'); node.textContent = L(text); node.classList.toggle('error', isError);
}
function fillTranslationSettingsForm() {
  const config = state.translationConfig || {};
  const provider = ['niutrans', 'google', 'azure'].includes(config.provider) ? config.provider : 'niutrans';
  $('#translationProvider').value = provider;
  $('#niutransAppId').value = ''; $('#niutransApiKey').value = ''; $('#googleApiKey').value = ''; $('#azureApiKey').value = ''; $('#azureRegion').value = '';
  $('#niutransAppId').placeholder = config.hasNiuTransAppId ? L('已保存；留空保留，填写新 App ID 可替换') : L('小牛翻译控制台中的 App ID');
  $('#niutransApiKey').placeholder = config.hasNiuTransApiKey ? L('已保存；留空保留，输入新 Key 可替换') : L('输入小牛翻译 API Key');
  $('#googleApiKey').placeholder = config.hasGoogleApiKey ? L('已保存；留空保留，输入新 Key 可替换') : L('输入 Google Cloud Translation API Key');
  $('#azureApiKey').placeholder = config.hasAzureApiKey ? L('已保存；留空保留，输入新 Key 可替换') : L('输入 Azure Translator Key');
  $('#azureRegion').placeholder = config.hasAzureRegion ? L('已保存；留空保留，输入新区域可替换') : L('例如 eastasia');
  const hasAny = config.hasNiuTransAppId || config.hasNiuTransApiKey || config.hasGoogleApiKey || config.hasAzureApiKey || config.hasAzureRegion;
  $('#translationDeleteConfig').disabled = !hasAny;
  updateTranslationProviderFields();
  translationSettingsStatus(config.configured ? '当前服务商的凭据已保存。' : '当前服务商尚未配置。');
}
function translationSettingsPayload() {
  return {
    provider:$('#translationProvider').value, niutransAppId:$('#niutransAppId').value, niutransApiKey:$('#niutransApiKey').value,
    googleApiKey:$('#googleApiKey').value, azureApiKey:$('#azureApiKey').value, azureRegion:$('#azureRegion').value
  };
}
$('#aiToggleButton').addEventListener('click', () => {
  if ($('#aiChatPanel').classList.contains('hidden')) openAIChat();
});
$('#aiCloseButton').addEventListener('click', () => closeAIChat());
$('#aiSettingsButton').addEventListener('click', openAISettings);
$('#aiExplainButton').addEventListener('click', () => {
  if (!state.detail) return;
  const context = makeAIEmailContext();
  void sendAIMessage(L('请用中文解释这封邮件的主旨、对我的明确要求、时间要求和建议的后续动作。'), { intent:'explain', context });
});
$('#aiDraftButton').addEventListener('click', () => {
  if (!state.detail) return;
  const context = makeAIEmailContext(); const replyContext = makeAIReplyContext();
  if (!replyContext) return toast(L('未能识别发件人地址，无法准备回复草稿。'), true);
  void sendAIMessage(L('请根据邮件内容起草一封合适、简洁的中文回复。只生成草稿，不要发送。'), { intent:'reply', context, replyContext });
});
$('#aiAttachEmailButton').addEventListener('click', () => {
  if (!state.detail) return;
  state.aiContext = makeAIEmailContext(); updateAIControls();
  toast(L('已附上当前邮件；后续对话会将其发送到已配置的模型 API。'));
});
$('#aiClearContext').addEventListener('click', () => { state.aiContext = null; updateAIControls(); });
$('#aiDigestButton').addEventListener('click', requestDailyAIDigest);
$('#translationProvider').addEventListener('change', updateTranslationProviderFields);
$('#aiChatForm').addEventListener('submit', (event) => {
  event.preventDefault(); const input = $('#aiChatInput'); const prompt = input.value.trim();
  if (!prompt) return;
  if (!state.aiConfig?.configured) return openAISettings();
  input.value = ''; void sendAIMessage(prompt);
});
$('#aiChatInput').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); $('#aiChatForm').requestSubmit(); }
});
$('#aiSettingsForm').addEventListener('submit', async (event) => {
  event.preventDefault(); const button = $('#aiSaveConfig'); button.disabled = true; aiSettingsStatus('正在保存…');
  try {
    state.aiConfig = await api('/api/ai/config', { method:'PUT', body:JSON.stringify(aiSettingsPayload()) });
    $('#aiApiKey').value = ''; fillAISettingsForm(); updateAIControls(); aiSettingsStatus('设置已保存；API Key 不会回传或显示。');
  } catch (error) { aiSettingsStatus(error.message, true); }
  finally { button.disabled = false; }
});
$('#aiTestConfig').addEventListener('click', async () => {
  const button = $('#aiTestConfig'); button.disabled = true; aiSettingsStatus('正在测试 API；模型服务可能会收取少量费用…');
  try {
    const result = await api('/api/ai/test', { method:'POST', body:JSON.stringify(aiSettingsPayload()) });
    aiSettingsStatus(`${result.message}（${result.sample}）`);
  } catch (error) { aiSettingsStatus(error.message, true); }
  finally { button.disabled = false; }
});
$('#aiDeleteConfig').addEventListener('click', async () => {
  if (!state.aiConfig?.configured) return;
  if (!await askConfirm('清除 AI 配置？','这会删除加密保存的 API Key、模型设置和本工作台保存的 AI 摘要；不会影响邮箱账户或邮件。','清除配置',true)) return;
  try {
    await api('/api/ai/config', { method:'DELETE' }); state.aiConfig = null; state.aiMessages = []; state.aiContext = null;
    fillAISettingsForm(); updateAIControls(); aiSettingsStatus('AI 配置与已保存摘要已清除。');
  } catch (error) { aiSettingsStatus(error.message, true); }
});
$('#translationSettingsForm').addEventListener('submit', async (event) => {
  event.preventDefault(); const button = $('#translationSaveConfig'); button.disabled = true; translationSettingsStatus('正在保存…');
  try {
    state.translationConfig = await api('/api/translation/config', { method:'PUT', body:JSON.stringify(translationSettingsPayload()) });
    fillTranslationSettingsForm(); translationSettingsStatus('设置已保存；凭据不会回传或显示。');
  } catch (error) { translationSettingsStatus(error.message, true); }
  finally { button.disabled = false; }
});
$('#translationDeleteConfig').addEventListener('click', async () => {
  const config = state.translationConfig || {};
  const hasAny = config.hasNiuTransAppId || config.hasNiuTransApiKey || config.hasGoogleApiKey || config.hasAzureApiKey || config.hasAzureRegion;
  if (!hasAny) return;
  if (!await askConfirm('清除翻译配置？','这会删除加密保存的所有翻译服务商凭据；不会影响 AI 配置、邮箱账户或邮件。','清除配置',true)) return;
  try {
    await api('/api/translation/config', { method:'DELETE' });
    state.translationConfig = { provider:'niutrans', configured:false, hasNiuTransAppId:false, hasNiuTransApiKey:false, hasGoogleApiKey:false, hasAzureApiKey:false, hasAzureRegion:false };
    fillTranslationSettingsForm(); translationSettingsStatus('翻译配置已清除。');
  } catch (error) { translationSettingsStatus(error.message, true); }
});
function notificationsSettingsStatus(text, isError = false) {
  const node = $('#notificationsSettingsStatus'); node.textContent = L(text); node.classList.toggle('error', isError);
}
$('#notificationsSettingsForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const uidTargets = $('#wxpusherUids').value.split(/[\n,，]+/).map(value => value.trim()).filter(Boolean);
  const topicTargets = $('#wxpusherTopicIds').value.split(/[\n,，]+/).map(value => value.trim()).filter(Boolean);
  if ($('#wxpusherEnabled').checked && !uidTargets.length && !topicTargets.length) return notificationsSettingsStatus('启用 WxPusher 时，UID 与 topicId 不能同时为空。', true);
  const button = $('#saveNotificationsConfig'); button.disabled = true; notificationsSettingsStatus('正在保存…');
  try {
    state.notificationConfig = await api('/api/notifications/config', { method:'PUT', body:JSON.stringify({
      enabled:$('#notificationChecksEnabled').checked, intervalSeconds:Number($('#notificationInterval').value),
      webhookEnabled:$('#webhookEnabled').checked, webhookUrl:$('#webhookUrl').value.trim(), webhookSecret:$('#webhookSecret').value,
      pushProvider:$('#notificationProvider').value, wxpusherEnabled:$('#wxpusherEnabled').checked,
      wxpusherAppToken:$('#wxpusherAppToken').value.trim(),
      wxpusherUids:uidTargets, wxpusherTopicIds:topicTargets
    }) });
    fillNotificationSettingsForm();
    notificationsSettingsStatus('设置已保存；Webhook 地址、签名密钥与 AppToken 不会回传。WxPusher 测试只表示服务端已受理发送任务，不保证送达。');
  } catch (error) { notificationsSettingsStatus(error.message, true); }
  finally { button.disabled = false; $('#webhookUrl').value = ''; $('#webhookSecret').value = ''; $('#wxpusherAppToken').value = ''; }
});
$('#clearWebhookConfig').addEventListener('click', async () => {
  const configured = state.notificationConfig?.webhookConfigured || state.notificationConfig?.webhookSecretConfigured;
  if (!configured) return;
  if (!await askConfirm('清除 Webhook 配置？','这会删除已保存的地址和签名密钥，并停止后续 Webhook 推送；定时检查与浏览器通知设置不受影响。','清除 Webhook',true)) return;
  const button = $('#clearWebhookConfig'); button.disabled = true;
  try {
    state.notificationConfig = await api('/api/notifications/webhook', { method:'DELETE' });
    fillNotificationSettingsForm(); notificationsSettingsStatus('Webhook 地址与签名密钥已清除。');
  } catch (error) { notificationsSettingsStatus(error.message, true); }
  finally { button.disabled = false; }
});
$('#testWebhook').addEventListener('click', async () => {
  if (!state.notificationConfig?.webhookConfigured) return notificationsSettingsStatus('请先保存 Webhook 地址；测试只会发送到已保存的地址。', true);
  const button = $('#testWebhook'); button.disabled = true; notificationsSettingsStatus('正在向已保存的 Webhook 地址发送合成测试事件…');
  try {
    const result = await api('/api/notifications/webhook/test', { method:'POST', body:JSON.stringify({}) });
    notificationsSettingsStatus(result.message || '测试通知已成功发送。');
  } catch (error) { notificationsSettingsStatus(error.message, true); }
  finally { button.disabled = !state.notificationConfig?.webhookConfigured; }
});
$('#testWxpusher').addEventListener('click', async () => {
  if (!state.notificationConfig?.wxpusherAppTokenConfigured) return notificationsSettingsStatus('请先保存 WxPusher AppToken 与至少一个接收目标。', true);
  const button = $('#testWxpusher'); button.disabled = true; notificationsSettingsStatus('正在提交 WxPusher 合成测试事件…');
  try {
    await api('/api/notifications/wxpusher/test', { method:'POST', body:JSON.stringify({}) });
    notificationsSettingsStatus('WxPusher 已受理发送任务，不保证送达。');
  } catch (error) { notificationsSettingsStatus(error.message, true); }
  finally {
    const saved = state.notificationConfig || {};
    button.disabled = !saved.wxpusherAppTokenConfigured || (!String(saved.wxpusherUids || '').trim() && !String(saved.wxpusherTopicIds || '').trim());
  }
});
function oauthSettingsStatus(message, isError = false) {
  const node = $('#oauthSettingsStatus'); node.textContent = L(message); node.classList.toggle('error', isError);
}
$('#oauthSettingsForm').addEventListener('submit', async (event) => {
  event.preventDefault(); const button = $('#saveOAuthConfig'); button.disabled = true; oauthSettingsStatus('正在加密保存 OAuth 设置…');
  try {
    state.oauthConfig = await api('/api/oauth/config', { method:'PUT', body:JSON.stringify({
      mailbox: {
        google: { clientId:$('#mailGoogleClientId').value, clientSecret:$('#mailGoogleClientSecret').value },
        microsoft: { clientId:$('#mailMicrosoftClientId').value, clientSecret:$('#mailMicrosoftClientSecret').value }
      },
      login: {
        google: { clientId:$('#loginGoogleClientId').value, clientSecret:$('#loginGoogleClientSecret').value },
        github: { clientId:$('#loginGithubClientId').value, clientSecret:$('#loginGithubClientSecret').value },
        cloudflare: { configurationUrl:$('#loginCloudflareConfigurationUrl').value, clientId:$('#loginCloudflareClientId').value, clientSecret:$('#loginCloudflareClientSecret').value }
      }
    }) });
    fillOAuthSettingsForm(); state.status = await api('/api/status');
    oauthSettingsStatus('设置已加密保存；客户端密钥不会回传或显示。');
  } catch (error) { oauthSettingsStatus(error.message, true); }
  finally { button.disabled = false; }
});
$$('[data-bind-identity]').forEach((button) => button.addEventListener('click', async () => {
  const provider = button.dataset.bindIdentity;
  const current = state.oauthConfig?.login?.[provider];
  if (current?.bound && !await askConfirm(I18N_LANG === 'en' ? `Relink ${provider}?` : `重新绑定 ${provider}？`, L('重新授权后，此登录方式将绑定到本次授权的身份；旧绑定会被替换。'), L('继续授权'))) return;
  await startExternalLogin(provider, 'bind');
}));
$$('[data-unbind-identity]').forEach((button) => button.addEventListener('click', async () => {
  const provider = button.dataset.unbindIdentity;
  if (!await askConfirm(I18N_LANG === 'en' ? `Unlink the ${provider} identity?` : `解除 ${provider} 绑定？`, L('此操作会删除该第三方身份的工作台登录权限；仍可使用工作台密码解锁。'), L('解除绑定'), true)) return;
  button.disabled = true;
  try {
    state.oauthConfig = await api(`/api/identity/${encodeURIComponent(provider)}`, { method:'DELETE' });
    state.status = await api('/api/status'); fillOAuthSettingsForm(); toast(`${provider} ${L('身份已解除绑定。')}`);
  } catch (error) { oauthSettingsStatus(error.message, true); }
  finally { button.disabled = false; }
}));

boot();
