import { describe, expect, it } from 'vitest';
import {
  harnessToolIds,
  isHarnessTool,
  type ExecutionBinding,
  type HarnessSession,
  type ToolPolicy,
} from '../harness.js';

describe('Harness 工具白名单（26 SPEC §13）', () => {
  it('包含 §13 全部工具 ID', () => {
    expect(harnessToolIds).toEqual(
      expect.arrayContaining([
        'project.describe',
        'project.commands.list',
        'project.command.run',
        'run.status',
        'run.events',
        'run.cancel',
        'artifact.list',
        'artifact.read',
        'artifact.publish',
        'memory.search',
        'memory.read',
        'memory.candidate',
        'approval.request',
        'approval.status',
      ]),
    );
  });

  it('isHarnessTool 区分合法与非法 ID', () => {
    expect(isHarnessTool('project.describe')).toBe(true);
    expect(isHarnessTool('approval.status')).toBe(true);
    expect(isHarnessTool('shell.exec')).toBe(false);
    expect(isHarnessTool('fs.read')).toBe(false);
    expect(isHarnessTool('credential.read')).toBe(false);
  });
});

describe('ToolPolicy / HarnessSession / ExecutionBinding 契约', () => {
  it('工具策略只允许白名单内的工具', () => {
    const policy: ToolPolicy = {
      allowedToolIds: ['project.describe', 'run.status'],
      constraints: { 'project.command.run': { commandIds: ['build', 'test'] } },
    };
    expect(policy.allowedToolIds.every(isHarnessTool)).toBe(true);
  });

  it('Session 记录工具策略、上下文游标与修订', () => {
    const session: HarnessSession = {
      id: 'sess-1',
      harnessProfileId: 'deepseek-harness-local',
      modelProfileId: 'deepseek-code',
      agentProfileId: 'code-builder@5',
      toolPolicy: { allowedToolIds: ['artifact.publish'], constraints: {} },
      status: 'created',
      contextCursor: 0,
      revision: 1,
      createdAt: '2026-09-28T00:00:00Z',
      updatedAt: '2026-09-28T00:00:00Z',
    };
    expect(session.contextCursor).toBe(0);
    expect(session.toolPolicy.allowedToolIds).toEqual(['artifact.publish']);
  });

  it('ExecutionBinding 固定 Run→Harness/Session/模型/策略/快照的不可变绑定', () => {
    const binding: ExecutionBinding = {
      runId: 'run-1',
      sessionId: 'sess-1',
      harnessProfileId: 'deepseek-harness-local',
      modelProfileId: 'deepseek-code',
      toolPolicy: { allowedToolIds: ['project.describe'], constraints: {} },
      contextSnapshot: {
        hash: 'sha256:abc',
        revision: 3,
        projectId: 'meeting-minutes',
        createdAt: '2026-09-28T00:00:00Z',
      },
      fixedAt: '2026-09-28T00:00:00Z',
    };
    expect(binding.runId).toBe('run-1');
    expect(binding.contextSnapshot.revision).toBe(3);
  });
});
