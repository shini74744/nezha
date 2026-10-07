import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStableDetailViewport } from "@/hooks/use-stable-detail-viewport";

function Harness({scope=7}:{scope?:number}) {
 const [tab,setTab]=useState("BGP");
 const {viewportRef,preserveScroll}=useStableDetailViewport(scope,tab);
 return <><button onClick={()=>{preserveScroll();setTab(t=>t==="BGP"?"Connectivity":"BGP")}}>switch</button>
 <div ref={viewportRef} data-testid="viewport">{scope}:{tab}</div></>;
}
let y=240,top=140;
beforeEach(()=>{
 vi.useFakeTimers();
 vi.stubGlobal("scrollY",y);
 vi.stubGlobal("scrollX",0);
 vi.stubGlobal("innerHeight",800);
 vi.stubGlobal("scrollTo",vi.fn());
 vi.spyOn(HTMLElement.prototype,"getBoundingClientRect").mockImplementation(()=>({top,bottom:top+100,height:100,left:0,right:100,width:100,x:0,y:top,toJSON(){}}));
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();y=240;top=140});
describe("current-offset detail viewport",()=>{
 it("reserves only the viewport before the old content can collapse",()=>{
  render(<Harness/>);
  const pane=screen.getByTestId("viewport");
  expect(pane.style.minHeight).toBe("");
  fireEvent.click(screen.getByText("switch"));
  expect(pane.style.minHeight).toBe("660px");
  expect(pane).toHaveTextContent("Connectivity");
  expect(window.scrollTo).not.toHaveBeenCalled();
 });
 it("uses the current offset on every switch, never per-tab history",()=>{
  render(<Harness/>);
  fireEvent.click(screen.getByText("switch"));
  vi.stubGlobal("scrollY",120);top=260;
  fireEvent.click(screen.getByText("switch"));
  expect(screen.getByTestId("viewport").style.minHeight).toBe("540px");
  expect(window.scrollTo).not.toHaveBeenCalled();
 });
 it("shrinks the reserved tail when scrolling up and clears it at the top",()=>{
  render(<Harness/>);
  fireEvent.click(screen.getByText("switch"));
  top=260;vi.stubGlobal("scrollY",120);
  fireEvent.scroll(window);
  act(()=>vi.advanceTimersByTime(17));
  expect(screen.getByTestId("viewport").style.minHeight).toBe("540px");
  vi.stubGlobal("scrollY",0);
  fireEvent.scroll(window);
  act(()=>vi.advanceTimersByTime(17));
  expect(screen.getByTestId("viewport").style.minHeight).toBe("");
 });
 it("does not keep adding space when scrolling downward",()=>{
  render(<Harness/>);
  fireEvent.click(screen.getByText("switch"));
  top=-200;vi.stubGlobal("scrollY",580);
  fireEvent.scroll(window);
  act(()=>vi.advanceTimersByTime(17));
  expect(screen.getByTestId("viewport").style.minHeight).toBe("660px");
 });
 it("does not transfer reserved space to another server",()=>{
  const view=render(<Harness/>);
  fireEvent.click(screen.getByText("switch"));
  view.rerender(<Harness scope={8}/>);
  expect(screen.getByTestId("viewport").style.minHeight).toBe("");
  expect(window.scrollTo).not.toHaveBeenCalled();
 });
 it("cancels scheduled scroll work on unmount",()=>{
  const view=render(<Harness/>);
  fireEvent.click(screen.getByText("switch"));fireEvent.scroll(window);
  const cancel=vi.spyOn(window,"cancelAnimationFrame");
  view.unmount();
  expect(cancel).toHaveBeenCalled();
  act(()=>vi.runAllTimers());
  expect(window.scrollTo).not.toHaveBeenCalled();
 });
});
