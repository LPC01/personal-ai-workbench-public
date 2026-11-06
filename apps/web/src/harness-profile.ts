/**
 * Harness Profile 表单的纯逻辑（UI-09）：适配器元信息、config 解析与提交前校验。
 *
 * 抽成纯函数是为了可单测——这些规则必须与后端行为一致，否则会出现
 * 「界面上保存成功、运行时才炸」的错位：
 * - `deepseek` 缺 `baseUrl` 时，`DeepSeekHarnessAdapter` 构造即抛 `HARNESS_UNAVAILABLE`；
 * - `openai-agents` 契约已声明，但 `createHarnessAdapter` 未实现该分支，会抛
 *   「不支持的 Harness Adapter 类型」——界面必须提前如实交代，不能让它看起来可选。
 */

export type HarnessAdapterType = 'deepseek' | 'openai-agents' | 'mock';

export interface HarnessAdapterMeta {
  type: HarnessAdapterType;
  label: string;
  /** 适配器已在 Execution Gateway 工厂中实现；false 表示创建成功但探测/运行必失败。 */
  implemented: boolean;
  hint: string;
  /** 新建表单里预填的 config 模板（JSON 文本）。 */
  template: string;
}

export const HARNESS_ADAPTERS: readonly HarnessAdapterMeta[] = [
  {
    type: 'deepseek',
    label: 'DeepSeek Harness',
    implemented: true,
    hint: '必填 baseUrl（Harness 服务地址）；可选 timeoutSeconds（默认 30）。',
    template: '{\n  "baseUrl": "http://127.0.0.1:8100",\n  "timeoutSeconds": 30\n}',
  },
  {
    type: 'mock',
    label: 'Mock（联调 / 回归）',
    implemented: true,
    hint: '无外部依赖。可配 script 数组编排回合；未配时每回合返回空内容并立即结束。',
    template:
      '{\n  "script": [\n    {\n      "content": "已收到指令",\n      "toolCalls": [],\n      "stopReason": "end"\n    }\n  ]\n}',
  },
  {
    type: 'openai-agents',
    label: 'OpenAI Agents',
    implemented: false,
    hint: '契约已声明该类型，但适配器尚未实现：创建能成功，探测与运行都会失败。',
    template: '{}',
  },
];

export function adapterMeta(type: string): HarnessAdapterMeta | undefined {
  return HARNESS_ADAPTERS.find((a) => a.type === type);
}

/** id 规则：非空、无空白字符、长度 1–64。后端 store 不校验，故在提交前拦下。 */
export function validateHarnessId(id: string): string | null {
  const trimmed = id.trim();
  if (trimmed.length === 0) return '请填写 id';
  if (/\s/.test(trimmed)) return 'id 不能包含空格';
  if (trimmed.length > 64) return 'id 长度不能超过 64';
  return null;
}

export type ParseResult =
  { ok: true; config: Record<string, unknown> } | { ok: false; error: string };

/** 解析 config 文本：空输入视为 `{}`；必须是 JSON 对象（数组与 null 都不合法）。 */
export function parseHarnessConfig(text: string): ParseResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: true, config: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    return { ok: false, error: `config 不是合法 JSON：${(e as Error).message}` };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'config 必须是 JSON 对象' };
  }
  return { ok: true, config: parsed as Record<string, unknown> };
}

/** 提交前校验：返回首个错误，无错返回 null。 */
export function validateHarnessDraft(input: {
  id: string;
  name: string;
  adapterType: string;
  config: Record<string, unknown>;
}): string | null {
  const idError = validateHarnessId(input.id);
  if (idError) return idError;
  if (input.name.trim().length === 0) return '请填写名称';
  const meta = adapterMeta(input.adapterType);
  if (!meta) return `未知的适配器类型：${input.adapterType}`;
  if (input.adapterType === 'deepseek') {
    const baseUrl = input.config['baseUrl'];
    if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) {
      return 'deepseek 类型必须配置 baseUrl（Harness 服务地址），否则探测会报 HARNESS_UNAVAILABLE';
    }
  }
  return null;
}
