import {describe,it,expect,vi,afterEach} from "vitest";
import {render,act,cleanup} from "@testing-library/react";
import {AppearanceProvider} from "@/appearance/context";
import {defaults} from "@/appearance/config";
import {NativeName,NativeFooterIP} from "@/appearance/widgets";
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});
function config(){const c=defaults();c.enabled=true;return c;}
describe("other legacy appearance parity",()=>{
 it("retains only the requested IP provider in fresh defaults",()=>{
  const f=defaults().features.visitorIP;
  expect(f.ipApiUrls).toEqual(["https://ipinfo.io/json"]);expect(f.fallbackUrl).toBe("");
 });
 it.each([false,true])("restores the original 100 ms offline alpha steps, detail=%s",detail=>{
  vi.useFakeTimers();const c=config();
  const view=render(<AppearanceProvider raw={JSON.stringify(c)}><NativeName online={false} detail={detail}>offline</NativeName></AppearanceProvider>);
  const node=view.getByText("offline");expect(node.style.color).toBe("rgba(255, 0, 0, 0.6)");
  let phase=0,direction=1;
  for(let i=0;i<80;i++){
   phase+=direction*.05;if(phase>=1){phase=1;direction=-1}else if(phase<=0){phase=0;direction=1}
   act(()=>vi.advanceTimersByTime(100));
   expect(node.style.color).toBe("rgba(255, 0, 0, "+Number((.4+phase*.4).toFixed(2))+")");
  }
  c.enabled=false;view.rerender(<AppearanceProvider raw={JSON.stringify(c)}><NativeName online={false} detail={detail}>offline</NativeName></AppearanceProvider>);
  expect(node.style.color).toBe("");expect(vi.getTimerCount()).toBe(0);
 });
 it("slides in after 300 ms at bottom even in a narrow desktop window",()=>{
  vi.useFakeTimers();vi.spyOn(navigator,"userAgent","get").mockReturnValue("Desktop Chrome");
  vi.stubGlobal("innerWidth",390);vi.stubGlobal("innerHeight",600);vi.stubGlobal("scrollY",0);
  vi.spyOn(document.documentElement,"scrollHeight","get").mockReturnValue(1000);
  const c=config(),view=render(<AppearanceProvider raw={JSON.stringify(c)}><NativeFooterIP/></AppearanceProvider>);
  const node=view.container.querySelector<HTMLElement>("[data-native-footer-ip]")!;
  expect(node.style.transform).toBe("translateX(-50%) translateY(20px)");
  vi.stubGlobal("scrollY",400);act(()=>window.dispatchEvent(new Event("scroll")));
  act(()=>vi.advanceTimersByTime(299));expect(node.style.opacity).toBe("0");
  act(()=>vi.advanceTimersByTime(1));expect(node.style.opacity).toBe("1");
  expect(node.style.transform).toBe("translateX(-50%) translateY(0px)");
  vi.stubGlobal("scrollY",399);act(()=>window.dispatchEvent(new Event("scroll")));
  expect(node.style.opacity).toBe("0");expect(node.style.transform).toContain("20px");
  vi.stubGlobal("scrollY",400);act(()=>window.dispatchEvent(new Event("scroll")));
  vi.stubGlobal("scrollY",0);act(()=>vi.advanceTimersByTime(300));expect(node.style.opacity).toBe("0");
  view.unmount();expect(vi.getTimerCount()).toBe(0);
 });
 it("keeps mobile hidden even when its viewport is wide",()=>{
  vi.useFakeTimers();vi.spyOn(navigator,"userAgent","get").mockReturnValue("Android Mobile");
  vi.stubGlobal("innerWidth",1920);
  const view=render(<AppearanceProvider raw={JSON.stringify(config())}><NativeFooterIP/></AppearanceProvider>);
  expect(view.container.querySelector<HTMLElement>("[data-native-footer-ip]")!.style.display).toBe("none");
  act(()=>window.dispatchEvent(new Event("scroll")));expect(vi.getTimerCount()).toBe(0);
 });
});
