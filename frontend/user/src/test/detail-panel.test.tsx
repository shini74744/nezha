import {Suspense,useEffect,useState} from "react";
import {act,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {describe,it,expect,vi} from "vitest";
import DetailPanel from "@/components/DetailPanel";
import TabSwitch from "@/components/TabSwitch";

describe("responsive detail panes",()=>{
 it("discards an obsolete suspended pane and keeps only the selected subscription",async()=>{
  let resolve!:()=>void,ready=false;
  const pending=new Promise<void>(r=>{resolve=()=>{ready=true;r()}});
  const mounted=vi.fn(),disposed=vi.fn();
  function Pane({name}:{name:string}){
   if(name==="BGP"&&!ready)throw pending;
   useEffect(()=>{mounted(name);return()=>disposed(name)},[name]);
   return <div data-testid="pane">{name}</div>;
  }
  function Harness(){
   const [tab,setTab]=useState("Detail");
   return <><TabSwitch tabs={["Detail","BGP","Streaming"]} currentTab={tab} setCurrentTab={setTab}/>
    <DetailPanel key={tab}><Suspense fallback={<p>Loading pane</p>}><Pane name={tab}/></Suspense></DetailPanel></>;
  }
  render(<Harness/>);
  await screen.findByText("Detail",{selector:'[data-testid="pane"]'});
  fireEvent.click(screen.getByRole("button",{name:"tabSwitch.BGP"}));
  await screen.findByText("Loading pane");
  expect(screen.queryByTestId("pane")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:/Streaming|流媒体/}));
  await waitFor(()=>expect(screen.getByTestId("pane")).toHaveTextContent("Streaming"));
  await act(async()=>{resolve();await pending});
  expect(screen.getAllByTestId("pane")).toHaveLength(1);
  expect(screen.getByTestId("pane")).toHaveTextContent("Streaming");
  expect(mounted.mock.calls.map(c=>c[0])).toEqual(["Detail","Streaming"]);
  expect(disposed.mock.calls.map(c=>c[0])).toEqual(["Detail"]);
 });
 it("remounts on server changes and responds to keyboard selection",async()=>{
  function Harness({server}:{server:number}){
   const [tab,setTab]=useState("Detail");
   return <><TabSwitch tabs={["Detail","BGP"]} currentTab={tab} setCurrentTab={setTab}/>
    <DetailPanel key={server+":"+tab}><div data-testid="pane">{server}:{tab}</div></DetailPanel></>;
  }
  const view=render(<Harness server={7}/>);
  const button=screen.getByRole("button",{name:"tabSwitch.BGP"});
  fireEvent.keyDown(button,{key:"Enter"});
  await waitFor(()=>expect(button).toHaveAttribute("aria-pressed","true"));
  expect(screen.getByTestId("pane")).toHaveTextContent("7:BGP");
  view.rerender(<Harness server={8}/>);
  await waitFor(()=>expect(screen.getByTestId("pane")).toHaveTextContent("8:BGP"));
  expect(screen.getAllByTestId("pane")).toHaveLength(1);
 });
});
