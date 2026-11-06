import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';
import { cx } from './cx';

/**
 * 空态：图标 + 一句话说明 + 主行动。
 * 默认图标为 Inbox；调用方可传入任意 lucide 图标组件（`<EmptyState icon={<Search size={28} />} />`）。
 */
export function EmptyState({
  title,
  desc,
  action,
  icon,
  className,
}: {
  title: ReactNode;
  desc?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('wb-empty', className)}>
      <span className="wb-empty__icon">{icon ?? <Inbox size={28} aria-hidden="true" />}</span>
      <span className="wb-empty__title">{title}</span>
      {desc ? <span className="wb-empty__desc">{desc}</span> : null}
      {action}
    </div>
  );
}
