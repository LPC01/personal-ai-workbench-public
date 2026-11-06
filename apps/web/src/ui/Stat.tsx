import type { ReactNode } from 'react';
import { cx } from './cx';

/** 指标卡：标签 + 数值（数值使用等宽数字，避免跳动）。 */
export function Stat({
  label,
  value,
  hint,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('wb-stat', className)}>
      <div className="wb-stat__label">{label}</div>
      <div className="wb-stat__value">{value}</div>
      {hint ? <div className="wb-stat__hint">{hint}</div> : null}
    </div>
  );
}

/** 指标卡网格：窄屏自动折行，无需为断点写媒体查询。 */
export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('wb-stat-grid', className)}>{children}</div>;
}
