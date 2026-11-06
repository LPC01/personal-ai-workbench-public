import { describe, expect, it } from 'vitest';
import {
  HARNESS_ADAPTERS,
  adapterMeta,
  parseHarnessConfig,
  validateHarnessDraft,
  validateHarnessId,
} from '../harness-profile';

/**
 * UI-09：Harness Profile 表单纯逻辑。
 *
 * 重点是不与后端错位：deepseek 缺 baseUrl 时 DeepSeekHarnessAdapter 构造即抛
 * HARNESS_UNAVAILABLE；openai-agents 契约已声明但适配器工厂无该分支。
 * 这两条必须在提交前就告诉用户，而不是等探测才炸。
 */

describe('validateHarnessId', () => {
  it('接受普通 id', () => {
    expect(validateHarnessId('harness-mock')).toBeNull();
  });

  it('拒绝空与空白', () => {
    expect(validateHarnessId('')).not.toBeNull();
    expect(validateHarnessId('   ')).not.toBeNull();
  });

  it('拒绝含空格与超长 id', () => {
    expect(validateHarnessId('has space')).not.toBeNull();
    expect(validateHarnessId('a'.repeat(65))).not.toBeNull();
  });
});

describe('parseHarnessConfig', () => {
  it('空输入视为空对象', () => {
    expect(parseHarnessConfig('   ')).toEqual({ ok: true, config: {} });
  });

  it('解析合法对象', () => {
    expect(parseHarnessConfig('{"baseUrl":"http://x"}')).toEqual({
      ok: true,
      config: { baseUrl: 'http://x' },
    });
  });

  it('非法 JSON 报错', () => {
    const r = parseHarnessConfig('{oops');
    expect(r.ok).toBe(false);
  });

  it('反向断言：数组与 null 都不是合法 config', () => {
    expect(parseHarnessConfig('[]').ok).toBe(false);
    expect(parseHarnessConfig('null').ok).toBe(false);
  });
});

describe('validateHarnessDraft', () => {
  it('mock 类型无需 baseUrl', () => {
    expect(
      validateHarnessDraft({ id: 'm', name: 'M', adapterType: 'mock', config: {} }),
    ).toBeNull();
  });

  it('deepseek 缺 baseUrl 时拦下（否则探测才报 HARNESS_UNAVAILABLE）', () => {
    expect(
      validateHarnessDraft({ id: 'd', name: 'D', adapterType: 'deepseek', config: {} }),
    ).toContain('baseUrl');
  });

  it('deepseek 带 baseUrl 通过', () => {
    expect(
      validateHarnessDraft({
        id: 'd',
        name: 'D',
        adapterType: 'deepseek',
        config: { baseUrl: 'http://127.0.0.1:8100' },
      }),
    ).toBeNull();
  });

  it('未知适配器类型被拦下', () => {
    expect(
      validateHarnessDraft({ id: 'x', name: 'X', adapterType: 'nope', config: {} }),
    ).not.toBeNull();
  });

  it('缺名称被拦下', () => {
    expect(
      validateHarnessDraft({ id: 'x', name: '  ', adapterType: 'mock', config: {} }),
    ).not.toBeNull();
  });
});

describe('适配器元信息', () => {
  it('三种契约类型都有元信息', () => {
    expect(HARNESS_ADAPTERS.map((a) => a.type)).toEqual(['deepseek', 'mock', 'openai-agents']);
  });

  it('openai-agents 标记为未实现（创建能成功但探测/运行必失败）', () => {
    expect(adapterMeta('openai-agents')?.implemented).toBe(false);
  });

  it('deepseek 与 mock 标记为已实现', () => {
    expect(adapterMeta('deepseek')?.implemented).toBe(true);
    expect(adapterMeta('mock')?.implemented).toBe(true);
  });
});
