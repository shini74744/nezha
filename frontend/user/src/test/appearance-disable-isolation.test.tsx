import {describe,it,expect,vi} from "vitest";
import {render} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {AppearanceProvider,useFeature} from "@/appearance/context";
import {defaults} from "@/appearance/config";
import {NativeName,NativeSpeed} from "@/appearance/widgets";
import {NativeBackground} from "@/appearance/background";
import {NativeFooterIP} from "@/appearance/footer-ip";
import Footer from "@/components/Footer";
import {WebSocketContext} from "@/context/websocket-context";
vi.mock("@/lib/nezha-api",()=>({fetchSetting:vi.fn(async()=>({data:{config:{},version:"test"}}))}));
const keys=Object.keys(defaults().features);
function State({name}:{name:string}){return <output data-feature={name}>{String(useFeature(name).enabled)}</output>}
describe("independent appearance switches",()=>{
 it.each(keys)("disabling %s does not change the other feature switches",name=>{
  const config=defaults();config.enabled=true;Object.values(config.features).forEach(f=>f.enabled=true);
  const tree=()=> <AppearanceProvider raw={JSON.stringify(config)}>{keys.map(key=><State key={key} name={key}/>)}</AppearanceProvider>;
  const view=render(tree());config.features[name].enabled=false;view.rerender(tree());
  for(const node of view.container.querySelectorAll("output"))expect(node.textContent).toBe(node.getAttribute("data-feature")===name?"false":"true");
  config.enabled=false;view.rerender(tree());
  for(const node of view.container.querySelectorAll("output"))expect(node.textContent).toBe("false");
 });
 it.each(["master","all","individual"])("removes mounted enhancements and restores default fallbacks: %s",mode=>{
  const config=defaults();config.enabled=true;Object.values(config.features).forEach(f=>f.enabled=false);
  for(const key of ["nameColor","background","footer","footerIP","speed"])config.features[key].enabled=true;
  Object.assign(config.features.background,{regionEnabled:false,scheduleRules:[],desktopMedia:[{type:"image",src:"https://example.test/bg.png"}],mobileMedia:[{type:"image",src:"https://example.test/bg.png"}]});
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const tree=()=> <QueryClientProvider client={client}><WebSocketContext.Provider value={{lastData:{now:1,servers:[]},connected:true,messageHistory:[],reconnect:()=>{},needReconnect:false,setNeedReconnect:()=>{}}}>
   <AppearanceProvider raw={JSON.stringify(config)}><NativeBackground/><NativeName online>name</NativeName><NativeSpeed bytes={1048576} direction="up" fallback="default speed"/><NativeFooterIP/><Footer/></AppearanceProvider>
  </WebSocketContext.Provider></QueryClientProvider>;
  const view=render(tree());
  expect(view.container.querySelector(".nz-media")).not.toBeNull();expect(view.container.querySelector(".nz-name-online")).not.toBeNull();
  expect(view.container.querySelector(".nz-footer-fit")).not.toBeNull();expect(view.container.querySelector("[data-native-footer-ip]")).not.toBeNull();
  if(mode==="master")config.enabled=false;
  else if(mode==="all")Object.values(config.features).forEach(f=>f.enabled=false);
  else {
   config.features.nameColor.enabled=false;view.rerender(tree());
   expect(view.container.querySelector(".nz-name-online")).toBeNull();expect(view.container.querySelector(".nz-media")).not.toBeNull();
   config.features.footerIP.enabled=false;view.rerender(tree());
   expect(view.container.querySelector("[data-native-footer-ip]")).toBeNull();expect(view.container.querySelector(".nz-footer-fit")).not.toBeNull();
   config.features.footer.enabled=false;view.rerender(tree());
   expect(view.container.querySelector(".server-footer")).not.toBeNull();expect(view.container.querySelector(".nz-media")).not.toBeNull();
   config.features.background.enabled=false;config.features.speed.enabled=false;
  }
  view.rerender(tree());
  expect(view.container.querySelector(".nz-media,[data-nz-background-cards],.nz-name-online,.nz-name-offline,.nz-footer-fit,[data-native-footer-ip],[data-native-speed]")).toBeNull();
  expect(view.getByText("name").getAttribute("style")).toBe("");expect(view.getByText("default speed")).toBeInTheDocument();
  expect(view.container.querySelector(".server-footer")).not.toBeNull();view.unmount();client.clear();
 });
});
