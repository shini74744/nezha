import {describe,it,expect,vi,afterEach} from "vitest";
import {render,act,cleanup} from "@testing-library/react";
import {AppearanceProvider} from "@/appearance/context";
import {defaults} from "@/appearance/config";
import {NativeName,NativeFooterIP} from "@/appearance/widgets";
import {WebSocketContext} from "@/context/websocket-context";
const loadedSocket={connected:true,lastData:{now:1,servers:[]},messageHistory:[],reconnect:()=>{},needReconnect:false,setNeedReconnect:()=>{}};
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
 it("restores the bottom overlay and signals the copyright fitter",()=>{
  vi.useFakeTimers();vi.spyOn(navigator,"userAgent","get").mockReturnValue("Desktop Chrome");
  vi.stubGlobal("innerHeight",600);vi.stubGlobal("scrollY",400);
  vi.spyOn(document.documentElement,"scrollHeight","get").mockReturnValue(1000);
  const view=render(<WebSocketContext.Provider value={loadedSocket}><AppearanceProvider raw={JSON.stringify(config())}><NativeFooterIP/></AppearanceProvider></WebSocketContext.Provider>);
  const node=view.container.querySelector<HTMLElement>("[data-native-footer-ip]")!;
  act(()=>vi.advanceTimersByTime(300));expect(node.dataset.visible).toBe("true");
  expect(node.style.transform).toBe("translateX(-50%) translateY(0px)");
  expect(view.queryByText("独立查看 ↗")).toBeNull();
  vi.stubGlobal("scrollY",0);act(()=>window.dispatchEvent(new Event("scroll")));
  expect(node.dataset.visible).toBe("false");
 });
 it("preserves the original mobile hide policy",()=>{
  vi.spyOn(navigator,"userAgent","get").mockReturnValue("iPhone Mobile");
  const view=render(<WebSocketContext.Provider value={loadedSocket}><AppearanceProvider raw={JSON.stringify(config())}><NativeFooterIP/></AppearanceProvider></WebSocketContext.Provider>);
  const node=view.container.querySelector<HTMLElement>("[data-native-footer-ip]")!;
  expect(node.style.display).toBe("none");expect(node.dataset.visible).toBe("false");
 });
});
