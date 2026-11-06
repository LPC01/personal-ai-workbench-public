import { describe, expect, it } from 'vitest';
import type { ModelProfile } from '@workbench/contracts';
import { assertCapabilities, resolveModelProfileId } from '../resolution.js';

function profile(capabilities: string[]): ModelProfile {
  return {
    id: 'p1',
    name: 'P1',
    providerId: 'local-ollama',
    modelId: 'qwen-local',
    capabilities,
    contextLimit: 32768,
    defaultParams: {},
    dataBoundary: 'local-only',
    fallbackProfileId: null,
    revision: 1,
    createdAt: '',
    updatedAt: '',
  };
}

describe('resolveModelProfileId', () => {
  it('follows Run > Extension > Project > Global precedence', () => {
    const ctx = {
      runOverrideProfileId: 'run-p',
      extensionDefaultProfileId: 'ext-p',
      projectDefaultProfileId: 'proj-p',
      globalDefaultProfileId: 'global-p',
    };
    expect(resolveModelProfileId(ctx)).toBe('run-p');
    expect(resolveModelProfileId({ ...ctx, runOverrideProfileId: undefined })).toBe('ext-p');
    expect(
      resolveModelProfileId({
        ...ctx,
        runOverrideProfileId: undefined,
        extensionDefaultProfileId: undefined,
      }),
    ).toBe('proj-p');
    expect(
      resolveModelProfileId({
        runOverrideProfileId: undefined,
        extensionDefaultProfileId: undefined,
        projectDefaultProfileId: undefined,
        globalDefaultProfileId: 'global-p',
      }),
    ).toBe('global-p');
  });

  it('returns undefined when nothing is set', () => {
    expect(resolveModelProfileId({})).toBeUndefined();
  });
});

describe('assertCapabilities', () => {
  it('passes when all required capabilities are present', () => {
    expect(() =>
      assertCapabilities(profile(['chat', 'structured-output']), ['chat']),
    ).not.toThrow();
  });

  it('throws MODEL_CAPABILITY_MISMATCH when a capability is missing', () => {
    expect(() => assertCapabilities(profile(['chat']), ['tool-use'])).toThrowError(
      expect.objectContaining({ code: 'MODEL_CAPABILITY_MISMATCH' }),
    );
  });
});
