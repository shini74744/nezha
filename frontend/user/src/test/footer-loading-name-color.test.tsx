import {describe,it,expect,vi,beforeEach,afterEach} from "vitest";
import {render,act,cleanup} from "@testing-library/react";
import {AppearanceProvider} from "@/appearance/context";
import {defaults} from "@/appearance/config";
import {NativeFooterIP} from "@/appearance/footer-ip";
import {NativeName} from "@/appearance/widgets";
import {WebSocketContext,type WebSocketContextType} from "@/context/websocket-context";
import lightCSS from "@/appearance/light-readability.css?raw";
let pageHeight=600,resize=()=>{};
const disconnect=vi.fn(),OriginalResizeObserver=globalThis.ResizeObserver;
function fixture(connected=true,loaded=true,enabled=true){
 const config=defaults();config.enabled=true;config.features.footerIP.enabled=enabled;
 const socket:WebSocketContextType={connected,lastData:loaded?{now:1,servers:[]}:null,messageHistory:[],reconnect:()=>{},needReconnect:false,setNeedReconnect:()=>{}};
 return <WebSocketContext.Provider value={socket}><AppearanceProvider raw={JSON.stringify(config)}><NativeFooterIP/></AppearanceProvider></WebSocketContext.Provider>;
}
beforeEach(()=>{
 vi.useFakeTimers();pageHeight=600;resize=()=>{};disconnect.mockClear();
 vi.spyOn(navigator,"userAgent","get").mockReturnValue("Desktop Chrome");
 vi.stubGlobal("innerHeight",600);vi.stubGlobal("scrollY",0);
 vi.spyOn(document.documentElement,"scrollHeight","get").mockImplementation(()=>pageHeight);
 globalThis.ResizeObserver=class{
  constructor(callback:ResizeObserverCallback){resize=()=>callback([],this)}
  observe=vi.fn();unobserve=vi.fn();disconnect=disconnect;
 };
});
afterEach(()=>{cleanup();globalThis.ResizeObserver=OriginalResizeObserver;vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals()});
const tick=(ms=1000)=>act(()=>vi.advanceTimersByTime(ms));
const visible=(view:ReturnType<typeof render>)=>view.container.querySelector<HTMLElement>("[data-native-footer-ip]")!.dataset.visible;
describe("footer IP loading and geometry gate",()=>{
 it.each([[false,false],[true,false]])("never opens a short loading page, connected=%s loaded=%s",(connected,loaded)=>{
  const view=render(fixture(connected,loaded));tick();
  expect(visible(view)).toBe("false");
  act(()=>{window.dispatchEvent(new Event("scroll"));window.dispatchEvent(new Event("resize"));resize()});tick();
  expect(visible(view)).toBe("false");
 });
 it("stays hidden after data arrives until the loaded list reaches the viewport bottom",()=>{
  const view=render(fixture(false,false));tick();
  pageHeight=2000;view.rerender(fixture());act(()=>resize());tick();
  expect(visible(view)).toBe("false");
  vi.stubGlobal("scrollY",1400);act(()=>window.dispatchEvent(new Event("scroll")));
  tick(299);expect(visible(view)).toBe("false");tick(1);expect(visible(view)).toBe("true");
 });
 it("accepts a genuinely loaded short or empty list",()=>{
  const view=render(fixture());tick(300);expect(visible(view)).toBe("true");
 });
 it("hides when content grows without any scroll or window resize",()=>{
  const view=render(fixture());tick();expect(visible(view)).toBe("true");
  pageHeight=2000;act(()=>resize());expect(visible(view)).toBe("false");tick();expect(visible(view)).toBe("false");
  pageHeight=600;act(()=>resize());tick(300);expect(visible(view)).toBe("true");
 });
 it("rechecks geometry when the pending show timer fires",()=>{
  const view=render(fixture());tick(200);pageHeight=2000;tick(100);
  expect(visible(view)).toBe("false");
 });
 it("hides immediately when scrolling up, disconnecting or disabling",()=>{
  pageHeight=1000;vi.stubGlobal("scrollY",400);
  const view=render(fixture());tick();expect(visible(view)).toBe("true");
  vi.stubGlobal("scrollY",100);act(()=>window.dispatchEvent(new Event("scroll")));expect(visible(view)).toBe("false");
  vi.stubGlobal("scrollY",400);act(()=>window.dispatchEvent(new Event("scroll")));tick();expect(visible(view)).toBe("true");
  view.rerender(fixture(false,true));expect(visible(view)).toBe("false");tick();expect(visible(view)).toBe("false");
  view.rerender(fixture());tick();expect(visible(view)).toBe("true");
  view.rerender(fixture(true,true,false));expect(view.container.querySelector("[data-native-footer-ip]")).toBeNull();expect(disconnect).toHaveBeenCalled();
  tick();expect(vi.getTimerCount()).toBe(0);
 });
 it("removes listeners, timers and the observer on unmount",()=>{
  const view=render(fixture());view.unmount();tick();expect(disconnect).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
 });
});
describe("daytime name color retains the animation",()=>{
 it.each([false,true])("updates both live hues without changing the original night color, detail=%s",detail=>{
  const config=defaults();config.enabled=true;
  const view=render(<AppearanceProvider raw={JSON.stringify(config)}><NativeName online detail={detail}>name</NativeName></AppearanceProvider>);
  const node=view.getByText("name"),before=node.style.getPropertyValue("--nz-name-light-color"),nightBefore=node.style.color;
  tick(5000);
  const after=node.style.getPropertyValue("--nz-name-light-color");
  expect(after).not.toBe(before);expect(after).toMatch(/^hsl\(\d+,72%,28%\)$/);
  expect(node.style.color).not.toBe(nightBefore);
  const hue=after.match(/\d+/)![0],reference=document.createElement("span");reference.style.color="hsl("+hue+",80%,60%)";
  expect(node.style.color).toBe(reference.style.color);
  config.features.nameColor.enabled=false;
  view.rerender(<AppearanceProvider raw={JSON.stringify(config)}><NativeName online detail={detail}>name</NativeName></AppearanceProvider>);
  expect(node.style.getPropertyValue("--nz-name-light-color")).toBe("");expect(node.style.color).toBe("");
 });
 it("retains offline red pulsing with stronger light-theme contrast",()=>{
  const config=defaults();config.enabled=true;
  const view=render(<AppearanceProvider raw={JSON.stringify(config)}><NativeName online={false}>offline</NativeName></AppearanceProvider>);
  const node=view.getByText("offline"),before=node.style.getPropertyValue("--nz-name-light-color");
  tick(100);expect(node.style.getPropertyValue("--nz-name-light-color")).not.toBe(before);
  expect(node.style.getPropertyValue("--nz-name-light-color")).toMatch(/^rgba\(153,27,27,0\.\d+\)$/);
  expect(node.style.color).toBe("rgba(255, 0, 0, 0.42)");
 });
 it("uses the live color variable only in the light theme",()=>{
  expect(lightCSS).toContain("html:not(.dark) :is(.nz-name-online,.nz-name-offline) {color:var(--nz-name-light-color)!important}");
  expect(lightCSS).not.toContain("color:#064e3b!important");
 });
});
