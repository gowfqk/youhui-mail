import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('web app starts MCP approval polling before mailbox loading and resumes on focus', () => {
  const showApp = app.match(/async function showApp\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
  const startPolling = showApp.indexOf('startMcpApprovalPolling();');
  const loadMailbox = showApp.indexOf('await loadAccounts();');

  assert.ok(startPolling >= 0 && loadMailbox >= 0 && startPolling < loadMailbox);
  assert.match(app, /document\.addEventListener\('visibilitychange',[\s\S]*?if \(!document\.hidden\) void pollMcpApprovals\(\)/);
  assert.match(app, /window\.addEventListener\('focus',[\s\S]*?void pollMcpApprovals\(\)/);
});

test('web app exposes approval polling failures instead of silently hiding them', () => {
  assert.match(app, /catch \{\s*mcpApprovalPollError = true;\s*renderMcpApprovals\(\);\s*\}/);
  assert.match(app, /\(!list\.length && !mcpApprovalPollError\)/);
  assert.match(app, /暂时无法读取待确认操作，请稍后重试/);
});

test('batch delete approval shows all UIDs and asks for one confirmation for the whole batch', () => {
  const handler = app.match(/\$\('#mcpApprovalList'\)\.addEventListener\('click', async \(event\) => \{([\s\S]*?)\n\}\);/)?.[1] || '';

  assert.match(app, /const uids = Array\.isArray\(item\.uids\)/);
  assert.match(app, /待批量移入已删除（\$\{uids\.length\} 封）/);
  assert.match(handler, /approvalUids\.join\(/);
  assert.match(handler, /if \(!await askConfirm\(confirmTitle, copy, confirmLabel, true\)\) return;/);
  assert.equal((handler.match(/askConfirm\(/g) || []).length, 1);
});
