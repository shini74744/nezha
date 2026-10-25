import type React from "react";
import { useLoginUser } from "@/hooks/use-login-user";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NezhaWebsocketResponse } from "@/types/nezha-api";
import {
	WebSocketContext,
	type WebSocketContextType,
} from "./websocket-context";

interface WebSocketProviderProps {
	url: string;
	children: React.ReactNode;
	authenticated?: boolean;
 viewerId?: number;
}

type RawNezhaWebsocketResponse = Omit<
	Partial<NezhaWebsocketResponse>,
	"servers"
> & {
	servers?: unknown;
};

function normalizeWebSocketResponse(data: unknown): NezhaWebsocketResponse {
	if (!data || typeof data !== "object" || Array.isArray(data)) {
		throw new TypeError("WebSocket message must be an object");
	}

	const response = data as RawNezhaWebsocketResponse;
	if (typeof response.now !== "number" || !Number.isFinite(response.now)) {
		throw new TypeError("WebSocket message must include a finite now value");
	}

	return {
		...response,
		now: response.now,
		servers: Array.isArray(response.servers) ? response.servers : [],
	};
}

// Share the existing login query; ordinary hiding applies only to anonymous visitors.
export function AuthenticatedWebSocketProvider(props: Omit<WebSocketProviderProps, "authenticated">) {
 const { isLogin, viewer } = useLoginUser();
 return <WebSocketProvider {...props} authenticated={isLogin} viewerId={viewer} />;
}

export const WebSocketProvider: React.FC<WebSocketProviderProps> = ({
 url,
 children,
 authenticated = false,
 viewerId,
}) => {
	const [lastData, setLastData] = useState<NezhaWebsocketResponse | null>(null);
	const [messageHistory, setMessageHistory] = useState<
		NezhaWebsocketResponse[]
	>([]);
	// A page-session display preference only; never persisted as authorization.
	const [showDisplayHidden, setShowDisplayHidden] = useState(false);
// biome-ignore lint/correctness/useExhaustiveDependencies: Reset the page-session visibility choice whenever authentication changes.
	useEffect(() => { setShowDisplayHidden(false); }, [authenticated]);
	const inventoryData = useMemo(() => lastData ? {...lastData, servers: lastData.servers.filter(server => authenticated || showDisplayHidden || !server.hide_for_display)} : null, [lastData, showDisplayHidden, authenticated]);
	const displayHiddenCount = lastData?.servers.filter(server => server.hide_for_display).length ?? 0;
	const [connected, setConnected] = useState(false);
	const [needReconnect, setNeedReconnect] = useState(false);
 const ws = useRef<WebSocket | null>(null);
 const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
 const reconnectAttempts = useRef(0);
 const isConnecting = useRef(false);
 const active = useRef(false);
 const lastRecovery = useRef(-Infinity);

 const cleanup = useCallback(() => {
  const socket = ws.current;
  ws.current = null;
  isConnecting.current = false;
  if (socket) {
   socket.onopen = socket.onclose = socket.onmessage = socket.onerror = null;
   if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
  }
  if (reconnectTimeout.current !== null) clearTimeout(reconnectTimeout.current);
  reconnectTimeout.current = null;
  setConnected(false);
 }, []);

 const connect = useCallback(function connectSocket() {
  if (!active.current || isConnecting.current) return;
  cleanup();
  isConnecting.current = true;
  const scheduleRetry = () => {
   if (!active.current || reconnectTimeout.current !== null || reconnectAttempts.current >= 30) return;
   reconnectTimeout.current = setTimeout(() => {
    reconnectTimeout.current = null;
    reconnectAttempts.current++;
    connectSocket();
   }, 3000);
  };
  try {
   const wsUrl = new URL(url, window.location.origin);
   wsUrl.protocol = wsUrl.protocol.replace("http", "ws");
   const publicNotes = new Map<number, string>();
   const socket = new WebSocket(wsUrl.toString());
   ws.current = socket;
   const isCurrent = () => active.current && ws.current === socket;
   socket.onopen = () => {
    if (!isCurrent()) return;
    setConnected(true);
    reconnectAttempts.current = 0;
    isConnecting.current = false;
   };
   const disconnected = () => {
    if (!isCurrent()) return;
    cleanup();
    scheduleRetry();
   };
   socket.onclose = disconnected;
   socket.onerror = disconnected;
   socket.onmessage = event => {
    if (!isCurrent()) return;
    try {
     if (typeof event.data !== "string") throw new Error("WebSocket message data must be a string");
     const newData = normalizeWebSocketResponse(JSON.parse(event.data));
     newData.servers = newData.servers.map(server => {
      if (server.public_note !== undefined) publicNotes.set(server.id, server.public_note);
      return { ...server, public_note: publicNotes.get(server.id) ?? "" };
     });
     setLastData(newData);
     setMessageHistory(previous => [newData, ...previous].slice(0, 30));
    } catch (error) { console.error("Failed to parse WebSocket message:", error); }
   };
  } catch (error) {
   console.error("WebSocket connection error:", error);
   isConnecting.current = false;
   scheduleRetry();
  }
 }, [cleanup, url]);

 const reconnect = useCallback(() => {
  if (!active.current) return;
  reconnectAttempts.current = 0;
  cleanup();
  reconnectTimeout.current = setTimeout(() => {
   reconnectTimeout.current = null;
   connect();
  }, 1000);
 }, [cleanup, connect]);

 useEffect(() => {
  active.current = true;
  reconnectAttempts.current = 0;
  lastRecovery.current = -Infinity;
  setLastData(null);
  setMessageHistory([]);
  connect();
  const recover = () => {
   if (!active.current || isConnecting.current || ws.current?.readyState === WebSocket.OPEN || reconnectTimeout.current !== null) return;
   if (Date.now() - lastRecovery.current < 3000) return;
   lastRecovery.current = Date.now();
   reconnectAttempts.current = 0;
   connect();
  };
  // pagehide/pageshow covers bfcache; beforeunload can be cancelled by the user.
  const pause = () => cleanup();
  window.addEventListener("online", recover);
  window.addEventListener("focus", recover);
  window.addEventListener("pageshow", recover);
  window.addEventListener("pagehide", pause);
  return () => {
   active.current = false;
   cleanup();
   window.removeEventListener("online", recover);
   window.removeEventListener("focus", recover);
   window.removeEventListener("pageshow", recover);
   window.removeEventListener("pagehide", pause);
  };
 }, [cleanup, connect, viewerId]);

	const contextValue: WebSocketContextType = {
		inventoryData, showDisplayHidden, setShowDisplayHidden, displayHiddenCount,
		lastData,
		connected,
		messageHistory,
		reconnect,
		needReconnect,
		setNeedReconnect,
	};

	return (
		<WebSocketContext.Provider value={contextValue}>
			{children}
		</WebSocketContext.Provider>
	);
};
