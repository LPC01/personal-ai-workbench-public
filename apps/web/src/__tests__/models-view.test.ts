import { describe, expect, it } from 'vitest';
import { avatarHue, avatarInitial } from '../ModelProviderCard';
import { buildModelTree } from '../ModelsView';
import type { ModelProfile, ModelProvider } from '../api';

function provider(id: string, extra: Partial<ModelProvider> = {}): ModelProvider {
  return {
    id,
    name: `名称-${id}`,
    type: 'ollama',
    baseUrl: `http://127.0.0.1:${10000 + id.length}`,
    credentialRef: null,
    revision: 1,
    ...extra,
  };
}

function profile(id: string, providerId: string, extra: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id,
    name: `档案-${id}`,
    providerId,
    modelId: 'qwen2.5:7b',
    capabilities: ['chat'],
    contextLimit: 32768,
    dataBoundary: 'local-only',
    fallbackProfileId: null,
    revision: 1,
    ...extra,
  };
}

describe('buildModelTree', () => {
  const providers = [
    provider('a', { name: '甲-本地' }),
    provider('b', { name: '乙-远端', type: 'openai-compatible' }),
  ];
  const profiles = [
    profile('p1', 'a'),
    profile('p2', 'a', { modelId: 'bge-m3' }),
    profile('p3', 'b'),
  ];

  it('按 providerId 把 Profile 挂到对应 Provider 下', () => {
    const tree = buildModelTree(providers, profiles);
    expect(tree.providers).toHaveLength(2);
    expect(tree.profilesByProvider.get('a')?.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(tree.profilesByProvider.get('b')?.map((p) => p.id)).toEqual(['p3']);
    expect(tree.orphanProfiles).toHaveLength(0);
  });

  it('挑出 providerId 不存在的孤儿 Profile', () => {
    const tree = buildModelTree(providers, [profile('ghost', 'nope')]);
    expect(tree.orphanProfiles.map((p) => p.id)).toEqual(['ghost']);
    // 反向断言：孤儿不得被静默丢弃，也不得挂到任意 Provider 下
    expect(tree.profilesByProvider.get('a')).toEqual([]);
  });

  it('Provider 自身命中时保留其下全部 Profile', () => {
    const tree = buildModelTree(providers, profiles, '甲');
    expect(tree.providers.map((p) => p.id)).toEqual(['a']);
    expect(tree.profilesByProvider.get('a')).toHaveLength(2);
  });

  it('Provider 未命中但有 Profile 命中时，只保留命中的 Profile', () => {
    const tree = buildModelTree(providers, profiles, 'bge');
    expect(tree.providers.map((p) => p.id)).toEqual(['a']);
    expect(tree.profilesByProvider.get('a')?.map((p) => p.id)).toEqual(['p2']);
  });

  it('空搜索不过滤任何内容', () => {
    const tree = buildModelTree(providers, profiles, '   ');
    expect(tree.providers).toHaveLength(2);
    expect(tree.profilesByProvider.get('a')).toHaveLength(2);
  });

  it('无匹配时返回空列表（含孤儿也参与过滤）', () => {
    const tree = buildModelTree(providers, [...profiles, profile('ghost', 'nope')], 'zzz');
    expect(tree.providers).toHaveLength(0);
    expect(tree.orphanProfiles).toHaveLength(0);
  });

  it('按 baseUrl 也能搜到 Provider', () => {
    const tree = buildModelTree(
      [provider('a', { baseUrl: 'http://127.0.0.1:11434' })],
      [],
      '11434',
    );
    expect(tree.providers.map((p) => p.id)).toEqual(['a']);
  });
});

describe('avatar', () => {
  it('同一标识得到稳定色相', () => {
    expect(avatarHue('local-ollama')).toBe(avatarHue('local-ollama'));
    expect(avatarHue('local-ollama')).toBeGreaterThanOrEqual(0);
    expect(avatarHue('local-ollama')).toBeLessThan(360);
  });

  it('不同标识尽量得到不同色相', () => {
    expect(avatarHue('a')).not.toBe(avatarHue('b'));
  });

  it('首字取大写，空串回落问号', () => {
    expect(avatarInitial('ollama')).toBe('O');
    expect(avatarInitial('   ')).toBe('?');
    expect(avatarInitial('本地模型')).toBe('本');
  });
});
