import {describe,it,expect} from "vitest";
import {render,screen} from "@testing-library/react";
import {defaults} from "@/appearance/config";
import {AppearanceProvider} from "@/appearance/context";
import {NativeSpeed} from "@/appearance/widgets";
import lightStyles from "@/appearance/light-readability.css?raw";
function pair(overrides:Record<string,boolean>={},master=true){
 const c=defaults();c.enabled=master;Object.assign(c.features.speed,overrides);
 return render(<AppearanceProvider raw={JSON.stringify(c)}>
  <div data-testid="card"><NativeSpeed bytes={32*1048576} direction="up" fallback="original card"/></div>
  <div data-testid="overview"><NativeSpeed overview bytes={120*1048576} direction="down"/></div>
 </AppearanceProvider>);
}
describe("independent speed widgets",()=>{
 it("light readability styles preserve speed effects and only adjust text color",()=>{
  const rules=lightStyles.split("}").filter(rule=>rule.includes("[data-native-speed"));
  expect(rules).toHaveLength(2);
  for(const rule of rules){
   expect(rule).toContain("html:not(.dark)");
   expect(rule.split("{")[1]).toMatch(/^color:[^;{}]+;?$/);
  }
 });
 it("uses separate units, colors and animations for each location",()=>{
  pair({bits:false,color:false,animation:false});
  expect(screen.getByTestId("card")).toHaveTextContent("original card");
  const overview=screen.getByTestId("overview").querySelector("span")!;
  expect(screen.getByTestId("card").querySelector("[data-native-speed]")).toBeNull();
  expect(overview.textContent).toBe("960Mbps");expect(overview.style.color).not.toBe("");
  expect(overview.className).toContain("nz-overview-speed-5-dl");
 });
 it("can turn off all overview options without changing card settings",()=>{
  pair({overviewBits:false,overviewColor:false,overviewAnimation:false});
  const card=screen.getByTestId("card").querySelector("span")!,overview=screen.getByTestId("overview");
  expect(card.textContent).toBe("256Mbps");expect(card.style.color).not.toBe("");expect(card.className).toContain("nz-upload-boost-3");
  expect(overview.textContent).toBe("120.00 MiB/s");expect(overview.style.color).toBe("");expect(overview.className).toBe("");
 });
 it("can disable only the single-server card",()=>{
  pair({cardEnabled:false});
  expect(screen.getByTestId("card")).toHaveTextContent("original card");
  expect(screen.getByTestId("card").querySelector("[data-native-speed]")).toBeNull();
  expect(screen.getByTestId("overview").querySelector("[data-native-speed]")).not.toBeNull();
 });
 it("can disable only the network overview",()=>{
  pair({overviewEnabled:false});
  expect(screen.getByTestId("overview")).toHaveTextContent("120.00 MiB/s");
  expect(screen.getByTestId("overview").querySelector("[data-native-speed]")).toBeNull();
  expect(screen.getByTestId("card").querySelector("[data-native-speed]")).not.toBeNull();
 });
 it.each([false,true])("parent and global switches override both children (global %s)",global=>{
  const view=pair({enabled:!global},global);
  expect(view.container.querySelector("[data-native-speed]")).toBeNull();
 });
});
