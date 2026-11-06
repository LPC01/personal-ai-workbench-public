# GitHub 热门项目「模型配置页」样式调研

> **日期** 2026-10-07 · **目的** 为「模型」页（Provider / Profile 两区块）的重构取经
> **方法** 直接读**源码实现**而非看截图或文档。样本筛选口径：GitHub ≥ 6 万星、近 7 天有提交、且确实存在独立的模型/供应商配置页。
> **样本** Dify（15.8 万★）· Open WebUI（15.4 万★）· AnythingLLM（6.7 万★）

---

## 1. 样本速览

| 项目            | 星数    | 技术栈             | 配置页路径                                                       | 结构取向                            |
| --------------- | ------- | ------------------ | ---------------------------------------------------------------- | ----------------------------------- |
| **Dify**        | 157,998 | React + TypeScript | `web/app/components/header/account-setting/model-provider-page/` | **两级**：供应商卡片 → 展开模型列表 |
| **Open WebUI**  | 154,125 | Svelte + Python    | `src/lib/components/admin/Settings/Connections.svelte`           | **分区 + 行**：Section / Row 组合   |
| **AnythingLLM** | 66,785  | React + Node       | `frontend/src/pages/GeneralSettings/LLMPreference/`              | **厂商墙**：每家一张 Logo 卡片      |

三者技术栈完全不同，但在以下几件事上**高度一致**——这种跨栈共识比单项目的花哨细节更值得抄。

---

## 2. Dify：两级展开，凭据独立成Panel

`provider-added-card/` 是其规格最高的部分，值得逐个文件对照：

```text
model-provider-page/
├── provider-added-card/
│   ├── index.tsx        ← 卡片本体，layout: 'list' | 'grid'
│   ├── credential-panel ← 凭据独立组件，不混进主表单
│   ├── model-list.tsx   ← 展开后的模型列表
│   ├── model-list-item
│   ├── provider-card-actions
│   └── lazy-custom-model-actions   ← 重操作懒加载
├── model-badge/  model-icon/  provider-icon/
├── model-modal/  model-parameter-modal/
└── system-model-selector/
```

可直接借鉴的六点：

1. **`layout?: 'list' | 'grid'`** —— 同一份数据支持列表/网格两种布局，`ProviderAddedCard` 用同一个组件承接，不写两套。用户按偏好自选。
2. **`notConfigured` 布尔 prop** —— 未配置与已配置共用组件，但视觉分支区分。比我们「空态 + 已填」两套渲染更省。
3. **凭据是独立的 `credential-panel`**，不是在 Provider 主表单里塞一个 key 输入框。这与本仓库的语义完全对应：我们有独立的 `credentialRef` 字段与 `WindowsCredentialStore`。
4. **重组件懒加载**：`model-load-balancing-modal` 走动态 `import()`，等待期用一个 `role="status" aria-busy="true"` 的 Dialog 承载等待态——不是白屏，也不是全页 loading。
5. **文字令牌三级分层**：`title-2xl-semi-bold text-text-primary` / `system-sm-regular text-text-secondary` / `text-text-tertiary`。标题、正文、弱化信息的层级是**显式命名**的。
6. **动效可降级**：`motion-reduce:animate-none` —— 与我们在 UI-07 里做的 `prefers-reduced-motion` 完全同思路，说明这是行业默认礼貌。

一个易忽略的细节——复合主键：

```ts
const getModelKey = (model) => `${model.model}-${model.model_type}-${model.fetch_from}`;
```

同名模型在不同类型、不同来源下允许共存。我们当前用 `profile.id` 单主键，语义不同但**并列存在**的情况同样存在（比如同一个 `bge-m3` 既做 chat 也做 embedding），值得留意。

---

## 3. Open WebUI：分区/行组合，以及脏活的诚实处理

结构上是清晰的两级原子组件：`AdminSettingSection`（带标题的一块）+ `AdminSettingRow`（一行一项）。这比我们「一个 Card 里裸排一堆 Field」更规整，也更容易做统一的对齐与留白。

真正值得抄的是**它对脏活的处理**，这些在截图里看不见：

```ts
// ① URL 自动去尾斜杠——避免 baseUrl + '/v1' 拼成 '//v1'
OPENAI_API_BASE_URLS = OPENAI_API_BASE_URLS.map((url) => url.replace(/\/$/, ''));

// ② 两个平行数组保存时自动对齐长度
if (OPENAI_API_KEYS.length !== OPENAI_API_BASE_URLS.length) {
  if (OPENAI_API_KEYS.length > OPENAI_API_BASE_URLS.length)
    OPENAI_API_KEYS = OPENAI_API_KEYS.slice(0, OPENAI_API_BASE_URLS.length);
  if (OPENAI_API_KEYS.length < OPENAI_API_BASE_URLS.length)
    OPENAI_API_KEYS = [...OPENAI_API_KEYS, '']; // 补空 key
}
```

用平行数组管理「多组 (key, url)」是土办法，但它**明确处理了两个数组长度不一致的情况**，而不是假设用户永远填满。我们当前的 single key / single baseUrl 输入不会有这个问题，但这提示了一件事：**配置页的鲁棒性主要花在用户输入清洗上**，不在视觉上。

另有 `Switch` / `Spinner` / `Tooltip` 三个高频原子组件，以及自绘图标（`ArrowPath.svelte`、`Plus.svelte`）——不引第三方图标库也能做，只是维护成本自担（我们在 UI-07 选了 `lucide-react`，更省）。

---

## 4. AnythingLLM：厂商 Logo 是标配，按能力分战场

第一个冲击是顶部的 import——**35 个厂商 Logo 逐个引入**：

```jsx
import OpenAiLogo from '@/media/llmprovider/openai.png';
import OllamaLogo from '@/media/llmprovider/ollama.png';
import GeminiLogo from '@/media/llmprovider/gemini.png';
// …35 个
```

它的媒体目录 `frontend/src/media/llmprovider/` 就是一整套厂商视觉资产。这说明一件事：**在供应商列表这个场景里，Logo 不是装饰，是主要的定位线索**——用户找的是「我配的那家」，不是「某个叫 xxx 的条目」。

第二个借鉴点是它的**分类方式**。设置区按「能力类型」而非「技术形态」分页：

```text
LLMPreference / EmbeddingPreference / TranscriptionPreference
ImageGenerationPreference / EmbeddingTextSplitterPreference / ModelRouters
```

对照本仓库，这一条尤其值得琢磨：`ModelProfile.capabilities` 字段现在虽然运行时无消费者（见第 6 节），但**按能力类型组织模型**是被大项目验证过的、用户心智更顺的分法。我们目前按「Provider / Profile」这种技术分层划分，对用户不如「聊天用 / 嵌入用」直观。

其余：`SettingsSidebar` 统一设置区导航、`isMobile`（`react-device-detect`）做 UA 判定、`PreLoader` 统一加载态——都是常规但齐全的配置。

---

## 5. 跨项目共识（六条）

三个技术栈毫无交集的项目，在这些点上一致：

| #   | 共识                           | 具体表现                                                       |
| --- | ------------------------------ | -------------------------------------------------------------- |
| 1   | **两级结构，不是两个平级列表** | Provider 是一级单元（卡片），Model 是它的展开子项              |
| 2   | **凭据独立于主表单**           | Dify `credential-panel`；Open WebUI 独立 Key 区                |
| 3   | **厂商 Logo 优先于文字**       | AnythingLLM 35 张；Dify 也拆了 `provider-icon` / `model-icon`  |
| 4   | **「测试连接」是主操作**       | 都放在 Provider 卡片上，不是塞进表格某一列                     |
| 5   | **加载/空/错误态都做成产品**   | `PreLoader` / skeleton / `role="status" aria-busy` 等待 Dialog |
| 6   | **动效可降级**                 | `motion-reduce:animate-none` ≈ 我们的 `prefers-reduced-motion` |

---

## 6. 与本仓库现状的差异映射

对照本仓库当前实现：

| 维度         | 本仓库现状                         | 主流做法                                    | 差距性质   |
| ------------ | ---------------------------------- | ------------------------------------------- | ---------- |
| 页面结构     | Provider 表格 + Profile 表格，平级 | Provider 卡片为一级单元，Model 是其展开子项 | **结构性** |
| 视觉识别     | 纯文字 + Badge                     | 厂商 Logo + 名称 + Badge                    | 体验       |
| 凭据         | UI **无入口**（只能走 API）        | 独立面板 / 独立输入区                       | **功能性** |
| 测试连接位置 | 表格行的次要按钮                   | Provider 卡片的主操作                       | 体验       |
| Profile 编辑 | 无编辑路径（只能重新添加）         | 列表项可点开编辑弹窗                        | 可用性     |
| providerId   | 手填文本框，无校验                 | 从已登记 Provider 选择                      | 数据正确性 |
| 布局切换     | 无                                 | list / grid 双布局（Dify）                  | 锦上添花   |

其中 **功能性** 与 **数据正确性** 两条独立于视觉风格，应当优先；纯排版的改动可以择机。

补充一条本次调研顺带确认的事实：`ModelProfile` 的 `capabilities` / `contextLimit` / `defaultParams` / `fallbackProfileId` 四个字段，当前只有 `model-gateway-store.ts` 的存取往返、运行时无消费者——`assertCapabilities` 虽已从 `model-gateway/src/index.ts` 导出，但全仓无生产调用点。因此**把它们露出到表单当下不产生实际收益**，反而会让表单变长。建议等能力断言真正接线后再同步露出。

---

## 7. 调研边界说明

- GitHub MCP 连接器本次凭据失效（`Bad credentials`），`raw.githubusercontent.com` 亦被 DNS 拦截（HTTP 000）。所有源码经 **GitHub REST `contents` API**（匿名，60 次/小时额度）读取并 base64 解码取得，路径与内容均为真实取样。
- 取样截至 2026-10-07，三个样本当日或前一日均有提交。
- 原计划的 lobe-chat 样本因仓库已重命名迁移（现为 `lobehub/lobehub`，83k★）且目录结构变动，探索成本超出本次额度，未纳入。它偏「移动端友好 + 密集表单」取向，如需补齐可作为第四种风格。
