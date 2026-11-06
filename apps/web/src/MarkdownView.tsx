import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Alert } from './ui';

/**
 * 项目自述（README）渲染 —— PROJ-UI-01。
 *
 * 安全取舍（26 SPEC §16）：
 * - 渲染产物是 **React 元素**，全程不触碰 `dangerouslySetInnerHTML`，因此不存在
 *   HTML 注入面；未启用 `rehype-raw`，README 里的原始 HTML 片段按文本处理。
 * - 链接与图片**显式协议白名单**：`javascript:` / `data:` / 相对路径一律降级为
 *   不可点击的纯文本，不静默渲染成可点元素。
 * - 外部链接统一 `rel="noopener noreferrer"`。
 *
 * 语法覆盖：CommonMark + GFM（表格 / 任务列表 / 删除线 / 自动链接）。
 * 未覆盖的（脚注定义、HTML 表格、数学公式）按纯文本降级，不伪装成渲染成功。
 */

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/**
 * 只放行绝对且协议安全的 URL。
 * 相对路径（`./docs/x.md`）在浏览器里会解析成工作台自身地址，点了必然 404，
 * 因此同 `javascript:` 一样按不安全处理 —— 保留文字，不给可点行为。
 */
export function isSafeUrl(url: string): boolean {
  try {
    return SAFE_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

/** 交给 react-markdown 的兜底变换：不安全 URL 返回空串（不生成 href/src）。 */
export function safeUrlTransform(url: string): string {
  return isSafeUrl(url) ? url : '';
}

const components: Components = {
  a({ href, children, ...rest }) {
    if (!href || !isSafeUrl(href)) {
      return (
        <span className="wb-md__blocked" title={href ? `已阻止非安全链接：${href}` : undefined}>
          {children}
        </span>
      );
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
        {children}
      </a>
    );
  },
  img({ src, alt, ...rest }) {
    if (!src || !isSafeUrl(src)) {
      return <span className="wb-md__blocked">[图片已阻止{alt ? `：${alt}` : ''}]</span>;
    }
    return <img src={src} alt={alt ?? ''} loading="lazy" {...rest} />;
  },
};

export interface MarkdownViewProps {
  content: string;
  /** 正文被服务端 256 KB 上限截断。 */
  truncated?: boolean;
  /** 来源文件名，用于截断提示里指路。 */
  fileName?: string;
}

export function MarkdownView({ content, truncated, fileName }: MarkdownViewProps) {
  return (
    <div className="wb-md">
      {truncated ? (
        <Alert tone="warn">
          内容超过 256 KB，已截断显示
          {fileName ? `（完整内容请查看项目根目录下的 ${fileName}）` : ''}。
        </Alert>
      ) : null}
      <Markdown remarkPlugins={[remarkGfm]} components={components} urlTransform={safeUrlTransform}>
        {content}
      </Markdown>
    </div>
  );
}
