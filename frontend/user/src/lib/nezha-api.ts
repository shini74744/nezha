import { renewSessionIfNeeded } from "../../../shared/session-renewal";
import type { LoginUserResponse, MetricPeriod, MetricType, MonitorResponse, ServerGroupResponse, ServerMetricsResponse, ServiceResponse, SettingResponse } from "@/types/nezha-api";
import { ApiError, requestJson } from "./request-json";

export const fetchServerGroup = (): Promise<ServerGroupResponse> => requestJson("/api/v1/server-group");

export const fetchLoginUser = async ({ signal }: { signal?: AbortSignal } = {}): Promise<LoginUserResponse | null> => {
 let data: LoginUserResponse;
 try { data = await requestJson<LoginUserResponse>("/api/v1/profile", signal); }
 catch (error) {
  // Replace a previously cached identity on an explicit session expiry.
  // Transient network/5xx errors must not masquerade as a logout.
  // This dashboard also reports an expired or absent session as HTTP 200.
  if (error instanceof ApiError && (error.status === 401 || (error.status === 200 && error.message === "ApiErrorUnauthorized"))) return null;
  throw error;
 }
 if (data.data?.id) void renewSessionIfNeeded(data.data.id);
 return data;
};

export type MonitorPeriod = "1d" | "7d" | "30d";
export const fetchMonitor = async (server_id: number, period?: MonitorPeriod, signal?: AbortSignal): Promise<MonitorResponse> => {
 const data = await requestJson<MonitorResponse>(`/api/v1/server/${server_id}/service${period ? `?period=${period}` : ""}`, signal);
 if (!Array.isArray(data.data)) throw new Error("Invalid monitor data");
 return data;
};
export const fetchService = (): Promise<ServiceResponse> => requestJson("/api/v1/service");
export const fetchSetting = (): Promise<SettingResponse> => requestJson("/api/v1/setting");
export const fetchServerMetrics = async (server_id: number, metric: MetricType, period?: MetricPeriod, signal?: AbortSignal): Promise<ServerMetricsResponse> => {
 const data = await requestJson<ServerMetricsResponse>(`/api/v1/server/${server_id}/metrics?metric=${metric}${period ? `&period=${period}` : ""}`, signal);
 if (!Array.isArray(data.data?.data_points)) throw new Error("Invalid metric data");
 return data;
};

export const fetchServerOnlineHistory = async (id: number, days = 1, signal?: AbortSignal): Promise<import("@/types/nezha-api").OnlineHistoryResponse> => {
 const response = await requestJson<import("@/types/nezha-api").OnlineHistoryResponse>(`/api/v1/server/${id}/online-history?days=${days}`, signal);
 if (!Array.isArray(response.data?.periods) || !Array.isArray(response.data?.daily)) throw new Error("Invalid online history");
 return response;
};
