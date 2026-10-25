import type { LoginUserResponse, MetricPeriod, MetricType, MonitorResponse, ServerGroupResponse, ServerMetricsResponse, ServiceResponse, SettingResponse } from "@/types/nezha-api";
import { ApiError, requestJson } from "./request-json";

let lastestRefreshTokenAt = 0;
const getCsrfToken = (): string => {
 try {
  const cookie = document.cookie.split("; ").find(item => item.startsWith("nz-csrf="));
  return cookie ? decodeURIComponent(cookie.split("=").slice(1).join("=")) : "";
 } catch { return ""; }
};

export const fetchServerGroup = (): Promise<ServerGroupResponse> => requestJson("/api/v1/server-group");

export const fetchLoginUser = async ({ signal }: { signal?: AbortSignal } = {}): Promise<LoginUserResponse | null> => {
 let data: LoginUserResponse;
 try { data = await requestJson<LoginUserResponse>("/api/v1/profile", signal); }
 catch (error) {
  // Replace a previously cached identity on an explicit session expiry.
  // Transient network/5xx errors must not masquerade as a logout.
  if (error instanceof ApiError && error.status === 401) return null;
  throw error;
 }
 if (data.data?.id && (!lastestRefreshTokenAt || Date.now() - lastestRefreshTokenAt > 3600000)) {
  lastestRefreshTokenAt = Date.now();
  void fetch("/api/v1/refresh-token", { method: "POST", headers: { "X-CSRF-Token": getCsrfToken() } }).catch(() => {
   lastestRefreshTokenAt = 0;
  });
 }
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
