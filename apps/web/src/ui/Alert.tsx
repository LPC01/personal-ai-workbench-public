import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { cx } from './cx';

export type AlertTone = 'info' | 'success' | 'warn' | 'danger';

const TONE_CLASS: Record<AlertTone, string> = {
  info: '',
  success: 'wb-alert--success',
  warn: 'wb-alert--warn',
  danger: 'wb-alert--danger',
};

/** 提示条图标随色调变化，保证语义不依赖单一颜色。 */
function AlertIcon({ tone }: { tone: AlertTone }) {
  if (tone === 'success') return <CircleCheck size={16} aria-hidden="true" />;
  if (tone === 'warn') return <TriangleAlert size={16} aria-hidden="true" />;
  if (tone === 'danger') return <CircleAlert size={16} aria-hidden="true" />;
  return <Info size={16} aria-hidden="true" />;
}

/**
 * 页面内嵌提示条。危险色调默认 `role="alert"`（打断式），其余为 `role="status"`。
 */
export function Alert({
  tone = 'info',
  children,
  className,
  label,
}: {
  tone?: AlertTone;
  children: ReactNode;
  className?: string;
  /** 无障碍标签（同一页面存在多条提示时用于区分）。 */
  label?: string;
}) {
  return (
    <div
      className={cx('wb-alert', TONE_CLASS[tone], className)}
      role={tone === 'danger' ? 'alert' : 'status'}
      aria-label={label}
    >
      <span className="wb-alert__icon">
        <AlertIcon tone={tone} />
      </span>
      <span style={{ minWidth: 0 }}>{children}</span>
    </div>
  );
}
