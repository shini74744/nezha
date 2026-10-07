import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AppearanceProvider } from "@/appearance/context";
import { defaults, normalize, validate } from "@/appearance/config";
import { NativeEffects } from "@/appearance/effects";
import { ThemeProvider } from "@/components/ThemeProvider";
import { useTheme } from "@/hooks/use-theme";

function config(mode = "dark") {
 const c=defaults(); c.enabled=true;
 Object.values(c.features).forEach(f=>{f.enabled=false;});
 c.features.dark={enabled:true,mode};return c;
}
function Probe(){
 const {theme,setTheme}=useTheme();
 return <><output>{theme}</output><button onClick={()=>setTheme("light")}>manual light</button><button onClick={()=>setTheme("dark")}>manual dark</button></>;
}
function tree(c:ReturnType<typeof defaults>){
 return <MemoryRouter><ThemeProvider storageKey="entry-theme"><AppearanceProvider raw={JSON.stringify(c)}><NativeEffects preview/><Probe/></AppearanceProvider></ThemeProvider></MemoryRouter>;
}
describe("default appearance display mode",()=>{
 it.each(["system","light","dark"])("applies %s once and preserves subsequent manual switching",mode=>{
  const c=config(mode),v=render(tree(c));
  expect(screen.getByRole("status")).toHaveTextContent(mode);
  fireEvent.click(screen.getByText("manual light"));
  expect(screen.getByRole("status")).toHaveTextContent("light");
  v.rerender(tree({...c}));
  expect(screen.getByRole("status")).toHaveTextContent("light");
  fireEvent.click(screen.getByText("manual dark"));
  expect(screen.getByRole("status")).toHaveTextContent("dark");
 });
 it("tracks system changes while automatic and removes the listener after a manual override",()=>{
  let dark=false;
  const listeners=new Set<()=>void>();
  vi.mocked(window.matchMedia).mockImplementation(query=>({
   get matches(){return dark},media:query,onchange:null,
   addEventListener:(_event:string,fn:()=>void)=>listeners.add(fn),
   removeEventListener:(_event:string,fn:()=>void)=>listeners.delete(fn),
   addListener:vi.fn(),removeListener:vi.fn(),dispatchEvent:vi.fn()
  }) as unknown as MediaQueryList);
  const v=render(tree(config("system")));
  expect(document.documentElement).toHaveClass("light");
  act(()=>{dark=true;listeners.forEach(fn=>{fn();});});
  expect(document.documentElement).toHaveClass("dark");
  act(()=>{dark=false;listeners.forEach(fn=>{fn();});});
  expect(document.documentElement).toHaveClass("light");
  fireEvent.click(screen.getByText("manual dark"));
  expect(listeners.size).toBe(0);
  act(()=>{dark=false;listeners.forEach(fn=>{fn();});});
  expect(document.documentElement).toHaveClass("dark");
  v.unmount();expect(listeners.size).toBe(0);
 });
 it.each(["master","feature"])("does not override the original theme when %s is disabled",kind=>{
  localStorage.setItem("entry-theme","light");const c=config();
  if(kind==="master")c.enabled=false;else c.features.dark.enabled=false;
  render(tree(c));expect(screen.getByRole("status")).toHaveTextContent("light");
 });
 it("applies changed configuration and re-enabling without fighting manual choices",()=>{
  const c=config(),v=render(tree(c));
  c.features.dark.mode="light";v.rerender(tree(c));
  expect(screen.getByRole("status")).toHaveTextContent("light");
  c.features.dark.enabled=false;v.rerender(tree(c));
  fireEvent.click(screen.getByText("manual dark"));
  expect(screen.getByRole("status")).toHaveTextContent("dark");
  c.features.dark.enabled=true;v.rerender(tree(c));
  expect(screen.getByRole("status")).toHaveTextContent("light");
 });
 it.each([true,false])("preserves legacy enabled=%s without a mode field",enabled=>{
  const c=normalize({version:1,enabled:true,features:{dark:{enabled}}});
  expect(c.features.dark).toEqual({enabled,mode:"dark"});expect(validate(c)).toBe("");
 });
 it.each(["auto","invalid","",null,17])("rejects unsupported mode %s",mode=>{
  const c=config();c.features.dark.mode=mode;
  expect(validate(c)).not.toBe("");expect(normalize(c).enabled).toBe(false);
 });
});
