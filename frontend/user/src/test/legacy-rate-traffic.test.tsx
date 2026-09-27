import {describe,it,expect,vi,afterEach} from "vitest";
import {render,act,cleanup} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {AppearanceProvider} from "@/appearance/context";
import {defaults} from "@/appearance/config";
import {NativeTraffic,formatTraffic,trafficColor} from "@/appearance/traffic";
import {NativeSpeed} from "@/appearance/widgets";
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
function setup(enabled=true,id=7){
 const c=defaults();c.enabled=enabled;c.features.traffic.toggleInterval=5000;
 const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});
 client.setQueryData(["plan-traffic"],Object.fromEntries([7,8].map(id=>[id,{name:"quota",max:1024**4,from:"2026-09-01",to:"2026-10-01",direction:"2",used:id===7?1007.11*1024**3:2*1024**4}])));
 const view=render(<QueryClientProvider client={client}><AppearanceProvider raw={JSON.stringify(c)}><NativeTraffic serverId={id}/></AppearanceProvider></QueryClientProvider>);
 return {...view,client};
}
describe("legacy traffic parity",()=>{
 it("uses the original binary conversion and legacy unit labels",()=>{
  expect(formatTraffic(0)).toEqual({value:"0",unit:"B"});
  expect(formatTraffic(1007.11*1024**3)).toEqual({value:"1007.11",unit:"GB"});
  expect(formatTraffic(1024**4)).toEqual({value:"1.00",unit:"TB"});
  expect(trafficColor(0)).toBe("hsl(120, 65%, 40%)");
  expect(trafficColor(50)).toBe("hsl(60, 65%, 40%)");
  expect(trafficColor(150)).toBe("hsl(0, 65%, 40%)");
 });
 it("keeps quota white and starts with the zero-padded date",()=>{
  const v=setup();const values=v.container.querySelector(".nz-traffic-values")!;
  expect(values.children[0].textContent).toBe("1007.11");
  expect(values.children[1].textContent).toBe("GB");
  expect((values.children[0] as HTMLElement).style.color).not.toBe("");
  expect((values.children[3] as HTMLElement).style.color).toBe("");
  expect(v.container.querySelector(".nz-traffic-info")?.textContent).toBe("2026/09/01 - 2026/10/01");
  v.unmount();v.client.clear();
 });
 it("fades out for 250ms then cycles date, caption, percentage every 5 seconds",()=>{
  vi.useFakeTimers();const v=setup();const info=v.container.querySelector(".nz-traffic-info") as HTMLElement;
  act(()=>vi.advanceTimersByTime(5000));expect(info.style.opacity).toBe("0");
  expect(info.textContent).toContain("2026/09/01");
  act(()=>vi.advanceTimersByTime(250));expect(info.textContent).toBe("本月流量统计");expect(info.style.opacity).toBe("1");
  act(()=>vi.advanceTimersByTime(5000));expect(info.textContent).toBe("98.35%");
  act(()=>vi.advanceTimersByTime(5000));expect(info.textContent).toContain("2026/09/01");
  v.unmount();v.client.clear();
 });
 it("caps only the bar at 100%, and does not show data belonging to another ID",()=>{
  const v=setup(true,8);expect(v.getByRole("progressbar")).toHaveAttribute("aria-valuenow","100");
  expect(v.container.querySelector(".nz-traffic-used")).toHaveTextContent("2.00");
  v.unmount();v.client.clear();const missing=setup(true,9);expect(missing.container).toBeEmptyDOMElement();missing.unmount();missing.client.clear();
 });
 it("renders nothing when the global feature is disabled",()=>{
  const v=setup(false);expect(v.container).toBeEmptyDOMElement();v.unmount();v.client.clear();
 });
});
describe("legacy speed wrapper parity",()=>{
 it.each([0,1,20,20.1,40,40.1,60,60.1,100,100.1])("keeps original overview thresholds at %s MiB/s",mb=>{
  const c=defaults();c.enabled=true;
  const v=render(<AppearanceProvider raw={JSON.stringify(c)}><NativeSpeed overview direction="up" bytes={mb*1048576} icon={<svg data-testid="arrow"/>}/></AppearanceProvider>);
  const span=v.container.querySelector("[data-native-speed]")!;
  const level=mb>100?5:mb>60?4:mb>40?3:mb>20?2:mb>0?1:0;
  expect(span.querySelector("svg")).not.toBeNull();
  if(level)expect(span.className).toContain("nz-overview-speed-"+level);
  else expect(span.className).not.toContain("nz-overview-speed-");
 });
 it("keeps the icon and native units when disabled",()=>{
  const c=defaults();c.enabled=true;c.features.speed.overviewEnabled=false;
  const v=render(<AppearanceProvider raw={JSON.stringify(c)}><NativeSpeed overview direction="up" bytes={1048576} icon={<svg/>}/></AppearanceProvider>);
  expect(v.container.querySelector("svg")).not.toBeNull();
  expect(v.container.querySelector("[data-native-speed]")).toBeNull();
  expect(v.container.textContent).toBe("1.00 MiB/s");
 });
});
