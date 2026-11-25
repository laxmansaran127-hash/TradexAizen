import { useEffect, useRef, useCallback } from 'react';

type ConnectionState = 'live' | 'connecting' | 'reconnecting' | 'disconnected';

interface UseWebSocketOptions {
  url: string | null;
  onMessage: (data: unknown) => void;
  onOpen?: () => void;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export function useWebSocket({
  url,
  onMessage,
  onOpen,
  reconnectInterval = 3000,
  maxReconnectAttempts = 10,
}: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReconnectRef = useRef(true);
  const onMessageRef = useRef(onMessage);
  const onOpenRef = useRef(onOpen);

  // Keep refs current
  useEffect(() => {
    onMessageRef.current = onMessage;
    onOpenRef.current = onOpen;
  });

  const connect = useCallback(() => {
    if (!url) return;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptsRef.current = 0;
        onOpenRef.current?.();
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          onMessageRef.current(data);
        } catch {
          // Non-JSON message
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (shouldReconnectRef.current && reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++;
          reconnectTimerRef.current = setTimeout(connect, reconnectInterval);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      // Connection failed
    }
  }, [url, reconnectInterval, maxReconnectAttempts]);

  useEffect(() => {
    shouldReconnectRef.current = true;
    connect();

    return () => {
      shouldReconnectRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  const send = useCallback((data: unknown) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  return { send, ws: wsRef };
}

export function getConnectionState(attempts: number, maxAttempts: number, isOpen: boolean): ConnectionState {
  if (isOpen) return 'live';
  if (attempts === 0) return 'connecting';
  if (attempts >= maxAttempts) return 'disconnected';
  return 'reconnecting';
}
