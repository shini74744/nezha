import type React from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchLoginUser } from "@/lib/nezha-api";
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
 const {data, isError} = useQuery({
  queryKey: ["login-user"], queryFn: fetchLoginUser, retry: 0,
  refetchOnWindowFocus: true, refetchInterval: 30000,
 });
 return <WebSocketProvider {...props} authenticated={!isError && !!data?.data?.id} />;
}

export const WebSocketProvider: React.FC<WebSocketProviderProps> = ({
 url,
 children,
 authenticated = false,
}) => {
	const [lastData, setLastData] = useState<NezhaWebsocketResponse | null>(null);
	const [messageHistory, setMessageHistory] = useState<
		NezhaWebsocketResponse[]
	>([]);
	// A page-session display preference only; never persisted as authorization.
	const [showDisplayHidden, setShowDisplayHidden] = useState(false);
	useEffect(() => { setShowDisplayHidden(false); }, [authenticated]);
	const inventoryData = useMemo(() => lastData ? {...lastData, servers: lastData.servers.filter(server => authenticated || showDisplayHidden || !server.hide_for_display)} : null, [lastData, showDisplayHidden, authenticated]);
	const displayHiddenCount = lastData?.servers.filter(server => server.hide_for_display).length ?? 0;
	const [connected, setConnected] = useState(false);
	const [needReconnect, setNeedReconnect] = useState(false);
	const ws = useRef<WebSocket | null>(null);
	const reconnectTimeout = useRef<NodeJS.Timeout>(null);
	const maxReconnectAttempts = 30;
	const reconnectAttempts = useRef(0);
	const isConnecting = useRef(false);

	const cleanup = useCallback(() => {
		if (ws.current) {
			// 移除所有事件监听器
			ws.current.onopen = null;
			ws.current.onclose = null;
			ws.current.onmessage = null;
			ws.current.onerror = null;

			if (
				ws.current.readyState === WebSocket.OPEN ||
				ws.current.readyState === WebSocket.CONNECTING
			) {
				ws.current.close();
			}
			ws.current = null;
		}
		if (reconnectTimeout.current) {
			clearTimeout(reconnectTimeout.current);
			reconnectTimeout.current = null;
		}
		setConnected(false);
	}, []);

	const connect = useCallback(() => {
		if (isConnecting.current) {
			console.log("Connection already in progress");
			return;
		}

		cleanup();
		isConnecting.current = true;

		try {
			const wsUrl = new URL(url, window.location.origin);
			wsUrl.protocol = wsUrl.protocol.replace("http", "ws");

			// Notes arrive only in the first frame. Keep them even for initially folded cards.
			const publicNotes = new Map<number, string>();
			ws.current = new WebSocket(wsUrl.toString());

			ws.current.onopen = () => {
				console.log("WebSocket connected");
				setConnected(true);
				reconnectAttempts.current = 0;
				isConnecting.current = false;
			};

			ws.current.onclose = () => {
				console.log("WebSocket disconnected");
				setConnected(false);
				ws.current = null;
				isConnecting.current = false;

				if (reconnectAttempts.current < maxReconnectAttempts) {
					reconnectTimeout.current = setTimeout(() => {
						reconnectAttempts.current++;
						connect();
					}, 3000);
				}
			};

			ws.current.onmessage = (event) => {
				try {
					if (typeof event.data !== "string") {
						throw new Error("WebSocket message data must be a string");
					}

					const newData = normalizeWebSocketResponse(JSON.parse(event.data));
					newData.servers = newData.servers.map(server => {
						if (server.public_note !== undefined) publicNotes.set(server.id, server.public_note);
						return {...server, public_note: publicNotes.get(server.id) ?? ""};
					});
					setLastData(newData);
					// 更新历史消息，保持最新的30条记录
					setMessageHistory((prev) => {
						const updated = [newData, ...prev];
						return updated.slice(0, 30);
					});
				} catch (error) {
					console.error("Failed to parse WebSocket message:", error);
				}
			};

			ws.current.onerror = (error) => {
				console.error("WebSocket error:", error);
				isConnecting.current = false;
			};
		} catch (error) {
			console.error("WebSocket connection error:", error);
			isConnecting.current = false;
		}
	}, [cleanup, url]);

	const reconnect = () => {
		reconnectAttempts.current = 0;
		// 等待一个小延时确保清理完成
		cleanup();
		setTimeout(() => {
			connect();
		}, 1000);
	};

	useEffect(() => {
		connect();

		// 添加页面卸载事件监听
		const handleBeforeUnload = () => {
			cleanup();
		};

		window.addEventListener("beforeunload", handleBeforeUnload);

		return () => {
			cleanup();
			window.removeEventListener("beforeunload", handleBeforeUnload);
		};
	}, [cleanup, connect]);

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
