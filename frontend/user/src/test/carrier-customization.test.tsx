import {render,screen} from "@testing-library/react";
import {describe,it,expect} from "vitest";
import PlanInfo from "@/components/PlanInfo";
import {parsePublicNote} from "@/lib/utils";
describe("custom carrier colors",()=>{
 it.each([true,false])("preserves custom colors, billing=%s",(billing)=>{
  const parsed=parsePublicNote(JSON.stringify({...(billing?{billingDataMod:{}}:{}),planDataMod:{
   networkRoutes:{telecom:"CN2",other:"legacy"},networkRouteColors:{telecom:"#ffffff",other:"#112233"},
   networkRouteEntries:[{carrier:"custom",text:"global"},{carrier:"custom",text:"override",color:"#ffee00"},
    {carrier:"custom",text:"unsafe",color:"url(evil)"}]}}))!;
  render(<PlanInfo parsedData={parsed}/>);
  expect(screen.getByText("CN2").closest("[data-carrier]")).toHaveStyle({backgroundColor:"#ffffff",color:"#000000"});
  expect(screen.getByText("global").closest("[data-other-carrier]")).toHaveStyle({backgroundColor:"#112233"});
  expect(screen.getByText("override").closest("[data-other-carrier]")).toHaveStyle({backgroundColor:"#ffee00",color:"#000000"});
  expect(screen.getByText("unsafe").closest("[data-other-carrier]")).toHaveStyle({backgroundColor:"#112233"});
 });
});
