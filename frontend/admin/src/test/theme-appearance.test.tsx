import {act,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {MemoryRouter} from "react-router-dom";
import AppearancePage from "@/routes/appearance";
import {fetcher,FetcherMethod} from "@/api/api";
import {defaults} from "@/lib/appearance-config";
vi.mock("@/hooks/useAuth",()=>({useAuth:()=>({profile:{role:0},loading:false})}));
vi.mock("@/components/settings-tab",()=>({SettingsTab:()=>null}));
vi.mock("@/api/api",()=>({fetcher:vi.fn(),FetcherMethod:{GET:"GET",PATCH:"PATCH"}}));
vi.mock("sonner",()=>({toast:{success:vi.fn(),error:vi.fn(),info:vi.fn()}}));
const base="/api/v1/setting/appearance",dora=base+"?theme=doraemon-dist";
let states:Record<string,any>;
beforeEach(()=>{
 vi.mocked(fetcher).mockReset();
 const c=defaults();c.enabled=true;c.features.traffic.toggleInterval=9000;
 states={
  [base]:{config:c,custom_code:"",revision:"default-1",current_template:"user-dist"},
  [dora]:{config:{version:1,enabled:true,features:{traffic:{enabled:true,toggleInterval:5000}}},custom_code:"",revision:"dora-1",current_template:"user-dist"},
 };
 vi.mocked(fetcher).mockImplementation(async(method,url,payload:any)=>{
  const key=String(url);
  if(key==="/api/v1/setting/display")return {statistics_split:true,detail_network_split:true};
  if(!states[key])throw Error("unexpected endpoint "+key);
  if(method===FetcherMethod.PATCH){
   expect(payload.revision).toBe(states[key].revision);
   states[key]={...states[key],config:structuredClone(payload.config),revision:states[key].revision+"-saved"};
  }
  return structuredClone(states[key]);
 });
});
const show=()=>render(<MemoryRouter><AppearancePage/></MemoryRouter>);
async function selectDora(){
 const select=screen.getByRole("combobox",{name:"设置主题"});
 await waitFor(()=>expect((select as HTMLSelectElement).disabled).toBe(false));
 fireEvent.change(select,{target:{value:"doraemon-dist"}});
 await screen.findByRole("heading",{name:"主题外观：哆啦 A 梦"});
 await waitFor(()=>expect((screen.getByRole("combobox",{name:"设置主题"}) as HTMLSelectElement).disabled).toBe(false));
}
describe("independent theme appearance editor",()=>{
 it("defaults to the default theme, exposes independent Doraemon enhancements, saves without touching default settings",async()=>{
  const original=JSON.stringify(states[base]);show();
  await screen.findByRole("button",{name:"站点品牌"});
  expect((screen.getByRole("combobox",{name:"设置主题"}) as HTMLSelectElement).value).toBe("user-dist");
  await selectDora();
  expect(screen.queryByRole("button",{name:"站点品牌"})).toBeNull();
  expect(screen.queryByRole("button",{name:"默认显示模式"})).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"流量进度条"}));
  const input=screen.getByRole("spinbutton");
  expect((input as HTMLInputElement).value).toBe("5000");
  fireEvent.change(input,{target:{value:"7000"}});
  const featureSwitch=screen.getByRole("switch",{name:"流量进度条"})!;
  fireEvent.click(featureSwitch);
  fireEvent.click(screen.getByRole("button",{name:"保存美化设置"}));
  await waitFor(()=>expect(states[dora].config.features.traffic.enabled).toBe(false));
  expect(Object.keys(states[dora].config.features)).toEqual(["traffic","friendsBanner","friendsInteraction","gadgetDecorations","backToTop","speedColor","speedAnimation","cardGadgets"]);
  expect(states[dora].config.features.friendsBanner.enabled).toBe(true);
  expect(states[dora].config.features.traffic.toggleInterval).toBe(7000);
  expect(JSON.stringify(states[base])).toBe(original);
  await waitFor(()=>expect((screen.getByRole("combobox",{name:"设置主题"}) as HTMLSelectElement).disabled).toBe(false));
  fireEvent.change(screen.getByRole("combobox",{name:"设置主题"}),{target:{value:"user-dist"}});
  await screen.findByRole("button",{name:"站点品牌"});
  fireEvent.click(screen.getByRole("button",{name:"流量进度条"}));
  expect(screen.getAllByRole("spinbutton").some(e=>(e as HTMLInputElement).value==="9000")).toBe(true);
  await selectDora();
  fireEvent.click(screen.getByRole("button",{name:"流量进度条"}));
  expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("7000");
  expect(screen.getByRole("switch",{name:"流量进度条"})?.getAttribute("aria-checked")).toBe("false");
 });
 it("warns before discarding a dirty theme and does not send a patch when switching",async()=>{
  show();await screen.findByRole("button",{name:"站点品牌"});
  fireEvent.click(screen.getByRole("switch",{name:"启用内置美化"}));
  const confirm=vi.spyOn(window,"confirm").mockReturnValue(false);
  fireEvent.change(screen.getByRole("combobox",{name:"设置主题"}),{target:{value:"doraemon-dist"}});
  expect(confirm).toHaveBeenCalled();
  expect((screen.getByRole("combobox",{name:"设置主题"}) as HTMLSelectElement).value).toBe("user-dist");
  confirm.mockReturnValue(true);await selectDora();
  expect(vi.mocked(fetcher).mock.calls.filter(c=>c[0]===FetcherMethod.PATCH)).toHaveLength(0);
 });
 it("blocks editing stale values while reading and lets the user recover after read failure",async()=>{
  const current=vi.mocked(fetcher).getMockImplementation()!;
  let reject!:(reason:Error)=>void;
  vi.mocked(fetcher).mockImplementation((method,url,payload)=>String(url)===dora?new Promise((_,r)=>{reject=r}):current(method,url,payload));
  show();await screen.findByRole("button",{name:"站点品牌"});
  fireEvent.change(screen.getByRole("combobox",{name:"设置主题"}),{target:{value:"doraemon-dist"}});
  expect(screen.queryByRole("button",{name:"流量进度条"})).toBeNull();
  expect((screen.getByRole("button",{name:"保存美化设置"}) as HTMLButtonElement).disabled).toBe(true);
  await act(async()=>reject(new Error("network failed")));
  await screen.findByRole("alert");
  expect((screen.getByRole("combobox",{name:"设置主题"}) as HTMLSelectElement).disabled).toBe(false);
  expect((screen.getByRole("button",{name:"保存美化设置"}) as HTMLButtonElement).disabled).toBe(true);
 });
 it("keeps the draft and scope after revision conflicts",async()=>{
  show();await screen.findByRole("button",{name:"站点品牌"});await selectDora();
  fireEvent.click(screen.getByRole("switch",{name:"启用内置美化"}));
  vi.mocked(fetcher).mockRejectedValueOnce(new Error("appearance changed; reload settings"));
  fireEvent.click(screen.getByRole("button",{name:"保存美化设置"}));
  await waitFor(()=>expect((screen.getByRole("button",{name:"保存美化设置"}) as HTMLButtonElement).disabled).toBe(false));
  expect((screen.getByRole("combobox",{name:"设置主题"}) as HTMLSelectElement).value).toBe("doraemon-dist");
  expect(screen.getByRole("switch",{name:"启用内置美化"}).getAttribute("aria-checked")).toBe("false");
  expect(states[dora].config.enabled).toBe(true);
 });
});
it("persists every new Doraemon switch and keeps all default values unchanged",async()=>{
 const original=JSON.stringify(states[base]);show();await screen.findByRole("button",{name:"站点品牌"});await selectDora();
 const titles=["伙伴同框","伙伴互动","道具装饰","竹蜻蜓返回顶部","速率颜色","高速率动画特效","卡片秘密道具"];
 for(const title of titles){
  await screen.findByRole("button",{name:title});
  const section=screen.getByRole("button",{name:title}).closest("section")!;
  const switchButton=section.querySelector('[role="switch"]')!;
  expect(switchButton.getAttribute("aria-checked")).toBe("true");
  fireEvent.click(switchButton);
 }
 fireEvent.click(screen.getByRole("button",{name:"保存美化设置"}));
 await waitFor(()=>expect(states[dora].config.features.cardGadgets.enabled).toBe(false));
 for(const key of ["friendsBanner","friendsInteraction","gadgetDecorations","backToTop","speedColor","speedAnimation","cardGadgets"])expect(states[dora].config.features[key].enabled).toBe(false);
 expect(JSON.stringify(states[base])).toBe(original);
});
