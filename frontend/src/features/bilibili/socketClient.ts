import type { JobsWebSocketEvent } from "./types";
import { sendWebSocketMessage, subscribeWebSocket } from "@/commons/hooks/webSocketClient";

type Listener<T> = (event: T) => void;

const jobsListeners = new Set<Listener<JobsWebSocketEvent>>();
const searchListeners = new Set<Listener<Record<string, unknown>>>();
let unsubscribeSharedSocket: (() => void) | null = null;

function ensureBilibiliSocketSubscription() {
  if (unsubscribeSharedSocket) return;
  unsubscribeSharedSocket = subscribeWebSocket((event) => {
    if (event.channel !== "bilibili_crawler") return;
    if (typeof event.type === "string" && event.type.startsWith("search_")) {
      searchListeners.forEach((listener) => listener(event));
      return;
    }
    jobsListeners.forEach((listener) => listener(event as JobsWebSocketEvent));
  });
}

function cleanupBilibiliSocketSubscriptionIfIdle() {
  if (jobsListeners.size > 0 || searchListeners.size > 0) return;
  unsubscribeSharedSocket?.();
  unsubscribeSharedSocket = null;
}

export function subscribeBilibiliJobsSocket(listener: Listener<JobsWebSocketEvent>) {
  jobsListeners.add(listener);
  ensureBilibiliSocketSubscription();

  return () => {
    jobsListeners.delete(listener);
    cleanupBilibiliSocketSubscriptionIfIdle();
  };
}

export function startSearchStream(input: unknown, listener: Listener<Record<string, unknown>>) {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const wrappedListener = (event: Record<string, unknown>) => {
    if (event.request_id !== requestId) return;
    listener(event);
  };
  searchListeners.add(wrappedListener);
  ensureBilibiliSocketSubscription();
  sendWebSocketMessage({
    channel: "bilibili_crawler",
    action: "search",
    request_id: requestId,
    payload: input,
  });

  return () => {
    searchListeners.delete(wrappedListener);
    cleanupBilibiliSocketSubscriptionIfIdle();
  };
}
