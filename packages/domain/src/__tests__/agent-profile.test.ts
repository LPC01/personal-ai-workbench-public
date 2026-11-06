import { describe, expect, it } from 'vitest';
import { intersectToolPolicies, resolveModelBinding } from '../agent-profile.js';

describe('intersectToolPolicies（ROOM-SEC-001 权限交集）', () => {
  it('空策略返回空白名单', () => {
    expect(intersectToolPolicies([])).toEqual({
      allowedTools: [],
      deniedTools: [],
      allowPermissionExpansion: false,
    });
  });

  it('多策略白名单取交集，拒绝列表取并集', () => {
    const result = intersectToolPolicies([
      { allowedTools: ['a', 'b', 'c'], deniedTools: ['x'] },
      { allowedTools: ['b', 'c', 'd'] },
      { allowedTools: ['b', 'c'], deniedTools: ['c'] },
    ]);
    expect(result.allowedTools).toEqual(['b']); // a∩b∩c 交集 = b,c；再排除 denied c = b
    expect(result.deniedTools).toEqual(['x', 'c']);
  });

  it('权限扩展需所有策略都允许', () => {
    expect(
      intersectToolPolicies([
        { allowedTools: ['a'], allowPermissionExpansion: true },
        { allowedTools: ['a'], allowPermissionExpansion: true },
      ]).allowPermissionExpansion,
    ).toBe(true);
    expect(
      intersectToolPolicies([
        { allowedTools: ['a'], allowPermissionExpansion: true },
        { allowedTools: ['a'] },
      ]).allowPermissionExpansion,
    ).toBe(undefined);
  });
});

describe('resolveModelBinding（Run override > AgentProfile > Room > Project > Global）', () => {
  it('返回第一个非空绑定', () => {
    const run = { modelProfileId: 'run-model', revision: 1 };
    const agent = { modelProfileId: 'agent-model', revision: 2 };
    expect(resolveModelBinding([run, agent])).toEqual(run);
  });

  it('跳过空绑定，落到下一层', () => {
    const agent = { modelProfileId: 'agent-model', revision: 2 };
    expect(resolveModelBinding([undefined, { modelProfileId: '', revision: 0 }, agent])).toEqual(
      agent,
    );
  });

  it('全空返回 undefined', () => {
    expect(resolveModelBinding([undefined, null])).toBeUndefined();
  });
});
