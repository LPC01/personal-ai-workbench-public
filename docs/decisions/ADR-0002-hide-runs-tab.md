# ADR-0002：在 UI 隐藏「运行」页签（保留全部能力）

- **状态**：已采纳（2026-10-08）
- **关联任务**：UI-08（规范外扩展 + MUST 偏离）
- **关联规范**：30 号视觉验收基线 §3.1（MUST）、26 SPEC §8.2 / §10.2（Run 与 RunEvent）
- **关联决策**：ADR-0001（markdown 渲染选型）

## 背景

侧栏「运行」页签是平台 Run（一次性执行记录）的只读台账：左列列出 `runs` 表全部
记录，选中后回看事件流（`run_events`）与成果（Artifact）。

它呈现出两个问题，导致实际处于「空转」状态：

1. **没有产生入口**——前端 `api.ts` 未封装 `POST /api/v1/projects/{id}/commands/{id}/runs`，
   UI 上没有任何按钮能发起 job Run；只有 Agent 会话（`kind='agent'`）与聊天室编排
   （`kind='builder'`）产生的记录会流进来。
2. **没有刷新机制**——列表只在首次挂载加载一次，无轮询也无刷新按钮，新记录必须
   整页刷新才可见。

用户据此要求在 Web UI 隐藏该页签。

## 决策

**只移除可达性，不移除能力。**

| 层         | 处置                                                                                               |
| ---------- | -------------------------------------------------------------------------------------------------- |
| 侧栏导航   | 从 `NAV_ITEMS` 删除「运行」项                                                                      |
| hash 路由  | 从 `VIEWS` 与 `View` 联合类型删除 `'runs'`；`viewFromHash()` 因此把 `#/runs` 回落到「项目」        |
| 渲染分支   | 删除 `{view === 'runs' ? <RunsView /> : null}` 及其 import（留着就是死代码）                       |
| `RunsView` | **保留文件**，仅不再被引用                                                                         |
| `api.ts`   | **保留** `listRuns` / `listRunArtifacts`；`getRun` / `listRunEvents` 本就被「Agent 执行」页签复用  |
| 后端       | **零改动**——`GET /runs`、`/runs/{id}`、`/events`、`/artifacts`、`POST /cancel`、`/stream` 全部原样 |

## 规范影响：偏离 30 号基线 §3.1 一条 MUST

基线规定：

> 全局导航至少能进入项目、协作聊天室、AI 工坊、**运行中心**和记忆中心；

隐藏后「运行中心」在导航中不可达，**构成对 MUST 的偏离**。本 ADR 即为该偏离的
正式记录，理由如下：

1. 「可达」的形式已退化为空壳——页签无入口、无刷新，点进去只会看到一份不会
   更新的只读列表，保留它并不能让用户真正触达运行数据；
2. Run 记录并未消失，Agent 会话与聊天室编排仍在正常落库，只是缺少统一台账页；
3. 与「补强页签」相比，隐藏的成本更低且可逆，恢复只需加回三处（见下）。

**恢复条件**（满足任一即应恢复该页签）：① 需要跨来源审计 Run 记录；② 前端补上
了发起 job Run 的入口（届时它不再是空壳）；③ 需要重新满足基线 MUST 全量达成。

## 恢复步骤

1. `App.tsx`：`View` 联合类型加回 `| 'runs'`；
2. `App.tsx`：`VIEWS` 数组加回 `'runs'`；
3. `App.tsx`：`NAV_ITEMS` 加回 `{ view: 'runs', label: '运行', icon: <ListChecks size={16} aria-hidden="true" /> }`；
4. `App.tsx`：恢复 `import RunsView from './RunsView';` 与 `{view === 'runs' ? <RunsView /> : null}`。

无需重建任何包（`RunsView.tsx` 与 `api.ts` 封装始终保留在仓库中）。

## 诚实边界

- 隐藏后**无法通过 UI 查询历史 Run**；如需查看，直接调 API（`GET /api/v1/runs`）
  或按上述步骤恢复页签。
- 本次不解决「前端缺发起 job Run 入口」这一缺口（与 CRED-05 同族的「后端已具备、
  前端未接线」），它仍是独立待办。
