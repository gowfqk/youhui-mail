(function attachMailListCache(root) {
  const PREFIX = 'youhui-mail:list-cache:v1:';
  const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
  const DEFAULT_MAX_ENTRIES = 48;
  const MAX_MESSAGES = 30;
  const MAX_ENTRY_BYTES = 200_000;

  function defaultStorage() {
    try { return root.localStorage || null; } catch { return null; }
  }

  function boundedText(value, limit) {
    if (value === null || value === undefined) return '';
    return String(value).slice(0, limit);
  }

  function normalizeScope(scope = {}) {
    const pageValue = Number(scope.page);
    const pageText = String(scope.page ?? '').trim();
    return {
      accountId: String(scope.accountId ?? 'all'),
      folder: String(scope.folder ?? 'INBOX'),
      // 数字页码照旧收敛；字符串页键（UID 游标页）保留原值以便区分各游标页。
      // 按账户游标是多账户的 JSON 映射，放宽上限避免多账户部署时键超限退化为第 1 页
      page: Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : (pageText && pageText.length <= 2048 ? pageText : 1),
      query: String(scope.query ?? '').trim()
    };
  }

  function projectMessage(message, fallbackFolder) {
    if (!message || typeof message !== 'object') return null;
    const accountId = boundedText(message.accountId, 256);
    const uid = message.uid;
    if (!accountId || !((typeof uid === 'string' && uid.length <= 128) || (typeof uid === 'number' && Number.isFinite(uid)))) return null;
    const from = Array.isArray(message.from) ? message.from.slice(0, 10).map((person) => ({
      name: boundedText(person?.name, 500),
      address: boundedText(person?.address, 320)
    })) : [];
    const date = typeof message.date === 'string' || typeof message.date === 'number' ? message.date : '';
    return {
      uid,
      accountId,
      accountEmail: boundedText(message.accountEmail, 320),
      folder: boundedText(message.folder || fallbackFolder, 512),
      subject: boundedText(message.subject, 2048),
      from,
      date,
      unread: message.unread === true,
      flagged: message.flagged === true
    };
  }

  function projectList(data, folder) {
    const messages = Array.isArray(data?.messages)
      ? data.messages.slice(0, MAX_MESSAGES).map((message) => projectMessage(message, folder)).filter(Boolean)
      : [];
    const rawTotal = Number(data?.total);
    const total = Number.isFinite(rawTotal) ? Math.max(0, Math.floor(rawTotal)) : messages.length;
    return { messages, total, hasMore: data?.hasMore === true };
  }

  function create(storage = defaultStorage(), options = {}) {
    const maxAgeMs = Number.isFinite(Number(options.maxAgeMs)) && Number(options.maxAgeMs) > 0
      ? Number(options.maxAgeMs) : DEFAULT_MAX_AGE_MS;
    const maxEntries = Number.isSafeInteger(Number(options.maxEntries)) && Number(options.maxEntries) > 0
      ? Number(options.maxEntries) : DEFAULT_MAX_ENTRIES;

    function keyFor(scope) {
      const normalized = normalizeScope(scope);
      return `${PREFIX}${encodeURIComponent(normalized.accountId)}:${encodeURIComponent(normalized.folder)}:${normalized.page}:${encodeURIComponent(normalized.query)}`;
    }

    function keys() {
      if (!storage) return [];
      const result = [];
      try {
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index);
          if (typeof key === 'string' && key.startsWith(PREFIX)) result.push(key);
        }
      } catch {}
      return result;
    }

    function remove(key) {
      try { storage?.removeItem(key); } catch {}
    }

    function read(scope) {
      const key = keyFor(scope);
      if (!storage) return null;
      try {
        const raw = storage.getItem(key);
        if (!raw) return null;
        const record = JSON.parse(raw);
        const age = Date.now() - Number(record?.savedAt);
        if (record?.version !== 1 || !Number.isFinite(age) || age < -60_000 || age > maxAgeMs || !record.data || !Array.isArray(record.data.messages)) {
          remove(key);
          return null;
        }
        return projectList(record.data, normalizeScope(scope).folder);
      } catch {
        remove(key);
        return null;
      }
    }

    function storedEntries() {
      return keys().map((key) => {
        let savedAt = 0;
        try { savedAt = Number(JSON.parse(storage.getItem(key))?.savedAt) || 0; } catch {}
        return { key, savedAt };
      }).sort((a, b) => a.savedAt - b.savedAt);
    }

    function prune(protectedKey = '') {
      const now = Date.now();
      const entries = storedEntries();
      for (const entry of entries) {
        if (entry.key !== protectedKey && (!entry.savedAt || now - entry.savedAt > maxAgeMs)) remove(entry.key);
      }
      const remaining = storedEntries();
      let excess = remaining.length - maxEntries;
      for (const entry of remaining) {
        if (excess <= 0) break;
        if (entry.key === protectedKey) continue;
        remove(entry.key);
        excess -= 1;
      }
    }

    function write(scope, data) {
      if (!storage) return false;
      const key = keyFor(scope);
      const record = { version: 1, savedAt: Date.now(), data: projectList(data, normalizeScope(scope).folder) };
      const serialized = JSON.stringify(record);
      if (serialized.length > MAX_ENTRY_BYTES) return false;
      try {
        storage.setItem(key, serialized);
        prune(key);
        return true;
      } catch {
        for (const entry of storedEntries()) {
          if (entry.key === key) continue;
          remove(entry.key);
          try {
            storage.setItem(key, serialized);
            prune(key);
            return true;
          } catch {}
        }
        return false;
      }
    }

    function clear() {
      for (const key of keys()) remove(key);
    }

    function clearAccount(accountId) {
      const id = String(accountId ?? '');
      if (!id || id === 'all') return clear();
      const ownPrefix = `${PREFIX}${encodeURIComponent(id)}:`;
      const allAccountsPrefix = `${PREFIX}all:`;
      for (const key of keys()) {
        if (key.startsWith(ownPrefix) || key.startsWith(allAccountsPrefix)) remove(key);
      }
    }

    function load(scope, fetchFresh, onUpdate = () => {}) {
      const cached = read(scope);
      if (cached) onUpdate(cached, 'cache');
      return Promise.resolve().then(fetchFresh).then((fresh) => {
        write(scope, fresh);
        onUpdate(fresh, 'network');
        return fresh;
      });
    }

    return { keyFor, read, write, clear, clearAccount, load };
  }

  root.YouhuiMailListCache = { create };
})(globalThis);
