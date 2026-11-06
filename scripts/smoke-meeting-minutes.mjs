// 会议纪要助手端到端真实冒烟（26 SPEC §18.5 E2E）
// 用法：node scripts/smoke-meeting-minutes.mjs <baseUrl>
const base = process.argv[2] ?? 'http://127.0.0.1:3199';
const j = async (method, path, body) => {
  const init = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(base + path, init);
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
};

const log = (step, ok, detail = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}  ${detail}`);

const r1 = await j('POST', '/api/v1/studio/sessions', { title: '会议纪要助手' });
const sessionId = r1.data.id;
log('创建会话', r1.status === 200, sessionId);

await j('POST', `/api/v1/studio/sessions/${sessionId}/messages`, {
  role: 'user',
  content: '帮我整理会议纪要，输出 Markdown',
});
log('发需求消息', true);

const r3 = await j('POST', `/api/v1/studio/sessions/${sessionId}/generate-spec`);
const draftId = r3.data.id;
log('生成 Spec', r3.status === 200, `draft=${draftId} id=${r3.data.spec.extension.id}`);

const r4 = await j('POST', `/api/v1/extension-drafts/${draftId}/assistant`, {
  systemPrompt: '你是会议纪要助手，把会议原文整理为结构化纪要。',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  outputSchema: {
    type: 'object',
    properties: { summary: { type: 'string' } },
    required: ['summary'],
  },
  toolWhitelist: ['artifact.publish'],
  modelRequirements: { structuredOutput: true },
});
log('创建 Assistant 草稿', r4.status === 200);

for (const kind of ['build', 'test', 'eval']) {
  const r = await j('POST', `/api/v1/extension-drafts/${draftId}/${kind}`);
  log(`验证 ${kind}`, r.data?.status === 'passed');
}

const r6 = await j('GET', `/api/v1/extension-drafts/${draftId}/permissions-review`);
log('权限审阅', r6.status === 200, `风险 ${r6.data.risks.length} 项`);

const r7 = await j('POST', `/api/v1/extension-drafts/${draftId}/publish-request`);
const extensionId = r7.data.version.extensionId;
const version = r7.data.version.version;
log('发布请求', r7.status === 200, `ext=${extensionId} v${version}`);

const r8 = await j('POST', `/api/v1/extensions/${extensionId}/versions/${version}/install`);
log('安装', r8.data?.version?.status === 'installed', r8.data?.version?.status);

const r9 = await j('POST', `/api/v1/extensions/${extensionId}/rollback`);
log('回滚（无更早版本→409）', r9.status === 409, `HTTP ${r9.status}`);

const r10 = await j('GET', '/api/v1/extensions');
log('扩展列表', r10.status === 200, `total=${r10.data.total}`);
