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
  // 删信改用两段式确认：首次点击武装按钮、再次点击执行，避免逐封弹窗打断
  assert.match(handler, /approvalUids\.length > 1/);
  assert.match(handler, /button\.dataset\.armed !== '1'/);
  assert.match(handler, /再点一次：整批移入已删除/);
  assert.match(handler, /setTimeout\(\(\) => disarmMcpApproval\(button\), 3000\)/);
  // 发送邮件仍保留 askConfirm 弹窗（收件人/正文需核对）
  assert.match(handler, /askConfirm\(L\('确认发送这封邮件？'\)/);
});

test('approval banner offers one-tap confirm-all for deletion requests', () => {
  const index = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const banner = app.match(/\$\('#mcpApproveAll'\)\.addEventListener\('click', async \(event\) => \{([\s\S]*?)\n\}\);/)?.[1] || '';
  assert.match(index, /<button id="mcpApproveAll" type="button" class="hidden">全部确认<\/button>/);
  assert.match(banner, /kind === 'manage_email'/);
  assert.match(banner, /button\.dataset\.armed !== '1'/);
  assert.match(banner, /\/api\/mcp\/approvals\/\$\{encodeURIComponent\(item\.id\)\}\/approve/);
  // 重新渲染时按钮随待确认列表显隐并重置文案
  assert.match(app, /approveAll\.classList\.toggle\('hidden', !deletions\.length\)/);
});
