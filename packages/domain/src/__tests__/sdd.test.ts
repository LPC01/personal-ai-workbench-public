import { describe, expect, it } from 'vitest';
import {
  SDD_STAGES,
  advanceSddStage,
  assertSddGate,
  nextSddStage,
  type SddGateContext,
} from '../sdd.js';

const BASE_CTX: SddGateContext = { specApproved: true, hasFinalArtifact: true };

describe('SDD 交付协议状态机（§14）', () => {
  it('阶段线性推进', () => {
    expect(nextSddStage('INTAKE')).toBe('SPEC_DRAFT');
    expect(nextSddStage('WAITING_SPEC_APPROVAL')).toBe('IMPLEMENTATION');
    expect(nextSddStage('DECISION')).toBe('ARCHIVE');
    expect(nextSddStage('ARCHIVE')).toBeNull();
  });

  it('9 个固定阶段顺序正确', () => {
    expect(SDD_STAGES).toEqual([
      'INTAKE',
      'SPEC_DRAFT',
      'SPEC_REVIEW',
      'WAITING_SPEC_APPROVAL',
      'IMPLEMENTATION',
      'VERIFICATION',
      'INDEPENDENT_REVIEW',
      'DECISION',
      'ARCHIVE',
    ]);
  });

  it('未批准 Spec 不得进入 IMPLEMENTATION', () => {
    expect(assertSddGate('WAITING_SPEC_APPROVAL', { ...BASE_CTX, specApproved: false })).toMatch(
      /未批准 Spec/,
    );
    expect(assertSddGate('WAITING_SPEC_APPROVAL', BASE_CTX)).toBeNull();
  });

  it('评审 REWORK/REJECTED 阻止推进', () => {
    expect(assertSddGate('INDEPENDENT_REVIEW', { ...BASE_CTX, reviewDecision: 'REWORK' })).toMatch(
      /REWORK/,
    );
    expect(
      assertSddGate('INDEPENDENT_REVIEW', { ...BASE_CTX, reviewDecision: 'REJECTED' }),
    ).toMatch(/REJECTED/);
    expect(
      assertSddGate('INDEPENDENT_REVIEW', { ...BASE_CTX, reviewDecision: 'ACCEPTED' }),
    ).toBeNull();
  });

  it('最终 Decision 必须生成 Artifact', () => {
    expect(assertSddGate('DECISION', { ...BASE_CTX, hasFinalArtifact: false })).toMatch(/Artifact/);
    expect(assertSddGate('DECISION', BASE_CTX)).toBeNull();
  });

  it('ARCHIVE 为终态不可推进', () => {
    expect(assertSddGate('ARCHIVE', BASE_CTX)).toMatch(/终态/);
  });

  it('advanceSddStage 推进 + 门禁', () => {
    expect(advanceSddStage('INTAKE', BASE_CTX)).toEqual({ next: 'SPEC_DRAFT' });
    expect(advanceSddStage('WAITING_SPEC_APPROVAL', { ...BASE_CTX, specApproved: false })).toEqual({
      error: expect.stringContaining('未批准 Spec'),
    });
  });
});
