import type { ComponentPropsWithRef, ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { cx } from './cx';

export type ButtonVariant = 'secondary' | 'primary' | 'ghost' | 'danger' | 'danger-ghost';
export type ButtonSize = 'sm' | 'md';

/** 使用 ComponentPropsWithRef：调用方可直接传 ref（如自动聚焦的关闭按钮）。 */
export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 进行中：显示旋转指示器并禁用点击（同时置 aria-busy）。 */
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  block = false,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'wb-btn',
        `wb-btn--${variant}`,
        size === 'sm' && 'wb-btn--sm',
        block && 'wb-btn--block',
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <LoaderCircle className="wb-btn__spin" size={14} aria-hidden="true" />
      ) : (
        (icon ?? null)
      )}
      {children}
    </button>
  );
}
