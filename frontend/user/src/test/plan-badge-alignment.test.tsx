import {render,screen,fireEvent} from "@testing-library/react";
import {describe,it,expect} from "vitest";
import PlanInfo from "@/components/PlanInfo";
import {parsePublicNote} from "@/lib/utils";
describe("independent plan badge alignment",()=>{
 it("gives every label its own box and keeps icons as sibling boxes",()=>{
  const parsed=parsePublicNote(JSON.stringify({planDataMod:{bandwidth:"2000Mbps",trafficVol:"2TB/月",IPv4:"1",IPv6:"1",networkRoutes:{telecom:"163PP/CN2",mobile:"CMI/CMIN2",unicom:"10099/9929",other:"IX"},extra:"三网顶级优化",networkRouteEntries:[{carrier:"ntt",text:"台湾Hinet动态住宅家宽"}]}}))!;
  const {container}=render(<PlanInfo parsedData={parsed}/>);
  for(const badge of container.querySelectorAll("[data-plan-info] > p")){
   expect(badge).toHaveClass("min-h-[18px]","py-[1.5px]");
   const text=badge.querySelector<HTMLElement>("[data-plan-badge-text]")!;
   expect(text.parentElement).toBe(badge);
   expect(text.querySelector("img,svg")).toBeNull();
   for(const graphic of badge.querySelectorAll("img,svg")){
    const slot=graphic.closest("[data-plan-badge-icon]")!;
    expect(slot.parentElement).toBe(badge);
    expect(slot).not.toContainElement(text);
   }
  }
  expect(screen.getByText("三网顶级优化").closest("p")!.querySelector("[data-plan-badge-icon]")).toBeNull();
 });
 it("preserves the label and leaves an empty icon slot when a custom logo fails",()=>{
  const parsed=parsePublicNote(JSON.stringify({planDataMod:{networkRouteEntries:[{carrier:"custom",text:"保留文字",logo:"/api/v1/logo/assets/"+"a".repeat(64)+".png"}]}}))!;
  const {container}=render(<PlanInfo parsedData={parsed}/>);
  fireEvent.error(container.querySelector("img")!);
  expect(screen.getByText("保留文字")).toHaveAttribute("data-plan-badge-text");
  expect(container.querySelector("[data-plan-badge-icon]")).toBeEmptyDOMElement();
 });
});
