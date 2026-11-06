/**
 * 窄屏检测（30 号视觉基线 §5 移动降级：390×844 采用可折叠侧栏）。
 *
 * 视口 ≤ maxWidth 时返回 true，侧栏据此从「固定宽度 aside」折叠为
 * 「可展开区块」，保证核心状态与审批在窄屏仍可访问。
 * 监听 matchMedia change，旋转屏幕/调整窗口后实时生效。
 */
import { useEffect, useState } from 'react';

export function useNarrow(maxWidth = 900): boolean {
  const query = `(max-width: ${maxWidth}px)`;
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return narrow;
}
