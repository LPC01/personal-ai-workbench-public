import { useEffect, useMemo, useRef, useState } from 'react';
import { WrapText } from 'lucide-react';
import { Badge } from './Badge';
import { Field } from './Field';
import { Input } from './Field';
import { cx } from './cx';

export interface LogViewProps {
  text: string;
  /** 空态文案。 */
  emptyText?: string;
  /** 容器最大高度（超出滚动）。 */
  maxHeight?: number;
  label?: string;
  className?: string;
}

/**
 * 日志 / 事件流查看器：等宽字体 + 过滤 + 换行开关 + 自动到底部。
 * 过滤只做纯文本子串匹配，不改变原文顺序；命中行为原文子集。
 */
export function LogView({
  text,
  emptyText = '（暂无内容）',
  maxHeight = 320,
  label = '日志',
  className,
}: LogViewProps) {
  const [filter, setFilter] = useState('');
  const [wrap, setWrap] = useState(true);
  const preRef = useRef<HTMLPreElement>(null);

  // 空文本视为 0 行（否则会显示成 1 行空内容）
  const lines = useMemo(() => (text.length === 0 ? [] : text.split('\n')), [text]);
  const shown = useMemo(() => {
    const q = filter.trim();
    if (q.length === 0) return lines;
    return lines.filter((l) => l.includes(q));
  }, [lines, filter]);

  // 内容变化时滚到底部（日志是追加语义，最新在最下面）
  useEffect(() => {
    const el = preRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);

  return (
    <div className={cx('wb-log', className)}>
      <div className="wb-log__bar">
        <div style={{ flex: '1 1 180px', minWidth: 0 }}>
          <Field label="过滤">
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="按子串过滤…"
              aria-label="日志过滤"
            />
          </Field>
        </div>
        <label className="wb-check">
          <input
            type="checkbox"
            checked={wrap}
            onChange={(e) => setWrap(e.target.checked)}
            aria-label="自动换行"
          />
          <span>
            <WrapText size={14} aria-hidden="true" /> 换行
          </span>
        </label>
        <Badge tone="neutral">
          {filter.trim() ? `${shown.length} / ${lines.length} 行` : `${lines.length} 行`}
        </Badge>
      </div>

      <pre
        ref={preRef}
        className="wb-code wb-log__body"
        aria-label={label}
        style={{ maxHeight, whiteSpace: wrap ? 'pre-wrap' : 'pre' }}
      >
        {shown.length === 0 ? emptyText : shown.join('\n')}
      </pre>
    </div>
  );
}
