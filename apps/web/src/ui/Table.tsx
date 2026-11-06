import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cx } from './cx';

/** 带边框容器的表格：表头 sticky、行 hover、数字列右对齐（见 .wb-table__num）。 */
export function Table({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <div className="wb-table-wrap">
      <table className={cx('wb-table', className)} aria-label={label}>
        {children}
      </table>
    </div>
  );
}

export function Th({
  numeric = false,
  className,
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return <th className={cx(numeric && 'wb-table__num', className)} {...rest} />;
}

export function Td({
  numeric = false,
  className,
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return <td className={cx(numeric && 'wb-table__num', className)} {...rest} />;
}
