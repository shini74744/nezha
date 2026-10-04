import {act,screen} from "@testing-library/react";
import {describe,it,expect,vi} from "vitest";
import {DoraemonTrafficProvider,DoraemonTraffic,doraemonTrafficKey} from "@/themes/doraemon/Traffic";
import {doraemonAppearance} from "@/themes/doraemon/appearance";
import {renderWithProviders} from "@/test/utils";
const config=(enabled=true,traffic=true)=>JSON.stringify({version:1,enabled,features:{traffic:{enabled:traffic,toggleInterval:5000}}});
const stat={max:100,used:20,from:"2026-10-01T00:00:00+08:00",to:"2026-11-01T00:00:00+08:00",direction:"3"};
const tree=(raw:string|undefined,ready=true)=><DoraemonTrafficProvider appearance={raw} ready={ready}><DoraemonTraffic serverId={7}/><span>network rates remain</span></DoraemonTrafficProvider>;
describe("Doraemon traffic visibility",()=>{
 it.each([[false,true],[true,false],[false,false]])("makes no request when master=%s traffic=%s",async(enabled,traffic)=>{
  vi.useFakeTimers();const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
  const v=renderWithProviders(tree(config(enabled,traffic)));
  await act(async()=>{await vi.advanceTimersByTimeAsync(90000)});
  expect(fetcher).not.toHaveBeenCalled();expect(v.container.querySelector(".dora-traffic")).toBeNull();
  expect(v.container).toHaveTextContent("network rates remain");v.unmount();v.queryClient.clear();
 });
 it("does not flash or fetch before settings arrive, including a disabled saved value",()=>{
  const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
  const v=renderWithProviders(tree(undefined,false));
  expect(fetcher).not.toHaveBeenCalled();expect(v.container.querySelector(".dora-traffic")).toBeNull();
  v.rerender(tree(config(true,false)));
  expect(fetcher).not.toHaveBeenCalled();expect(v.container.querySelector(".dora-traffic")).toBeNull();
  v.unmount();v.queryClient.clear();
 });
 it("hides cached rows immediately, stops polling, and refetches when re-enabled",async()=>{
  vi.useFakeTimers();const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({success:true,data:{7:stat}})});
  vi.stubGlobal("fetch",fetcher);const v=renderWithProviders(tree(config()));
  await act(async()=>{await vi.advanceTimersByTimeAsync(10)});
  expect(screen.getByRole("progressbar")).toBeInTheDocument();
  v.rerender(tree(config(true,false)));
  expect(v.queryClient.getQueryData(doraemonTrafficKey)).toBeDefined();
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  await act(async()=>{await vi.advanceTimersByTimeAsync(90000)});
  expect(fetcher).toHaveBeenCalledTimes(1);
  v.rerender(tree(config()));
  await act(async()=>{await vi.advanceTimersByTimeAsync(10)});
  expect(fetcher).toHaveBeenCalledTimes(2);expect(screen.getByRole("progressbar")).toBeInTheDocument();
  v.unmount();v.queryClient.clear();
 });
 it("aborts an in-flight traffic request when disabled",()=>{
  let signal:AbortSignal|undefined;
  vi.stubGlobal("fetch",vi.fn((_url,options)=>{signal=options.signal;return new Promise(()=>{})}));
  const v=renderWithProviders(tree(config()));
  expect(signal?.aborted).toBe(false);
  v.rerender(tree(config(false)));
  expect(signal?.aborted).toBe(true);expect(v.container.querySelector(".dora-traffic")).toBeNull();
  v.unmount();v.queryClient.clear();
 });
 it("has independent compatibility defaults and fails closed for invalid documents",()=>{
  expect(doraemonAppearance()).toEqual({enabled:true,interval:5000});
  expect(doraemonAppearance(config(true,false)).enabled).toBe(false);
  for(const raw of ["{","null","{}",JSON.stringify({version:1,enabled:true,features:{traffic:{enabled:true,toggleInterval:0}}})])
   expect(doraemonAppearance(raw).enabled).toBe(false);
 });
});
