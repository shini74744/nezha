import {afterEach,describe,it,expect,vi} from "vitest";
import {cleanup,render,screen,fireEvent} from "@testing-library/react";
import ProviderLogoEditor from "../components/ProviderLogoEditor";
vi.mock("../hooks/useLogoGroups",()=>({default:()=>({data:[]})}));
vi.mock("../hooks/useLogoLibrary",()=>({default:()=>({data:[]})}));
vi.mock("../components/LogoChoicePicker",()=>({default:({label}:{label:string})=><div>{label}</div>}));
vi.mock("../components/LogoEditor",()=>({default:()=> <div>上传操作</div>}));
vi.mock("../components/ProviderLayoutEditor",()=>({default:()=> <div>调整内容</div>}));
afterEach(cleanup);
const note={planDataMod:{providerLogo:{logo:"/api/v1/logo/assets/"+"a".repeat(64)+".png",logoLayout:{mobile:{x:12,y:-5,scale:75}}}}};
describe("provider section disclosure",()=>{
 it.each([{},note])("starts closed without changing stored values",value=>{
  const onChange=vi.fn();render(<ProviderLogoEditor note={value} onChange={onChange}/>);
  expect(screen.getByRole("button",{name:"服务器厂商 Logo"}).getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText("选择服务器厂商")).toBeNull();expect(screen.queryByText("上传操作")).toBeNull();expect(onChange).not.toHaveBeenCalled();
 });
 it("opens only on click and collapsing does not clear the logo",async()=>{
  const onChange=vi.fn();render(<ProviderLogoEditor note={note} onChange={onChange}/>);
  const trigger=screen.getByRole("button",{name:"服务器厂商 Logo"});fireEvent.click(trigger);
  expect(screen.getByText("选择服务器厂商")).toBeTruthy();expect(screen.queryByText("调整内容")).toBeNull();
  fireEvent.click(trigger);expect(screen.queryByText("选择服务器厂商")).toBeNull();
  fireEvent.click(trigger);expect(screen.getByText("选择服务器厂商")).toBeTruthy();expect(onChange).not.toHaveBeenCalled();
 });
});
