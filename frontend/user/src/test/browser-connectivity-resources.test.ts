import { describe, expect, it, vi, afterEach } from "vitest";
import catalog from "../../../../service/connectivity/catalog.json";
import { browserProbeURL, runBrowserConnectivity } from "@/lib/browser-connectivity";
afterEach(()=>vi.unstubAllGlobals());
describe("shared lightweight connectivity resources",()=>{
 it.each(catalog)("uses the exact server resource for $id",target=>{
  const url=browserProbeURL(target.host,"https://panel.example.org/");
  expect(url).toBe(target.url);
  expect(new URL(url!).pathname).not.toBe("/");
  expect(new URL(url!).protocol).toBe("https:");
 });
 it("never sends an administrator-only URL or follows an ID to a different custom host",async()=>{
  const fetcher=vi.fn().mockResolvedValue({type:"opaque"}); vi.stubGlobal("fetch",fetcher);
  await runBrowserConnectivity([{id:"youtube",name:"Custom",group:"global",host:"public.example.org",status:"pending",samples:[],url:"https://secret.example.org/admin?token=secret"} as any],new AbortController().signal,()=>{});
  expect(fetcher).toHaveBeenCalledTimes(7);
  expect(fetcher.mock.calls.every(([url])=>url==="https://public.example.org/favicon.ico")).toBe(true);
 });
 it("cancels between the two warmups without publishing a measured sample",async()=>{
  const controller=new AbortController();
  const fetcher=vi.fn().mockImplementation(async()=>{controller.abort();return {type:"opaque"}});
  vi.stubGlobal("fetch",fetcher);
  const run=await runBrowserConnectivity([{id:"youtube",name:"YouTube",group:"usa",host:"yt3.ggpht.com",status:"pending",samples:[]}],controller.signal,()=>{});
  expect(fetcher).toHaveBeenCalledTimes(1);expect(run.cancelled).toBe(true);
  expect(run.results[0].samples).toEqual([]);expect(run.results[0].delay_ms).toBeUndefined();
 });
});
