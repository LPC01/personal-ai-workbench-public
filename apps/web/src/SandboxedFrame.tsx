import { useEffect, useState } from 'react';

const MESSAGE_TYPES = ['ready', 'render', 'action'];

interface IncomingMessage {
  source?: unknown;
  type?: unknown;
  payload?: unknown;
}

export interface SandboxedFrameProps {
  src?: string;
  srcDoc?: string;
  allowedSources: string[];
  height?: number;
}

/**
 * 沙箱 iframe 宿主（26 SPEC §16 SEC-009）：sandbox 隔离 + postMessage 消息校验（防伪造）。
 * 仅处理白名单 source + 白名单类型 + 对象 payload 的消息。
 */
export default function SandboxedFrame({
  src,
  srcDoc,
  allowedSources,
  height = 300,
}: SandboxedFrameProps) {
  const [lastMessage, setLastMessage] = useState<string>('');

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const m = event.data as IncomingMessage;
      if (!m || typeof m !== 'object') {
        return;
      }
      if (typeof m.source !== 'string' || !allowedSources.includes(m.source)) {
        return;
      }
      if (!MESSAGE_TYPES.includes(String(m.type))) {
        return;
      }
      if (m.payload !== undefined && (typeof m.payload !== 'object' || m.payload === null)) {
        return;
      }
      setLastMessage(`${String(m.type)} ← ${m.source}`);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [allowedSources]);

  return (
    <div>
      <iframe
        src={src}
        srcDoc={srcDoc}
        sandbox="allow-scripts allow-forms"
        title="扩展沙箱"
        className="wb-frame"
        style={{ height }}
      />
      <p className="wb-muted" style={{ fontSize: 12, margin: 'var(--wb-space-2) 0 0' }}>
        {lastMessage ? `收到合法消息：${lastMessage}` : '沙箱 iframe（postMessage 白名单校验）'}
      </p>
    </div>
  );
}
