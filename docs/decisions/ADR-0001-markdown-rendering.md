# ADR-0001：README 渲染采用 react-markdown + remark-gfm

- **状态**：已采纳（2026-10-07）
- **关联任务**：PROJ-UI-01（项目页卡片网格与详情页，规范外扩展）
- **关联规范**：26 SPEC §16（安全基线）、`docs/design/model-settings-ui-research.md`（调研方法）

## 背景

项目详情页的「简介」页签需要渲染对接项目登记根顶层的自述文件（README）。
README 来自**任意登记的项目目录**，属于不可信输入。备选方案：

| 方案                              | 依赖                     | XSS 面                     | 语法覆盖                                         |
| --------------------------------- | ------------------------ | -------------------------- | ------------------------------------------------ |
| A 自绘受限渲染器                  | 0                        | 零（输出 React 元素）      | 标题/列表/代码块等基础语法；表格、任务列表不支持 |
| B `marked` + `dompurify`          | 2                        | 有（HTML 字符串 + 消毒链） | 完整 GFM                                         |
| C `react-markdown` + `remark-gfm` | 2 直接（约 28 个传递包） | 零（输出 React 元素）      | 完整 GFM                                         |

## 决策

采用**方案 C**：`react-markdown@10` + `remark-gfm@4`（均为纯 JS，无原生模块，
不触碰 better-sqlite3 的 Node 22 ABI 绑定这条本机红线）。

理由：README 里表格几乎必然出现，方案 A 会让最常见的自述「看起来没渲染成功」；
方案 C 与 A 共享同一安全模型（全程不产生 HTML 字符串、不碰
`dangerouslySetInnerHTML`），而方案 B 为了安全还得额外引消毒器，等于用两个包
换一个「消毒配置是否正确」的长期风险。代价是依赖树与约 30 KB gzip 的 bundle
增量，可接受。

## 安全边界（本决策的一部分，不得回退）

1. **不引入 `rehype-raw`**：README 中的原始 HTML 片段一律不渲染。
2. **协议白名单**（`MarkdownView.tsx` 的 `isSafeUrl`）：链接与图片只放行
   `http:` / `https:` / `mailto:` 的**绝对** URL；`javascript:` / `data:` /
   相对路径一律降级为不可点击文本。同时传给 `urlTransform` 作兜底。
3. 外部链接统一 `rel="noopener noreferrer"`。
4. 表格在窄屏用块级 + 横向滚动呈现，避免撑破卡片造成整页水平溢出。

## 后果

- 新增运行时依赖：`react-markdown`、`remark-gfm`（lockfile 已锁定）。
- 引入约 28 个 unified 生态传递包（纯 JS、无 postinstall 脚本）。
- 验证入口：`apps/web/src/__tests__/markdown-view.test.ts` 和 `scripts/smoke-project-ui.mjs`。
  （`<script>` 不执行、`javascript:` 链接降级）与三视口 0px 溢出。
