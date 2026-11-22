(function attachMailContextActions(root) {
  const TRASH_NAMES = new Set([
    'trash', 'deleted', 'deleted items', 'deleted messages', 'deleted mail',
    '已删除', '已删除邮件', '已删除项目', '垃圾箱'
  ]);
  const ARCHIVE_NAMES = new Set(['archive', 'archived', '归档', '已归档']);

  function normalizedNames(folder, folders) {
    const path = String(folder || '').trim();
    if (!path) return [];
    const record = Array.isArray(folders)
      ? folders.find((item) => String(item?.path || '').toLowerCase() === path.toLowerCase())
      : null;
    const segments = path.replace(/\\/g, '/').split('/').map((part) => part.trim()).filter(Boolean);
    return [...new Set([record?.name, ...segments].filter(Boolean).map((name) => String(name).trim().toLowerCase()))];
  }

  function matchesFolder(folder, folders, aliases) {
    return normalizedNames(folder, folders).some((name) => aliases.has(name));
  }

  function buildMessageActions(message = {}, activeFolder = 'INBOX', folders = []) {
    const folder = message.folder || activeFolder;
    const unread = message.unread === true;
    const flagged = message.flagged === true;
    const actions = [
      { action: unread ? 'read' : 'unread', label: unread ? '标为已读' : '标为未读' },
      { action: flagged ? 'unstar' : 'star', label: flagged ? '取消星标' : '加星标' }
    ];
    if (!matchesFolder(folder, folders, ARCHIVE_NAMES)) actions.push({ action: 'archive', label: '归档' });
    if (!matchesFolder(folder, folders, TRASH_NAMES)) actions.push({ action: 'delete', label: '移到垃圾箱', destructive: true });
    return actions;
  }

  root.YouhuiMailContextActions = Object.freeze({ buildMessageActions });
})(globalThis);
