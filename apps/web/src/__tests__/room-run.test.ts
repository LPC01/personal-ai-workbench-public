import { describe, expect, it } from 'vitest';
import type { RoomEvent } from '../api';
import {
  budgetProgress,
  buildTimeline,
  dedupeEvents,
  describeStopReason,
  lastAgentSpeaker,
  nextSpeaker,
  parseParticipantsJson,
  stringifyParticipants,
} from '../room-run';

function ev(sequence: number, eventType: string, actorRef = 'system', content?: string): RoomEvent {
  return {
    id: sequence,
    roomRunId: 'rr1',
    sequence,
    eventType,
    actorRef,
    payload: content === undefined ? {} : { content },
    createdAt: `2026-10-08T00:00:0${sequence}.000Z`,
  };
}

describe('聊天室运行视图纯函数（UI-10）', () => {
  it('dedupeEvents 按 sequence 去重并排序（SSE 重推幂等）', () => {
    const merged = dedupeEvents([
      ev(2, 'AGENT_MESSAGE', 'dev', 'b'),
      ev(1, 'USER_MESSAGE', 'user', 'a'),
      ev(2, 'AGENT_MESSAGE', 'dev', 'b'),
    ]);
    expect(merged.map((e) => e.sequence)).toEqual([1, 2]);
  });

  it('buildTimeline 把用户/Agent 消息成块、系统事件成行', () => {
    const blocks = buildTimeline([
      ev(1, 'USER_MESSAGE', 'user', '请开始'),
      ev(2, 'AGENT_MESSAGE', 'pm', '需求要点'),
      ev(3, 'TASK_ASSIGNED', 'system'),
    ]);
    expect(blocks.map((b) => b.kind)).toEqual(['user', 'agent', 'system']);
    expect(blocks[0]?.actorRef).toBe('user');
    expect(blocks[1]?.text).toBe('需求要点');
  });

  it('同一发言人连续发言合并为一块', () => {
    const blocks = buildTimeline([
      ev(1, 'AGENT_MESSAGE', 'pm', '第一句'),
      ev(2, 'AGENT_MESSAGE', 'pm', '第二句'),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.merged).toBe(2);
    expect(blocks[0]?.text).toBe('第二句');
  });

  it('nextSpeaker 按轮询取下一位，未知发言回落到首位', () => {
    expect(nextSpeaker(['pm', 'dev'], null)).toBe('pm');
    expect(nextSpeaker(['pm', 'dev'], 'pm')).toBe('dev');
    expect(nextSpeaker(['pm', 'dev'], 'dev')).toBe('pm');
    expect(nextSpeaker(['pm', 'dev'], 'someone')).toBe('pm');
    expect(nextSpeaker([], null)).toBeNull();
  });

  it('lastAgentSpeaker 只认 AGENT_MESSAGE（用户消息不算）', () => {
    expect(
      lastAgentSpeaker([ev(1, 'USER_MESSAGE', 'user', 'hi'), ev(2, 'AGENT_MESSAGE', 'dev', 'yo')]),
    ).toBe('dev');
    expect(lastAgentSpeaker([ev(1, 'USER_MESSAGE', 'user', 'hi')])).toBeNull();
  });

  it('describeStopReason 翻译已知码，未知码原样返回（不美化）', () => {
    expect(describeStopReason('ROOM_BUDGET_EXCEEDED')).toContain('预算');
    expect(describeStopReason('NO_CONTENT')).toContain('空内容');
    expect(describeStopReason(null)).toBeNull();
    expect(describeStopReason('WEIRD_CODE')).toBe('WEIRD_CODE');
  });

  it('parseParticipantsJson 接受合法数组并补全默认值', () => {
    const r = parseParticipantsJson(
      JSON.stringify([
        {
          participantId: 'pm',
          harnessProfileId: 'h1',
          toolPolicy: { allowedTools: ['artifact.list', 42] },
        },
      ]),
    );
    expect(r.ok).toBe(true);
    expect(r.participants[0]?.participantId).toBe('pm');
    expect(r.participants[0]?.modelBinding.revision).toBe(1);
    expect(r.participants[0]?.toolPolicy.allowedTools).toEqual(['artifact.list']);
  });

  it('parseParticipantsJson 拒绝非数组 / 缺少 id / 非法 JSON（且不影响表单）', () => {
    expect(parseParticipantsJson('{}').ok).toBe(false);
    expect(parseParticipantsJson('[{ }]').ok).toBe(false);
    expect(parseParticipantsJson('{oops').ok).toBe(false);
    expect(parseParticipantsJson('[1]').ok).toBe(false);
    expect(parseParticipantsJson('   ').ok).toBe(false);
  });

  it('stringify → parse 往返保持参与者结构', () => {
    const input = [
      {
        participantId: 'dev',
        harnessProfileId: 'h1',
        modelBinding: { modelProfileId: 'mp1', revision: 2 },
        toolPolicy: { allowedTools: ['project.describe'] },
        systemInstruction: '你是开发',
      },
    ];
    const parsed = parseParticipantsJson(stringifyParticipants(input));
    expect(parsed.ok).toBe(true);
    expect(parsed.participants).toEqual(input);
  });

  it('budgetProgress 未设上限时不编造比例', () => {
    expect(budgetProgress(3, undefined).ratio).toBe(0);
    expect(budgetProgress(3, 0).label).toContain('未设上限');
    expect(budgetProgress(5, 10).ratio).toBeCloseTo(0.5);
    expect(budgetProgress(20, 10).ratio).toBe(1);
  });
});
