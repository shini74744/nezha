import {render,screen,fireEvent} from "@testing-library/react";
import {describe,it,expect} from "vitest";
import PlanInfo from "@/components/PlanInfo";
import {parsePublicNote} from "@/lib/utils";
describe("global carrier badges",()=>{
 it.each([false,true])("renders saved other carriers in order (billing=%s)",billing=>{
  const parsed=parsePublicNote(JSON.stringify({...(billing?{billingDataMod:{}}:{}),planDataMod:{networkRoutes:{telecom:"CN2"},
   networkRouteEntries:[{carrier:"ntt",text:"AS2914"},{carrier:"custom",name:"My ISP",country:"NZ",text:"私有线路",logo:"https://example.com/logo.png"},{carrier:"unknown",text:"未知线路"},{carrier:"ntt",text:""}]}}))!;
  const {container}=render(<PlanInfo parsedData={parsed}/>);
  const badges=container.querySelectorAll("[data-other-carrier]");
  expect(badges).toHaveLength(3);expect(badges[0]).toHaveTextContent("AS2914");
  expect(badges[0].querySelector("img")).toHaveAttribute("src",expect.stringContaining("data:image/"));
  expect(badges[1]).toHaveAttribute("title","My ISP");
  expect(badges[2].querySelector("img")).toBeNull();
  fireEvent.error(badges[1].querySelector("img")!);
  expect(screen.getByText("私有线路")).toBeInTheDocument();expect(badges[1].querySelector("img")).toBeNull();
 });
 it("does not load unsafe custom images or crash on malformed entries",()=>{
  const p=parsePublicNote(JSON.stringify({planDataMod:{networkRouteEntries:[null,{carrier:"custom",text:"安全文字",logo:"javascript:alert(1)"},{text:3}]}}))!;
  const {container}=render(<PlanInfo parsedData={p}/>);expect(container.querySelectorAll("img")).toHaveLength(0);
  expect(screen.getByText("安全文字")).toBeInTheDocument();
 });
});
