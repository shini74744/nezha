import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { speedColor } from "@/appearance/speed-color";
import { defaults } from "@/appearance/config";
import { AppearanceProvider } from "@/appearance/context";
import { NativeSpeed } from "@/appearance/widgets";
import { StatusProvider } from "@/context/status-provider";
import { createServer } from "@/test/fixtures";
import { renderWithProviders } from "@/test/utils";
import { DoraemonCard } from "@/themes/doraemon/Card";
import { DoraemonOverview } from "@/themes/doraemon/Overview";
import { DoraemonAppearanceProvider } from "@/themes/doraemon/Appearance";
import { doraemonDefaults } from "../../../shared/doraemon-appearance";

describe("shared network rate colors", () => {
 it.each([0,125_000,1_000_000,10_485_760,31_457_280,104_857_600,237_500_000])("preserves existing rate curves for %s bytes/s",bytes=>{
  for(const overview of [false,true]){
   const strength=overview?Math.min(Math.pow(bytes/104857600,.4),1):Math.min(Math.log10(bytes+1)/Math.log10(31457281),1);
   const p=Math.round((1-strength)*(overview?200:255));
   expect(speedColor(bytes,"up",overview)).toBe("rgb(255,"+p+","+p+")");
   expect(speedColor(bytes,"down",overview)).toBe("rgb("+p+","+p+",255)");
  }
 });
 it.each([-1,NaN,Infinity])("bounds invalid input %s",bytes=>{
  expect(speedColor(bytes,"up")).toBe(speedColor(0,"up"));
  expect(speedColor(bytes,"down",true)).toBe(speedColor(0,"down",true));
 });
 it("default widgets consume the same color without changing their animations",()=>{
  const c=defaults();c.enabled=true;
  const v=render(<AppearanceProvider raw={JSON.stringify(c)}><NativeSpeed bytes={32*1048576} direction="up"/></AppearanceProvider>);
  const e=v.container.querySelector("[data-native-speed]")!;
  expect(e).toHaveStyle({color:speedColor(32*1048576,"up")});
  expect(e.className).toContain("nz-upload-boost-3");
 });
});

const now=Date.parse("2025-01-01T00:00:20.000Z");
const server=createServer({id:42,last_active:new Date(now).toISOString()});
server.state.net_out_speed=1_000_000;
server.state.net_in_speed=187_500_000;
const views=<StatusProvider><DoraemonOverview total={1} online={1} offline={0} up={1024**4} down={2*1024**4} upSpeed={237_500_000} downSpeed={125_000_000}/><DoraemonCard now={now} serverInfo={server}/></StatusProvider>;
function tree(raw?:string,ready=true){
 const original=defaults();original.enabled=false;
 return <AppearanceProvider raw={JSON.stringify(original)}><DoraemonAppearanceProvider raw={raw} ready={ready}>{views}</DoraemonAppearanceProvider></AppearanceProvider>;
}
describe("Doraemon scoped rate colors",()=>{
 it("colors both overview and card rates while preserving SI units and totals",()=>{
  const v=renderWithProviders(tree());
  const rates=[...v.container.querySelectorAll<HTMLElement>("[data-dora-rate-color]")];
  expect(rates).toHaveLength(4);
  expect(rates.map(e=>e.dataset.doraRateColor)).toEqual(["up","down","up","down"]);
  expect(rates.map(e=>e.style.getPropertyValue("--dora-rate-color"))).toEqual([
   speedColor(237_500_000,"up",true),speedColor(125_000_000,"down",true),
   speedColor(1_000_000,"up"),speedColor(187_500_000,"down"),
  ]);
  expect(rates[0]).toHaveTextContent("1.90 Gbps");
  expect(rates[0].querySelector(".dora-rate-unit")).toHaveTextContent("Gbps");
  expect(rates[2]).toHaveTextContent("8.0 Mbps");
  expect(rates[3]).toHaveTextContent("1.50 Gbps");
  expect(screen.getByLabelText("累计流量").querySelector("[data-dora-rate-color]")).toBeNull();
  expect(v.container.querySelector(".dora-transfer small")?.hasAttribute("data-dora-rate-color")).toBe(false);
 });
 it("updates each direction from live bytes rather than the displayed unit",()=>{
  const updated=structuredClone(server);updated.state.net_out_speed=125_000_000;
  const v=renderWithProviders(<DoraemonCard now={now} serverInfo={server}/>);
  const old=v.container.querySelector<HTMLElement>('[data-dora-rate-color="up"]')!.style.getPropertyValue("--dora-rate-color");
  v.rerender(<DoraemonCard now={now} serverInfo={updated}/>);
  const next=v.container.querySelector<HTMLElement>('[data-dora-rate-color="up"]')!;
  expect(next.style.getPropertyValue("--dora-rate-color")).not.toBe(old);
  expect(next.style.getPropertyValue("--dora-rate-color")).toBe(speedColor(125_000_000,"up"));
  expect(next).toHaveTextContent("1.00 Gbps");
 });
 it("honors pending, its own switch and master without changing rate content",()=>{
  const v=renderWithProviders(tree(undefined,false));
  expect(v.container.querySelector("[data-dora-rate-color]")).toBeNull();
  v.rerender(tree());expect(v.container.querySelectorAll("[data-dora-rate-color]")).toHaveLength(4);
  const c=doraemonDefaults();c.features.speedColor.enabled=false;
  v.rerender(tree(JSON.stringify(c)));expect(v.container.querySelector("[data-dora-rate-color]")).toBeNull();
  expect(screen.getByText("8.0 Mbps")).toBeInTheDocument();
  c.features.speedColor.enabled=true;c.enabled=false;
  v.rerender(tree(JSON.stringify(c)));expect(v.container.querySelector("[data-dora-rate-color]")).toBeNull();
 });
});
