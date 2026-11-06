import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { cx } from './cx';

export type ToastTone = 'info' | 'success' | 'warn' | 'danger';

export interface ToastItem {
  id: string;
  tone: ToastTone;
  message: string;
}

export interface ToastApi {
  push: (message: string, tone?: ToastTone) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  warn: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const AUTO_DISMISS_MS = 3500;
/** 同屏最多保留的 toast 条数（超出丢弃最旧的）。 */
const MAX_VISIBLE = 3;

function ToastIcon({ tone }: { tone: ToastTone }) {
  if (tone === 'success') return <CircleCheck size={16} aria-hidden="true" />;
  if (tone === 'warn') return <TriangleAlert size={16} aria-hidden="true" />;
  if (tone === 'danger') return <CircleAlert size={16} aria-hidden="true" />;
  return <Info size={16} aria-hidden="true" />;
}

/** 读取 toast API；在 Provider 之外调用会显式报错（不静默降级）。 */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast 必须在 ToastProvider 内使用');
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setItems((prev) => [...prev, { id, tone, message }].slice(-MAX_VISIBLE));
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), AUTO_DISMISS_MS),
      );
    },
    [dismiss],
  );

  // 卸载时清理全部定时器，避免在已卸载组件上 setState
  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      push,
      success: (m) => push(m, 'success'),
      error: (m) => push(m, 'danger'),
      warn: (m) => push(m, 'warn'),
      info: (m) => push(m, 'info'),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="wb-toast-wrap" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={cx('wb-toast', `wb-toast--${t.tone}`)}>
            <span className="wb-alert__icon">
              <ToastIcon tone={t.tone} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>{t.message}</span>
            <button
              type="button"
              className="wb-btn wb-btn--ghost wb-btn--sm"
              onClick={() => dismiss(t.id)}
              aria-label="关闭提示"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
