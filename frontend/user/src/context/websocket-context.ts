import { createContext } from "react";
import type { NezhaWebsocketResponse } from "@/types/nezha-api";

export interface WebSocketContextType {
	inventoryData?: NezhaWebsocketResponse | null;
	showDisplayHidden?: boolean;
	setShowDisplayHidden?: (show: boolean) => void;
	displayHiddenCount?: number;
	lastData: NezhaWebsocketResponse | null;
	connected: boolean;
	messageHistory: NezhaWebsocketResponse[];
	reconnect: () => void;
	needReconnect: boolean;
	setNeedReconnect: (needReconnect: boolean) => void;
}

export const WebSocketContext = createContext<WebSocketContextType>({
	lastData: null,
	connected: false,
	messageHistory: [],
	reconnect: () => {},
	needReconnect: false,
	setNeedReconnect: () => {},
});
