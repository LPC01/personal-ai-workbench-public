import type { CSSProperties } from 'react';
import { cx } from './cx';

/** 骨架块：加载中占位（prefers-reduced-motion 下自动停止动画）。 */
export function Skeleton({
  width,
  height = 12,
  className,
  style,
}: {
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={cx('wb-skeleton', className)}
      aria-hidden="true"
      style={{ display: 'block', width: width ?? '100%', height, ...style }}
    />
  );
}

/** 多行文本骨架：末行宽度渐短，模拟段落。 */
export function SkeletonLines({ lines = 3 }: { lines?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--wb-space-2)' }}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '60%' : '100%'} />
      ))}
    </div>
  );
}
