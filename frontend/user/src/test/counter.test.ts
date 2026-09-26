import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {counter} from "@/appearance/modules/counter";
import {FeatureScope} from "@/appearance/scope";
import {defaults} from "@/appearance/config";
let scope:FeatureScope,anchor:HTMLDivElement;
const box=(right=1000,width=240,height=60)=>({left:right-width,right,top:80,bottom:80+height,width,height,x:right-width,y:80,toJSON:()=>({})});
beforeEach(()=>{
 vi.useFakeTimers();vi.stubGlobal("innerWidth",1440);vi.stubGlobal("scrollY",0);
 scope=new FeatureScope("counter");
 anchor=document.createElement("div");anchor.dataset.counterDesktopAnchor="";document.body.append(anchor);
 vi.spyOn(anchor,"getBoundingClientRect").mockReturnValue(box());
});
afterEach(()=>{scope.dispose();anchor.remove();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers()});
const node=()=>document.querySelector(".footer-background") as HTMLElement;
const resize=async(width:number,scroll=0)=>{vi.stubGlobal("innerWidth",width);vi.stubGlobal("scrollY",scroll);window.dispatchEvent(new Event("resize"));await vi.advanceTimersByTimeAsync(20)};
describe("counter positioning",()=>{
 it.each([768,1024,1366,1920,2560,3840])("uses desktop viewport corner and ratio at %s",width=>{
  const w=240*width/1366;
  vi.stubGlobal("innerWidth",width);
  counter(scope,defaults().features.counter);
  expect(node().style.left).toBe("auto");expect(node().style.right).toBe("0px");
  expect(parseFloat(node().style.width)).toBeCloseTo(w);
  expect(parseFloat(node().style.width)/parseFloat(node().style.height)).toBeCloseTo(4);
  expect(node().style.top).toBe("0px");expect(node().style.backgroundPosition).toBe("right top");
 });
 it.each([320,390,767])("preserves mobile coordinates and size at %s",width=>{
  vi.stubGlobal("innerWidth",width);counter(scope,defaults().features.counter);
  expect(parseFloat(node().style.left)).toBe(width/2+15-85);expect(node().style.top).toBe("8px");
  expect(node().style.width).toBe("170px");expect(node().style.height).toBe("44px");
  expect(node().style.transform).toBe("none");expect(node().style.backgroundPosition).toBe("center center");
 });
 it("restores mobile styles after desktop and resets hidden mobile display on return",async()=>{
  counter(scope,defaults().features.counter);await resize(390,30);
  expect(node().style.display).toBe("none");await resize(1440,0);
  expect(node().style.display).toBe("block");expect(node().style.opacity).toBe("1");
  await resize(390,0);expect(node().style.transform).toBe("none");
  expect(node().style.opacity).toBe("1");expect(node().style.transition).toBe("none");
 });
 it("preserves desktop scroll hiding and configured relative offsets",async()=>{
  counter(scope,{...defaults().features.counter,desktopRight:12,desktopTop:4});
  expect(node().style.right).toBe("12px");expect(node().style.top).toBe("4px");
  await resize(1440,6);expect(node().style.transform).toBe("scale(0)");
  await resize(1440,0);expect(node().style.transform).toBe("scale(1)");
 });
 it("does not need a header anchor and cleans up on disable",async()=>{
  anchor.remove();counter(scope,defaults().features.counter);expect(node().style.display).toBe("block");
  document.body.append(anchor);await vi.advanceTimersByTimeAsync(40);
  expect(node().style.display).toBe("block");scope.dispose();expect(node()).toBeNull();
 });
});
it("scales custom reference dimensions continuously across large windows",async()=>{
 counter(scope,{...defaults().features.counter,desktopWidth:300,desktopHeight:90});
 for(const width of [1366,1920,2560,3840,5120,1920]){
  await resize(width);
  expect(parseFloat(node().style.width)).toBeCloseTo(300*width/1366);
  expect(parseFloat(node().style.height)).toBeCloseTo(90*width/1366);
  expect(node().style.right).toBe("0px");expect(node().style.top).toBe("0px");
 }
});