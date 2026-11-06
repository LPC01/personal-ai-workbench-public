import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** 去掉阴影（用于嵌套在另一张卡片内的分区）。 */
  flat?: boolean;
  /** 使用弱化底色（用于页面中次要区块）。 */
  soft?: boolean;
}

export function Card({ flat = false, soft = false, className, children, ...rest }: CardProps) {
  return (
    <div
      className={cx('wb-card', flat && 'wb-card--flat', soft && 'wb-card--soft', className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface CardHeadProps {
  title: ReactNode;
  desc?: ReactNode;
  /** 右侧操作区（按钮组等）。 */
  actions?: ReactNode;
  className?: string;
}

export function CardHead({ title, desc, actions, className }: CardHeadProps) {
  return (
    <div className={cx('wb-card__head', className)}>
      <div style={{ minWidth: 0 }}>
        <h3 className="wb-card__title">{title}</h3>
        {desc ? <p className="wb-card__desc">{desc}</p> : null}
      </div>
      {actions ? <div className="wb-row">{actions}</div> : null}
    </div>
  );
}
