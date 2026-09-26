import {describe,it,expect,vi} from "vitest";
import {screen} from "@testing-library/react";
import ServerCard from "@/components/ServerCard";
import ServerCardInline from "@/components/ServerCardInline";
import {createServer} from "@/test/fixtures";
import {renderWithProviders} from "@/test/utils";
vi.mock("@/appearance/widgets",()=>({
 NativeTraffic:()=> <div data-testid="traffic">traffic</div>,
 NativeName:({children}:any)=>children,NativeSpeed:()=>null,
}));
describe.each([ServerCard,ServerCardInline])("legacy offline layout",Component=>{
 it.each([false,true])("keeps saved notes without traffic when fixed name is %s",fixed=>{
  Object.assign(window,{FixedTopServerName:fixed,ShowNetTransfer:true});
  const server=createServer({last_active:"2024-01-01T00:00:00Z",public_note:JSON.stringify({
   planDataMod:{bandwidth:"100Mbps",trafficVol:"10T/月",IPv4:"1",networkRoute:"CMI",extra:"保留备注"},
  })});
  renderWithProviders(<Component now={Date.parse("2025-01-01T00:00:20Z")} serverInfo={server}/>);
  expect(screen.queryByTestId("traffic")).toBeNull();
  expect(screen.getByText("edge-1")).toBeInTheDocument();
  expect(screen.getByText("100Mbps")).toBeInTheDocument();
  expect(screen.getByText("保留备注")).toBeInTheDocument();
 }); it("keeps online traffic and removes it immediately on disconnect",()=>{
  const now=Date.parse("2025-01-01T00:00:20Z"),server=createServer();
  const view=renderWithProviders(<Component now={now} serverInfo={server}/>);
  expect(screen.getByTestId("traffic")).toBeInTheDocument();
  view.rerender(<Component now={now} serverInfo={{...server,last_active:"2024-01-01T00:00:00Z"}}/>);
  expect(screen.queryByTestId("traffic")).toBeNull();
  view.rerender(<Component now={now} serverInfo={server}/>);
  expect(screen.getByTestId("traffic")).toBeInTheDocument();
 });
});