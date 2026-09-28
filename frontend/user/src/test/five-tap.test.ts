import {describe,it,expect} from "vitest";
import {createFiveTapGate} from "@/lib/five-tap";
describe("five tap display gate",()=>{
 it("only triggers on five clicks and resets for the next five",()=>{
  const tap=createFiveTapGate();
  expect([0,100,200,300,400,500,600,700,800,900].map(tap)).toEqual([false,false,false,false,true,false,false,false,false,true]);
 });
 it("resets after a long pause or a slow sequence",()=>{
  const tap=createFiveTapGate();
  expect([0,100,200,300,2000].map(tap)).toEqual([false,false,false,false,false]);
  expect([2100,2200,2300,2400].map(tap)).toEqual([false,false,false,true]);
  const slow=createFiveTapGate();
  expect([0,1400,2800,4200,5600].map(slow)).toEqual([false,false,false,false,false]);
 });
});
