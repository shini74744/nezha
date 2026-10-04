import {fireEvent,render,screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {describe,it,expect,vi} from "vitest";
import {normalizeDoraemon,doraemonDefaults,doraemonDefinitions,validateDoraemon} from "../../../shared/doraemon-appearance";
import {DoraemonAppearanceProvider} from "@/themes/doraemon/Appearance";
import {FriendsBanner,FriendsInteraction} from "@/themes/doraemon/Friends";
import {CardGadget,GadgetBackToTop,PocketGadgets,gadgets,gadgetForServer} from "@/themes/doraemon/Gadgets";
import {DoraemonLoading} from "@/themes/doraemon/Scene";
const widgets=<><FriendsBanner/><FriendsInteraction/><CardGadget serverId={7}/><PocketGadgets/><GadgetBackToTop/><DoraemonLoading/></>;
const tree=(raw?:string,ready=true)=><DoraemonAppearanceProvider raw={raw} ready={ready}>{widgets}</DoraemonAppearanceProvider>;
describe("Doraemon friends and gadgets",()=>{
 it("upgrades legacy traffic documents without re-enabling disabled traffic or master",()=>{
  const legacy={version:1,enabled:true,features:{traffic:{enabled:false,toggleInterval:8000}}};
  const parsed=normalizeDoraemon(JSON.stringify(legacy));
  expect(parsed.features.traffic).toEqual(legacy.features.traffic);
  for(const d of doraemonDefinitions.slice(1))expect(parsed.features[d.key].enabled).toBe(true);
  expect(normalizeDoraemon(JSON.stringify({...legacy,enabled:false})).enabled).toBe(false);
  const off=doraemonDefaults();off.features.cardGadgets.enabled=false;
  expect(normalizeDoraemon(JSON.stringify(off)).features.cardGadgets.enabled).toBe(false);
 });
 it("rejects malformed or foreign scope fields",()=>{
  for(const raw of ["null","[]","{}","{",JSON.stringify({...doraemonDefaults(),version:2}),JSON.stringify({...doraemonDefaults(),features:{...doraemonDefaults().features,dark:{enabled:true}}})]){
   expect(normalizeDoraemon(raw).enabled).toBe(false);
  }
  const c=doraemonDefaults();c.features.friendsBanner={enabled:true,count:3};
  expect(validateDoraemon(c)).not.toBe("");
 });
 it("does not flash enhancements while pending or with the master off",()=>{
  const v=render(tree(undefined,false));
  const assertOff=()=>{expect(screen.queryByRole("region",{name:"五位伙伴同框"})).toBeNull();expect(screen.queryByRole("region",{name:"伙伴休息站"})).toBeNull();expect(v.container.querySelector(".dora-card-gadget")).toBeNull();expect(v.container.querySelector(".dora-loading-portal")).toBeNull();expect(screen.queryByRole("button",{name:/回到顶部/})).toBeNull()};
  assertOff();
  v.rerender(tree(JSON.stringify({...doraemonDefaults(),enabled:false})));assertOff();
  v.rerender(tree());expect(v.container.querySelectorAll(".dora-friends-portraits figure")).toHaveLength(5);
  expect(v.container.querySelectorAll(".dora-friends-buttons button")).toHaveLength(5);
 });
 it.each(doraemonDefinitions.slice(1).map(d=>d.key))("can disable %s independently",key=>{
  vi.stubGlobal("scrollY",400);
  const c=doraemonDefaults();c.features[key].enabled=false;
  const v=render(tree(JSON.stringify(c)));
  const selectors={friendsBanner:".dora-friends-banner",friendsInteraction:".dora-friends-interaction",gadgetDecorations:".dora-loading-portal",backToTop:".dora-return-top",cardGadgets:".dora-card-gadget"};
  for(const [feature,selector]of Object.entries(selectors))expect(!!v.container.querySelector(selector)).toBe(feature!==key);
 });
 it("supports keyboard and touch without automatic message changes",async()=>{
  render(tree());const user=userEvent.setup();
  const gian=screen.getByRole("button",{name:"和胖虎打招呼"});
  gian.focus();await user.keyboard("{Enter}");
  expect(gian).toHaveAttribute("aria-pressed","true");expect(screen.getByText(/有伙伴在/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"和静香打招呼"}));
  expect(gian).toHaveAttribute("aria-pressed","false");expect(screen.getByText(/照顾好自己/)).toBeInTheDocument();
 });
 it.each([true,false])("returns focus to the top and uses reduced motion=%s",reduced=>{
  const target=document.createElement("header");target.id="dora-page-top";target.tabIndex=-1;document.body.append(target);
  vi.stubGlobal("scrollY",400);
  vi.stubGlobal("scrollTo",vi.fn());
  vi.stubGlobal("matchMedia",vi.fn(()=>({matches:reduced})));
  render(tree());fireEvent.click(screen.getByRole("button",{name:/回到顶部/}));
  expect(document.activeElement).toBe(target);
  expect(window.scrollTo).toHaveBeenCalledWith({top:0,behavior:reduced?"auto":"smooth"});target.remove();
 });
 it("only shows after scrolling beyond 300 and hides again near the top",()=>{
  vi.stubGlobal("scrollY",0);
  render(tree());
  expect(screen.queryByRole("button",{name:/回到顶部/})).toBeNull();
  for(const [y,visible] of [[300,false],[301,true],[1200,true],[0,false]] as const){
   vi.stubGlobal("scrollY",y);fireEvent.scroll(window);
   expect(!!screen.queryByRole("button",{name:/回到顶部/})).toBe(visible);
  }
  expect(document.querySelector(".dora-return-row")).toBeNull();
 });
 it("removes the scroll listener when the feature is disabled or unmounted",()=>{
  vi.stubGlobal("scrollY",600);
  const add=vi.spyOn(window,"addEventListener"),remove=vi.spyOn(window,"removeEventListener");
  const v=render(tree());
  const listener=add.mock.calls.find(c=>c[0]==="scroll")?.[1];
  expect(listener).toBeTruthy();
  expect(screen.getByRole("button",{name:/回到顶部/})).toBeInTheDocument();
  const config=doraemonDefaults();config.features.backToTop.enabled=false;
  v.rerender(tree(JSON.stringify(config)));
  expect(remove).toHaveBeenCalledWith("scroll",listener);
  expect(screen.queryByRole("button",{name:/回到顶部/})).toBeNull();
  v.rerender(tree());v.unmount();
  expect(remove.mock.calls.filter(c=>c[0]==="scroll")).toHaveLength(2);
  add.mockRestore();remove.mockRestore();
 });
 it("assigns all 16 gadgets predictably by ID, independent of order",()=>{
  const ids=Array.from({length:16},(_,i)=>i+1),byId=new Map(ids.map(id=>[id,gadgetForServer(id)]));
  expect(new Set(byId.values()).size).toBe(16);
  for(const id of [...ids].reverse())expect(gadgetForServer(id)).toBe(byId.get(id));
  expect(gadgets).toContain(gadgetForServer(Number.MAX_SAFE_INTEGER));
  for(const id of [NaN,Infinity,-5,0,7])expect(gadgets).toContain(gadgetForServer(id));
  const v=render(tree());expect(v.container.querySelector(".dora-card-gadget svg")).toBeTruthy();
  expect(v.container.querySelector(".dora-card-gadget")).not.toHaveTextContent("🔔");
 });
});
