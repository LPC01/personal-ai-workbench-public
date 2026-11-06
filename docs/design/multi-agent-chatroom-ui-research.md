# 多智能体协作聊天室 UI 架构调研（抓码取证）

抓取日期 **2026-10-08**；星数为当日 `api.github.com/repos/{owner}/{repo}` 实读数。
源文件经 `https://cdn.jsdelivr.net/gh/{repo}@{branch}/{path}` 实际下载后阅读（`raw.githubusercontent.com` 与 `github.com` 在本机不可达）。

## 1. 对比表

| 项目                               | 星数   | 会话 UI 形态                                                                        | 状态管理 / 数据流关键机制                                                          | 对我最有价值的 1 点                                   |
| ---------------------------------- | ------ | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------- |
| OpenHands/OpenHands                | 90187  | 左事件流 + 右 Tabs（Conversation / Planner / Task List / Files），底部输入框带 stop | 全局 zustand `use-event-store`：双数组 + `Set<id>` 去重；WS + `after_seq` 游标续传 | events/uiEvents 分离 + seq 游标，直接可抄             |
| langgenius/dify                    | 158030 | Chat 区 + 右侧 workflow 画布/节点执行面板                                           | SSE 手工流解析，事件名 → 20 个 handler（`use-workflow-run-event.ts`）              | 事件名即路由，含 `workflow_paused` / human-input 系列 |
| microsoft/autogen (AutoGen Studio) | 61281  | Team Builder（表单/JSON）+ Playground（chat + AgentFlow 图）                        | Playground 单 run 一条 WebSocket（message_chunk/message/input_request/error/stop） | AgentFlow：dagre 图 + 边上聚合消息序列                |
| OpenBMB/ChatDev                    | 34458  | Vue workflow 画布 + 消息折叠卡片                                                    | 由后端 schema（`schema.fields`）驱动的表单生成器                                   | 超长消息按高度自动折叠 + 原文复制                     |
| langflow-ai/langflow               | 155567 | ReactFlow 画布 + Playground                                                         | SSE `\n\n` 分帧，不完整帧累积到 `current`；`onDataBatch` 返回 false → abort        | `Connection: close` 让服务端感知前端断连并停任务      |

## 2. 六条可借鉴的架构共识

**① 事件数据流：新建事件端采用双 buffer + 单调 seq**
`OpenHands src/stores/use-event-store.ts`：持久 `events`（真源）与渲染 `uiEvents` 分开，`eventIds: Set` 做 O(1) 去重；只有新事件时间戳早于末位（`needsSorting`）才全量重排，避免每次插入都 sort。`src/utils/handle-event-for-ui.ts:18` 给每条事件补 `seq`（服务端日志序号）作为流式气泡插入锚点，`isFromPlanningAgent` 标记来自哪个 socket。
**我该抄**：协作 run 的事件表也做「raw log（按 id 去重、按 seq 排序）+ 派生视图（ gadget/参与者会话/任务板都用 useMemo 从 raw log 推出）」，杜绝三份各自 CURD 的接口。

**② 断点续传：连接参数带游标，重连不重建竹干净**
`OpenHands src/contexts/conversation-websocket-context.tsx:1101-1170`：主 socket 与 planning-agent socket 各一个 `SeqCursor`，连接时 `queryParams()` 返回 `{after_seq: cursor.value ?? -1}`（首次 -1 全量），`reconnect:{enabled:true}`；注释明确写了 REST 预加载历史的重叠部分由 store 按 id 去重；onOpen/onClose 都 `clearStreamingSlots()`，因为流式进度帧不会重放。

**③ 多 Agent 轮次呈现：列表之外再叠一张「发言拓扑图」**
`autogen python/packages/autogen-studio/frontend/src/components/views/playground/chat/agentflow/agentflow.tsx`：dagre 布局 + ReactFlow，节点 = agent/task/end，边是聚合出的 `MessageSequence{source,target,count,totalTokens,messages[]}`，双向 pair 会用 weight 区分正反向，点边弹 `EdgeMessageModal` 看具体消息；同目录 `rendermessage.tsx` 每条消息带 `source`（agent 名 / `user` / `llm_call_event`），用左右对齐+气泡底色区分。
**我该抄**：右侧「参与者会话」做成图+列表双视图，图中连边承载「谁对谁说了几句、多少 token」，而不是只有时间线。

**④ 任务板：不做独立 CRUD，从事件里派生「最后一个计划」**
`OpenHands src/hooks/use-task-list.ts`：倒序遍历事件，取最后一个 `TaskTrackerObservation` 且 `command === "plan"` 的观察事件作为唯一真源；`routes/task-list-tab.tsx` + `chat/task-tracking/task-item.tsx` 渲染，todo/in_progress/done 三色图标，`in_progress` 整行 `bg-surface-raised` 高亮，空态用 `ConversationTabEmptyState`。
**我该抄**：任务板 = `useMemo(events)`，写回到 LLM 靠 tool call，不给 UI 单独的 update 接口。

**⑤ HITL：把审批做成聊天流里的一张带倒计时的卡片**
三方证据一致：AutoGen `chat/inputrequest.tsx` 内联输入框 + `human_input_timeout_minutes`（默认 3）倒计时 + 超时后 disabled 并提示重启；OpenHands `chat/plan-preview.tsx` 是 `View / Build(⌘↩)` 卡片（⌘↩ 快捷键直接批准）；dify `hooks/use-workflow-run-event/use-workflow-run-event.ts` 里显式列到 `workflow_paused`、`node_human_input_required`、`human_input_form_filled`、`human_input_form_timeout`。

**⑥ run 生命周期 / 配置模型**
生命周期：`playground/chat/chat.tsx` 的 `handleCancel()` 在同一条 WS 上发 `JSON.stringify({type:"stop",reason:"Cancelled by user"})` 再把 run.status 置 `stopped`；server `error` 帧同样走这条 socket 后 close。前端状态机是枚举而非 boolean：`src/types/agent-state.tsx`（含 AWAITING_USER_CONFIRMATION / USER_REJECTED / RATE_LIMITED）与 `conversation-status.ts`（STARTING/RUNNING/PAUSED/STOPPED/FINISHED/ERROR）。langflow `src/frontend/src/controllers/API/api.tsx:340-420` 给的是另一种取消：回调返回 false → `buildController.abort()`，且请求头 `Connection: close` 让服务端在客户端断连时自己停任务。
**我该抄**：一条连接承担「事件下发 + 控制帧上行」，`stop/continue/handoff` 都是上行帧；UI 状态严格对齐后端枚举。
配置模型：AutoGen `teambuilder/builder/component-editor/component-editor.tsx:458-499` 是表单 ⇄ Monaco JSON 双模切换（`isJsonEditing` + `debouncedJsonUpdate` + `JSON.parse` 校验），本地 `workingCopy` + Cancel/Save，dirty 通过 `onDirtyStateChange` 抛给 `manager.tsx` 做切换拦截 Modal；字段组件按类型拆分（agent/model/team/termination/tool-fields）。ChatDev `FormGenerator.vue` 是 `schema.fields` 驱动的通用生成器。
**我该抄**：先表单后 JSON 的双模，且 JSON 编辑器必须是带校验、可出错回退的第二入口，而非唯一入口。

## 3. 诚实边界

- **未核实 / 属我的推断**：ChatDev `frontend/src/pages/WorkflowView.vue`（70KB）里 grep 不到 SSE/fetch/WS 任何命中，其实时机制我没查清，因此上表不给它"实时流"评价；"Manus 式带序号 plan-todo"是推断——OpenHands 的 task id 确实用 `String(i+1)`（`use-task-list.ts`），但 `task-item.tsx` **没有**把序号渲染出来；AutoGen Studio 起 run 后是否有 polling 兜底我没追。
- **不值得抄**：AutoGen Studio 的 `frontend/src/hooks/store.tsx` 把 header/sidebar/面包屑全塞进一个 zustand 并 `persist` 到 localStorage，而 session/messages 反而是另一个 store 且退出就没了，这套划分很差；dify `web/service/base.ts` 的手工 SSE（`getReader` + `split('\n')` + 重试递归 + `unicodeToChar`）是历史包袱，新代码直接用成熟 SSE 客户端；ChatDev `FormGenerator.vue` 单文件 75KB，不要抄它的组织方式。
