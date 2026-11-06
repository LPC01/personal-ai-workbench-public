import type { ReactNode } from 'react';
import { cx } from './cx';

/** 页面标题区：统一「大标题 + 说明 + 右侧操作」的节奏。 */
export function PageHead({
  title,
  desc,
  actions,
  className,
}: {
  title: ReactNode;
  desc?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cx('wb-page-head', className)}>
      <div style={{ minWidth: 0 }}>
        <h1>{title}</h1>
        {desc ? <p>{desc}</p> : null}
      </div>
      {actions ? <div className="wb-row">{actions}</div> : null}
    </header>
  );
}

/** 页面内容容器：统一内边距与主区最小宽度（防溢出，30 号基线 MUST）。 */
export function PageBody({
  children,
  className,
  narrow = false,
}: {
  children: ReactNode;
  className?: string;
  /** 窄屏（移动端）使用更小内边距。 */
  narrow?: boolean;
}) {
  return (
    <div
      className={className}
      style={{
        flex: 1,
        minWidth: 0,
        padding: narrow ? 'var(--wb-space-4)' : 'var(--wb-space-5)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--wb-space-4)',
      }}
    >
      {children}
    </div>
  );
}
