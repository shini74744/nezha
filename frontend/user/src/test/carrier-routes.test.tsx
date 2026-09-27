import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PlanInfo from "@/components/PlanInfo";
import { parsePublicNote } from "@/lib/utils";
import { readNetworkRoutes } from "@/lib/network-routes";

describe("carrier routes", () => {
 it.each([false,true])("preserves explicit carriers through parsing (billing=%s)", billing => {
  const parsed=parsePublicNote(JSON.stringify({
   ...(billing?{billingDataMod:{startDate:"2026-01-01"}}:{}),
   planDataMod:{networkRoute:"stale legacy route",networkRoutes:{unicom:"1111",other:"IX",mobile:"CMI/CMIN2",telecom:"CN2"}}
  }))!;
  const {container}=render(<PlanInfo parsedData={parsed}/>);
  expect(screen.getByText("CN2")).toHaveClass("bg-blue-600");
  expect(screen.getByText("CMI/CMIN2")).toHaveClass("bg-green-600");
  expect(screen.getByText("1111")).toHaveClass("bg-red-600");
  expect(screen.getByText("IX")).toHaveClass("bg-stone-600");
  expect([...container.querySelectorAll("[data-carrier]")].map(e=>e.getAttribute("data-carrier"))).toEqual(["telecom","mobile","unicom","other"]);
  expect(screen.queryByText("stale legacy route")).not.toBeInTheDocument();
 });
 it("classifies legacy routes without splitting compound route names",()=>{
  expect(readNetworkRoutes({networkRoute:"CMI/CMIN2，10099/9929;163PP/CN2｜custom"})).toEqual({telecom:"163PP/CN2",mobile:"CMI/CMIN2",unicom:"10099/9929",other:"custom"});
 });
 it("does not restore explicitly cleared routes from legacy fields",()=>{
  expect(readNetworkRoutes({networkRoute:"CN2,CMI",networkRoutes:{}})).toEqual({telecom:"",mobile:"",unicom:"",other:""});
 });
 it("keeps ambiguous routes gray and combines same-carrier routes",()=>{
  expect(readNetworkRoutes({networkRoute:"CN2,163PP,CMI/CN2,1111"})).toEqual({telecom:"CN2｜163PP",mobile:"",unicom:"",other:"CMI/CN2｜1111"});
 });
});

