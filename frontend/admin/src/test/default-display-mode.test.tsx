import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,describe,expect,it,vi} from "vitest";
import {MemoryRouter} from "react-router-dom";
import AppearancePage from "@/routes/appearance";
import {fetcher,FetcherMethod} from "@/api/api";
import {defaults,normalize,validate} from "@/lib/appearance-config";
vi.mock("@/hooks/useAuth",()=>({useAuth:()=>({profile:{role:0},loading:false})}));
vi.mock("@/components/settings-tab",()=>({SettingsTab:()=>null}));
vi.mock("@/api/api",()=>({fetcher:vi.fn(),FetcherMethod:{GET:"GET",PATCH:"PATCH"}}));
vi.mock("sonner",()=>({toast:{success:vi.fn(),error:vi.fn(),info:vi.fn()}}));
afterEach(()=>{cleanup();vi.clearAllMocks()});
describe("default display mode editor",()=>{
 it.each(["system","light","dark"])("saves and reloads %s without changing other features",async mode=>{
  let stored={config:defaults(),custom_code:"",revision:"r1",current_template:"user-dist"};
  stored.config.enabled=true;stored.config.features.dark.mode=mode==="dark"?"light":"dark";
  const before=JSON.stringify(stored.config.features.traffic);
  vi.mocked(fetcher).mockImplementation(async(method,_url,payload:any)=>{
   if(_url==="/api/v1/setting/display")return {statistics_split:true,detail_network_split:true} as any;
   if(method===FetcherMethod.PATCH)stored={...stored,config:payload.config,revision:"r2"};
   return structuredClone(stored) as any;
  });
  const v=render(<MemoryRouter><AppearancePage/></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button",{name:"默认显示模式"}));
  const select=screen.getByRole("combobox",{name:"进入前台时的模式"}) as HTMLSelectElement;
  expect([...select.options].map(x=>x.value)).toEqual(["system","light","dark"]);
  fireEvent.change(select,{target:{value:mode}});
  fireEvent.click(screen.getByRole("button",{name:"保存美化设置"}));
  await waitFor(()=>expect(stored.config.features.dark.mode).toBe(mode));
  expect(validate(stored.config)).toBe("");
  expect(JSON.stringify(stored.config.features.traffic)).toBe(before);
  expect(vi.mocked(fetcher).mock.calls.filter(c=>c[0]===FetcherMethod.PATCH)).toHaveLength(1);
  v.unmount();
  render(<MemoryRouter><AppearancePage/></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button",{name:"默认显示模式"}));
  expect((screen.getByRole("combobox",{name:"进入前台时的模式"}) as HTMLSelectElement).value).toBe(mode);
 });
 it.each([true,false])("keeps old dark switch %s compatible",enabled=>{
  const c=normalize({version:1,enabled:true,features:{dark:{enabled}}});
  expect(c.features.dark).toEqual({enabled,mode:"dark"});expect(validate(c)).toBe("");
 });
 it.each(["auto","",null,9])("rejects invalid mode %s",mode=>{
  const c=defaults();c.features.dark.mode=mode;expect(validate(c)).not.toBe("");
 });
});
