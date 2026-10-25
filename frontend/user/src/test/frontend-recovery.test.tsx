import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useMetricHistory } from "@/hooks/use-metric-history";
import { useLoginUser } from "@/hooks/use-login-user";
import { fetchLoginUser, fetchMonitor, fetchServerMetrics, fetchSetting } from "@/lib/nezha-api";
import { safeLocalStorage, safeSessionStorage } from "@/lib/storage";
import { preloadableView } from "@/lib/preloadable-view";
import { IsolatedChildren, LocalErrorBoundary } from "@/components/LocalErrorBoundary";
import { ThemeProvider } from "@/components/ThemeProvider";
import { useTheme } from "@/hooks/use-theme";
import { useStatisticsView } from "@/hooks/use-statistics-view";
import type { MetricPeriod } from "@/types/nezha-api";

const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const metric = (value: number) => response({ success: true, data: { data_points: [{ ts: 1000, value }] } });
function wrapper() {
 const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
 return { client, Wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> };
}
describe("history recovery", () => {
 it("clears old periods, cancels superseded requests and ignores their late results", async () => {
  let finish!: (value: Response) => void; let oldSignal: AbortSignal | undefined;
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
   if (url.includes("period=7d")) { oldSignal = init?.signal as AbortSignal; return new Promise<Response>(r => { finish = r; }); }
   return Promise.resolve(metric(url.includes("period=30d") ? 30 : 1));
  }));
  const { Wrapper } = wrapper();
  const view = renderHook(({ period, id }) => useMetricHistory(id, ["cpu"], period), { wrapper: Wrapper, initialProps: { period: "1d" as MetricPeriod, id: 7 } });
  await waitFor(() => expect(view.result.current.series?.[0][0].value).toBe(1));
  view.rerender({ period: "7d", id: 7 });
  expect(view.result.current.series).toBeUndefined();
  await waitFor(() => expect(oldSignal).toBeDefined());
  view.rerender({ period: "30d", id: 8 });
  await waitFor(() => expect(view.result.current.series?.[0][0].value).toBe(30));
  expect(oldSignal?.aborted).toBe(true);
  await act(async () => finish(metric(999)));
  expect(view.result.current.series?.[0][0].value).toBe(30);
 });
 it("does not present partial multi-series failures as zero and supports explicit retry", async () => {
  let broken = true;
  vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(url.includes("metric=swap") && broken ? response({success:false}, 503) : metric(0))));
  const { Wrapper } = wrapper();
  const view = renderHook(() => useMetricHistory(7, ["memory", "swap"], "1d"), { wrapper: Wrapper });
  await waitFor(() => expect(view.result.current.error).toBe(true));
  expect(view.result.current.series).toBeUndefined();
  broken = false;
  act(() => view.result.current.retry());
  await waitFor(() => expect(view.result.current.series).toEqual([[{ts:1000,value:0}],[{ts:1000,value:0}]]));
 });
 it("returning to realtime aborts history without another fetch", async () => {
  let signal!: AbortSignal;
  vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => { signal=init.signal as AbortSignal; return new Promise<Response>(()=>{}); }));
  const { Wrapper } = wrapper();
  const view = renderHook(({period})=>useMetricHistory(7,["cpu"],period),{wrapper:Wrapper,initialProps:{period:"1d" as MetricPeriod|"realtime"}});
  await waitFor(()=>expect(signal).toBeDefined());
  view.rerender({period:"realtime"});
  expect(signal.aborted).toBe(true);expect(view.result.current.isLoading).toBe(false);
  expect(view.result.current.series).toBeUndefined();expect(fetch).toHaveBeenCalledOnce();
 });
});
describe("HTTP and identity", () => {
 it.each([fetchSetting, ()=>fetchMonitor(7), ()=>fetchServerMetrics(7,"cpu")])("rejects HTTP errors even with success-shaped JSON",async fn=>{
  vi.stubGlobal("fetch",vi.fn(async()=>response({success:true,data:[]},503)));
  await expect(fn()).rejects.toThrow("503");
 });
 it("rejects failed envelopes, malformed JSON and missing metric points",async()=>{
  vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce(response({success:false})).mockResolvedValueOnce(new Response("<html>")).mockResolvedValueOnce(response({success:true,data:{}})));
  await expect(fetchSetting()).rejects.toThrow();
  await expect(fetchSetting()).rejects.toThrow();
  await expect(fetchServerMetrics(7,"cpu")).rejects.toThrow("Invalid metric data");
 });
 it("recognizes HttpOnly sessions, keeps identity on transient errors, clears it on 401",async()=>{
  let status=200;
  vi.stubGlobal("fetch",vi.fn(async(url:string)=>url.includes("refresh-token") ? response({success:true}) : response({success:status===200,data:{id:7}},status)));
  const {Wrapper}=wrapper();
  const view=renderHook(()=>useLoginUser(),{wrapper:Wrapper});
  expect(document.cookie).toBe("");
  await waitFor(()=>expect(view.result.current.viewer).toBe(7));
  status=503;await act(async()=>{await view.result.current.refetch()});
  await waitFor(()=>expect(view.result.current.isError).toBe(true));expect(view.result.current.isLogin).toBe(true);
  status=401;await act(async()=>{await view.result.current.refetch()});
  await waitFor(()=>expect(view.result.current.session).toBe("anonymous"));
  expect(view.result.current.viewer).toBe(0);expect(view.result.current.data).toBeNull();
 });
 it("recognizes the dashboard HTTP 200 unauthorized envelope and clears a cached member",async()=>{
  let expired=false;
  vi.stubGlobal("fetch",vi.fn(async(url:string)=>url.includes("refresh-token") ? response({success:true}) : response(expired ? {error:"ApiErrorUnauthorized"} : {success:true,data:{id:7}})));
  const {Wrapper}=wrapper();const view=renderHook(()=>useLoginUser(),{wrapper:Wrapper});
  await waitFor(()=>expect(view.result.current.viewer).toBe(7));
  expired=true;await act(async()=>{await view.result.current.refetch()});
  await waitFor(()=>expect(view.result.current.session).toBe("anonymous"));
  expect(view.result.current.viewer).toBe(0);expect(view.result.current.data).toBeNull();
 });
 it.each([response({error:"storage unavailable"}),response({error:"ApiErrorUnauthorized"},503),response({error:"ApiErrorUnauthorized"},403)])("does not mistake unrelated or transient errors for a logout",async payload=>{
  vi.stubGlobal("fetch",vi.fn(async()=>payload));
  await expect(fetchLoginUser()).rejects.toThrow();
 });
 it("failed initial identity is unknown, not authenticated; direct 401 resolves null",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>response({success:false},401)));
  await expect(fetchLoginUser()).resolves.toBeNull();
  vi.stubGlobal("fetch",vi.fn(async()=>{throw new TypeError("offline")}));
  const {Wrapper}=wrapper();const view=renderHook(()=>useLoginUser(),{wrapper:Wrapper});
  await waitFor(()=>expect(view.result.current.isError).toBe(true));
  expect(view.result.current.session).toBe("unknown");expect(view.result.current.isLogin).toBe(false);
 });
});
describe("optional storage",()=>{
 it.each(["localStorage","sessionStorage"] as const)("handles blocked %s getter and methods",kind=>{
  const safe=kind==="localStorage"?safeLocalStorage:safeSessionStorage;
  const descriptor=Object.getOwnPropertyDescriptor(window,kind)!;
  try {
   Object.defineProperty(window,kind,{configurable:true,get(){throw new DOMException("blocked","SecurityError")}});
   expect(safe.getItem("x")).toBeNull();
   expect(()=>{safe.setItem("x","1");safe.removeItem("x")}).not.toThrow();
  } finally {Object.defineProperty(window,kind,descriptor)}
  vi.spyOn(Storage.prototype,"getItem").mockImplementation(()=>{throw new Error("blocked")});
  vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new Error("quota")});
  vi.spyOn(Storage.prototype,"removeItem").mockImplementation(()=>{throw new Error("blocked")});
  expect(safe.getItem("x")).toBeNull();expect(()=>{safe.setItem("x","1");safe.removeItem("x")}).not.toThrow();
 });
 it.each(["","doraemon:"])("retains statistics choice %s when polling has no data",prefix=>{
  safeLocalStorage.setItem(prefix+"statisticsView","traffic");
  const view=renderHook(({has})=>useStatisticsView(prefix,true,has),{initialProps:{has:false}});
  expect(view.result.current[0]).toBe("traffic");
  view.rerender({has:true});expect(view.result.current[0]).toBe("traffic");
  act(()=>view.result.current[1]("uptime"));view.rerender({has:false});
  expect(view.result.current[0]).toBe("uptime");
 });
 it.each(["vite-ui-theme","doraemon-ui-theme"])("keeps theme switch usable when persistence fails: %s",storageKey=>{
  function Switch(){const {theme,setTheme}=useTheme();return <button onClick={()=>setTheme("dark")}>{theme}</button>}
  vi.spyOn(Storage.prototype,"getItem").mockImplementation(()=>{throw new Error("blocked")});
  vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new Error("blocked")});
  render(<ThemeProvider storageKey={storageKey}><Switch/></ThemeProvider>);
  fireEvent.click(screen.getByRole("button"));expect(screen.getByRole("button")).toHaveTextContent("dark");
 });
});
describe("local failures and lazy retries",()=>{
 it("isolates a broken card, retries it, and resets errors when the node changes",()=>{
  vi.spyOn(console,"error").mockImplementation(()=>{});let broken=true;
  function Card(){if(broken)throw new Error("broken");return <p>fixed</p>}
  const view=render(<IsolatedChildren resetKey="7"><Card/><p>healthy</p></IsolatedChildren>);
  expect(screen.getByText("healthy")).toBeVisible();expect(screen.getByRole("alert")).toBeVisible();
  broken=false;fireEvent.click(screen.getByText("重新加载"));expect(screen.getByText("fixed")).toBeVisible();
  broken=true;view.rerender(<IsolatedChildren resetKey="7"><Card/><p>healthy</p></IsolatedChildren>);
  broken=false;view.rerender(<IsolatedChildren resetKey="8"><Card/><p>healthy</p></IsolatedChildren>);
  expect(screen.queryByRole("alert")).toBeNull();expect(screen.getByText("fixed")).toBeVisible();
 });
 it("retries a rejected mounted lazy loader without losing a neighboring component",async()=>{
  vi.spyOn(console,"error").mockImplementation(()=>{});
  function Counter(){const [value,setValue]=useState(0);return <button onClick={()=>setValue(v=>v+1)}>neighbor:{value}</button>}
  const loader=vi.fn().mockRejectedValueOnce(new Error("temporary import error")).mockResolvedValue({default:()=> <p>module ready</p>});
  const {View}=preloadableView(loader);
  render(<><Counter/><Suspense fallback={<p>loading</p>}><View/></Suspense></>);
  await screen.findByText("重新加载");fireEvent.click(screen.getByText("neighbor:0"));
  expect(screen.getByText("刷新页面")).toBeVisible();
  fireEvent.click(screen.getByText("重新加载"));await screen.findByText("module ready");
  expect(screen.getByText("neighbor:1")).toBeVisible();expect(loader).toHaveBeenCalledTimes(2);
 });
 it("ordinary parent rerenders do not remount healthy children",()=>{
  function Counter(){const [n,set]=useState(0);return <button onClick={()=>set(n+1)}>{n}</button>}
  const view=render(<LocalErrorBoundary resetKey="1"><Counter/></LocalErrorBoundary>);
  fireEvent.click(screen.getByRole("button"));
  view.rerender(<LocalErrorBoundary resetKey="2"><Counter/></LocalErrorBoundary>);
  expect(screen.getByRole("button")).toHaveTextContent("1");
 });
});
