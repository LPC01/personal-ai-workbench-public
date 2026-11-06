import type { ReactNode } from 'react';
import { cx } from './cx';

/**
 * 徽章色调。语义不依赖单一颜色（30 号基线 MUST）：徽章内始终是「文字 + 颜色」，
 * 色调只是辅助，色觉障碍用户仍能读文字。
 */
export type BadgeTone = 'neutral' | 'info' | 'success' | 'warn' | 'danger';

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: 'wb-badge--neutral',
  info: 'wb-badge--info',
  success: 'wb-badge--success',
  warn: 'wb-badge--warn',
  danger: 'wb-badge--danger',
};

/** 色调 → 类名（纯函数，便于单测）。 */
export function badgeToneClass(tone: BadgeTone): string {
  return cx('wb-badge', TONE_CLASS[tone]);
}

/**
 * 运行 / 服务状态 → 徽章色调（纯函数）。
 * 未收录的状态一律回落 `info`，不臆造「成功/失败」语义。
 */
export function statusBadgeTone(status: string | null | undefined): BadgeTone {
  switch ((status ?? '').trim().toUpperCase()) {
    case 'RUNNING':
    case 'SUCCEEDED':
    case 'HEALTHY':
    case 'OK':
    case 'PASSED':
    case 'COMPLETED':
    case 'RESOLVED':
    case 'VERIFIED':
    case 'CLOSED':
    case 'DONE':
      return 'success';
    case 'UNHEALTHY':
    case 'FAILED':
    case 'ERROR':
    case 'CANCELLED':
    case 'TIMEOUT':
    case 'DOWN':
      return 'danger';
    case 'PENDING':
    case 'QUEUED':
    case 'STARTING':
    case 'STOPPING':
    case 'PAUSED':
    case 'OPEN':
    case 'DEGRADED':
      return 'warn';
    case 'STOPPED':
    case 'IDLE':
    case 'UNKNOWN':
      return 'neutral';
    default:
      return 'info';
  }
}

export interface BadgeProps {
  tone?: BadgeTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  title?: string;
}

export function Badge({ tone = 'neutral', icon, children, className, title }: BadgeProps) {
  return (
    <span className={cx(badgeToneClass(tone), className)} title={title}>
      {icon}
      {children}
    </span>
  );
}

/** 状态徽章：文字即状态原文，色调由 statusBadgeTone 推导。 */
export function StatusBadge({
  status,
  icon,
  className,
}: {
  status: string | null | undefined;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <Badge tone={statusBadgeTone(status)} icon={icon} className={className}>
      {status ?? 'UNKNOWN'}
    </Badge>
  );
}
