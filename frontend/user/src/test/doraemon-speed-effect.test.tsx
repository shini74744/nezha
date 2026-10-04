import { act } from "@testing-library/react";
import { describe,it,expect,vi } from "vitest";
import { speedEffect } from "@/appearance/speed-effect";
import { AppearanceProvider } from "@/appearance/context";
import { defaults } from "@/appearance/config";
import { StatusProvider } from "@/context/status-provider";
import { createServer } from "@/test/fixtures";
import { renderWithProviders } from "@/test/utils";
import { DoraemonCard } from "@/themes/doraemon/Card";
import { DoraemonOverview } from "@/themes/doraemon/Overview";
import { DoraemonAppearanceProvider } from "@/themes/doraemon/Appearance";
import { doraemonDefaults } from "../../../shared/doraemon-appearance";
import effectCSS from "@/themes/doraemon/rate-effects.css?raw";

describe("shared speed effect levels",()=>{
 it.each([
  [0,0,0],[1,0,1],[10485760,0,1],[10485761,1,1],
  [20971520,1,1],[20971521,2,2],[31457280,2,2],[31457281,3,2],
  [41943040,3,2],[41943041,3,3],[62914560,3,3],[62914561,3,4],
  [104857600,3,4],[104857601,3,5],[237500000,3,5],
 ])("matches default thresholds at %s bytes/s",(bytes,card,overview)=>{
  expect(speedEffect(bytes,"up").level).toBe(card);
  expect(speedEffect(bytes,"down",true).level).toBe(overview);
  expect(speedEffect(bytes,"up").className).toBe("nz-upload-boost-"+card);
  expect(speedEffect(bytes,"down",true).className).toBe("nz-overview-speed-"+overview+"-dl");
 });
 it.each([-1,NaN,Infinity])("keeps invalid rate %s inactive",bytes=>{
  expect(speedEffect(bytes,"up").level).toBe(0);
  expect(speedEffect(bytes,"down",true).level).toBe(0);
 });
});

const now=Date.parse("2025-01-01T00:00:20.000Z");
function content(bytes=237500000){
 const s=createServer({id:42,last_active:new Date(now).toISOString()});
 s.state.net_out_speed=bytes;s.state.net_in_speed=bytes;
 return <StatusProvider><DoraemonOverview total={1} online={1} offline={0} up={1024**4} down={2*1024**4} upSpeed={bytes} downSpeed={bytes}/><DoraemonCard now={now} serverInfo={s}/></StatusProvider>;
}
function tree(color=true,animation=true,master=true,ready=true,bytes=237500000){
 const c=doraemonDefaults();c.enabled=master;c.features.speedColor.enabled=color;c.features.speedAnimation.enabled=animation;
 const old=defaults();old.enabled=false;
 return <AppearanceProvider raw={JSON.stringify(old)}><DoraemonAppearanceProvider raw={JSON.stringify(c)} ready={ready}>{content(bytes)}</DoraemonAppearanceProvider></AppearanceProvider>;
}
describe("Doraemon speed animation integration",()=>{
 it("adds overview and both card directions without changing units or totals",()=>{
  const v=renderWithProviders(tree());
  const rates=[...v.container.querySelectorAll("[data-dora-rate-effect]")];
  expect(rates.map(e=>e.getAttribute("data-dora-rate-level"))).toEqual(["5","5","3","3"]);
  expect(rates.map(e=>e.getAttribute("data-dora-rate-effect"))).toEqual(["up","down","up","down"]);
  expect(rates[0]).toHaveClass("dora-stat-rate","nz-overview-speed-5");
  expect(rates[1]).toHaveClass("nz-overview-speed-5-dl");
  expect(rates[2]).toHaveClass("nz-upload-boost-3");
  expect(rates[3]).toHaveClass("nz-download-boost-3");
  for(const e of rates)expect(e).toHaveTextContent("1.90 Gbps");
  expect(rates[0].querySelector(".dora-rate-unit")).toHaveTextContent("Gbps");
  expect(v.container.querySelector(".dora-total-traffic [data-dora-rate-effect]")).toBeNull();
  expect(v.container.querySelector(".dora-transfer small")).not.toHaveAttribute("data-dora-rate-effect");
 });
 it.each([[true,true],[true,false],[false,true],[false,false]])("keeps color=%s independent from animation=%s",(color,animation)=>{
  const v=renderWithProviders(tree(color,animation));
  expect(v.container.querySelectorAll("[data-dora-rate-color]")).toHaveLength(color?4:0);
  expect(v.container.querySelectorAll("[data-dora-rate-effect]")).toHaveLength(animation?4:0);
 });
 it("removes stale effects as rates fall and while disabled or waiting for settings",()=>{
  const v=renderWithProviders(tree());
  expect(v.container.querySelectorAll("[data-dora-rate-effect]")).toHaveLength(4);
  v.rerender(tree(true,true,true,true,1000));
  expect(v.container.querySelector("[data-dora-rate-effect]")).toBeNull();
  v.rerender(tree(true,true,false));expect(v.container.querySelector("[data-dora-rate-effect]")).toBeNull();
  v.rerender(tree(true,true,true,false));expect(v.container.querySelector("[data-dora-rate-effect]")).toBeNull();
 });
 it("pauses overview and card effects when the page is hidden",()=>{
  const visible=vi.spyOn(document,"visibilityState","get").mockReturnValue("visible");
  const v=renderWithProviders(tree());
  const widgets=v.container.querySelectorAll(".dora-overview,.dora-card");
  for(const e of widgets)expect(e).toHaveAttribute("data-dora-motion","running");
  visible.mockReturnValue("hidden");
  act(()=>document.dispatchEvent(new Event("visibilitychange")));
  for(const e of widgets)expect(e).toHaveAttribute("data-dora-motion","paused");
  visible.mockRestore();
 });
 it("scopes reduced motion and non-expanding geometry to Doraemon",()=>{
  expect(effectCSS).toContain("@media (prefers-reduced-motion:reduce)");
  expect(effectCSS).toContain('.dora-theme [data-dora-rate-effect][data-dora-rate-level]');
  for(const rule of ["animation:none !important","transform:none !important","padding:0 !important","border:0 !important","animation-play-state:paused !important"])expect(effectCSS).toContain(rule);
  expect(effectCSS).toContain('--dora-effect-rgb:0,120,255');
 });
});
