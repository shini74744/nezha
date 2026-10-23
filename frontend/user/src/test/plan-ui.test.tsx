import {render,screen,fireEvent} from "@testing-library/react";
import {describe,it,expect,vi} from "vitest";
import PlanInfo from "@/components/PlanInfo";
import ServerLinkTags from "@/components/ServerLinkTags";
import BillingInfo from "@/components/billingInfo";
import SnapshotTimeline from "@/components/SnapshotTimeline";
import {parsePublicNote} from "@/lib/utils";
describe("plan UI compatibility",()=>{
 it("renders matching safe extra colors and preserves normal tags",()=>{
  const parsed=parsePublicNote(JSON.stringify({planDataMod:{bandwidth:"500Mbps",extra:"1,2,3,4,5",extraColors:["#ffffff","url(x)"],linkTags:[{name:"Site",url:"example.com",color:"#111827"}]}}))!;
  render(<><PlanInfo parsedData={parsed}/><ServerLinkTags tags={parsed.planDataMod?.linkTags}/></>);
  expect(screen.getByText("1").closest("[data-extra-note]")).toHaveStyle({backgroundColor:"#ffffff",color:"#000000"});
  expect(screen.getByText("2").closest("[data-extra-note]")).toHaveStyle({backgroundColor:"#0f766e"});
  expect(document.querySelectorAll("[data-extra-note]")).toHaveLength(5);
  expect(screen.getByText("500Mbps")).toHaveClass("bg-blue-600");
  expect(screen.getByRole("link")).toHaveStyle({backgroundColor:"#111827",color:"#ffffff"});
  expect(screen.getByRole("link")).toHaveAttribute("href","https://example.com/");
 });
 it("keeps original blue links when unset or invalid",()=>{
  render(<ServerLinkTags tags={[{name:"A",url:"example.com"},{name:"B",url:"example.com",color:"red;display:none"}]}/>);
  for(const link of screen.getAllByRole("link")){expect(link).toHaveClass("bg-sky-700");expect(link.style.backgroundColor).toBe("")}
 });
 it("keeps estimated value only in the price hover title without adding a card row",()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-16T00:00:00+08:00"));
  const base={startDate:"2026-10-01",endDate:"2026-11-01",amount:"31USD",cycle:"Month",autoRenewal:"0"};
  const {rerender}=render(<BillingInfo parsedData={{billingDataMod:base}}/>);
  expect(document.querySelector("[data-billing-price]")).toHaveAttribute("title",expect.stringContaining("16.00 USD"));
  expect(document.querySelector("[data-billing-price]")).toHaveTextContent("31USD");
  expect(document.querySelector("[data-billing-value]")).toBeNull();
  expect(screen.queryByText(/16.00 USD/)).toBeNull();
  for(const amount of ["","0","-1"]){rerender(<BillingInfo parsedData={{billingDataMod:{...base,amount}}}/>);expect(document.querySelector("[data-billing-value]")).toBeNull();expect(document.querySelector("[data-billing-price]")?.getAttribute("title")||"").not.toContain("16.00 USD")}
  vi.useRealTimers();
 });
});
describe("snapshot timeline wheel handling",()=>{
 it("scrolls horizontally only while possible, preserves zoom and releases page at edges",()=>{
  render(<SnapshotTimeline inlineControls><button>Latest</button><button>Old</button></SnapshotTimeline>);
  const nav=screen.getByRole("navigation");
  Object.defineProperties(nav,{clientWidth:{value:200,configurable:true},scrollWidth:{value:800,configurable:true}});
  const wheel=(deltaY:number,extra={})=>{const event=new WheelEvent("wheel",{deltaY,cancelable:true,bubbles:true,...extra});fireEvent(nav,event);return event};
  expect(wheel(120).defaultPrevented).toBe(true);expect(nav.scrollLeft).toBe(120);
  expect(wheel(-120).defaultPrevented).toBe(true);expect(nav.scrollLeft).toBe(0);
  expect(wheel(-120).defaultPrevented).toBe(false);
  expect(wheel(120,{ctrlKey:true}).defaultPrevented).toBe(false);
  expect(wheel(20,{deltaX:100}).defaultPrevented).toBe(false);
  nav.scrollLeft=600;expect(wheel(120).defaultPrevented).toBe(false);
 });
 it("does not intercept a non-overflowing single snapshot",()=>{
  render(<SnapshotTimeline><button>Only</button></SnapshotTimeline>);
  const event=new WheelEvent("wheel",{deltaY:120,cancelable:true,bubbles:true});fireEvent(screen.getByRole("navigation"),event);
  expect(event.defaultPrevented).toBe(false);expect(screen.queryByRole("button",{name:"较早快照"})).toBeNull();
 });
});
