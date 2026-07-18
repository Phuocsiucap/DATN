type WebSocketEventListener = (event: Record<string, unknown>) => void;

let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let manuallyClosed = false;
const listeners = new Set<WebSocketEventListener>();
const pendingMessages: string[] = [];

function dashboardWebSocketUrl() {
  const backendOrigin = import.meta.env.VITE_BACKEND_ORIGIN || "http://localhost:8000";
  return `${backendOrigin.replace(/^http/, "ws").replace(/\/$/, "")}/ws`;
}

function connectWebSocket() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return socket;
  }

  manuallyClosed = false;
  socket = new WebSocket(dashboardWebSocketUrl());

  socket.onmessage = (message) => {
    try {
      const event = JSON.parse(message.data) as Record<string, unknown>;
      listeners.forEach((listener) => listener(event));
    } catch {
      // HTTP queries remain the fallback source when a frame is malformed.
    }
  };

  socket.onopen = () => {
    while (pendingMessages.length) {
      socket?.send(pendingMessages.shift()!);
    }
  };

  socket.onerror = () => {
    socket?.close();
  };

  socket.onclose = () => {
    socket = null;
    if (manuallyClosed || listeners.size === 0) return;
    reconnectTimer = window.setTimeout(connectWebSocket, 3000);
  };

  return socket;
}

function closeWebSocketIfIdle() {
  if (listeners.size > 0) return;
  manuallyClosed = true;
  if (reconnectTimer) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  socket?.close();
  socket = null;
}

export function subscribeWebSocket(listener: WebSocketEventListener) {
  listeners.add(listener);
  if (reconnectTimer) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  connectWebSocket();

  return () => {
    listeners.delete(listener);
    closeWebSocketIfIdle();
  };
}

export function sendWebSocketMessage(message: unknown) {
  const encoded = typeof message === "string" ? message : JSON.stringify(message);
  const activeSocket = connectWebSocket();
  if (activeSocket.readyState === WebSocket.OPEN) {
    activeSocket.send(encoded);
    return;
  }
  pendingMessages.push(encoded);
}
