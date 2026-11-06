import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { cx } from './cx';

export interface FieldProps {
  label: ReactNode;
  /** 字段说明（灰字）。 */
  hint?: ReactNode;
  /** 错误提示：出现时替代 hint，并使用危险色。 */
  error?: ReactNode;
  /** 必填标记（仅视觉，不做校验）。 */
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function Field({ label, hint, error, required, children, className }: FieldProps) {
  return (
    <label className={cx('wb-field', className)}>
      <span className="wb-field__label">
        {label}
        {required ? <span style={{ color: 'var(--wb-danger)' }}> *</span> : null}
      </span>
      {children}
      {error ? (
        <span className="wb-field__error">{error}</span>
      ) : hint ? (
        <span className="wb-field__hint">{hint}</span>
      ) : null}
    </label>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx('wb-input', className)} {...rest} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx('wb-textarea', className)} {...rest} />;
}

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx('wb-select', className)} {...rest} />;
}
