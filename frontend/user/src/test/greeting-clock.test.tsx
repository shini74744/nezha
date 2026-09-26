import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { defaults, normalize, validate } from "@/appearance/config";
import { greetingMessages, chooseGreeting, mixClockColor } from "@/appearance/greeting-clock";
import { NativeGreeting } from "@/appearance/widgets";
import { AppearanceProvider } from "@/appearance/context";
import { FeatureScope } from "@/appearance/scope";
import { clock } from "@/appearance/modules/clock";
import originalGreetings from "@/appearance/greetings.json";
afterEach(() => vi.useRealTimers());
const at = (hour: number, minute = 0) => new Date(2026, 8, 26, hour, minute, 0);
describe("custom greeting and clock", () => {
  it("upgrades enabled-only settings without losing any of the 70 original greetings", () => {
    const c = normalize('{"version":1,"enabled":true,"features":{"greeting":{"enabled":true},"clock":{"enabled":false}}}');
    expect(c.enabled).toBe(true);
    expect(c.features.clock.enabled).toBe(false);
    expect(c.features.clock.hourEndColor).toBe("#ff2828");
    expect(c.features.greeting.rules.map((r: any) => r.messages)).toEqual(originalGreetings);
  });
  it.each([[7,0],[9,1],[12,2],[14,3],[18,4],[20,5],[0,6],[6,6],[23,5]])("preserves the original boundary at %s", (hour, group) => {
    expect(greetingMessages(defaults().features.greeting.rules, at(hour))).toEqual(originalGreetings[group]);
  });
  it("handles custom minutes, overnight, overlapping, full-day, missing and empty periods", () => {
    const rules = [{name:"night",start:"22:30",end:"06:15",messages:["night"]},{name:"all",start:"00:00",end:"00:00",messages:["all"]}];
    expect(greetingMessages(rules, at(22,29))).toEqual(["all"]);
    expect(greetingMessages(rules, at(22,30))).toEqual(["night"]);
    expect(greetingMessages(rules, at(6,14))).toEqual(["night"]);
    expect(greetingMessages(rules, at(6,15))).toEqual(["all"]);
    expect(greetingMessages(rules.slice(0,1), at(12))).toEqual([]);
    expect(greetingMessages([], at(12))).toEqual([]);
    expect(greetingMessages([{...rules[1],messages:["", "   "]}], at(12))).toEqual([]);
  });
  it("avoids repeats but never loses the only remaining greeting", () => {
    expect(chooseGreeting(["a","b"],"a",()=>0)).toBe("b");
    expect(chooseGreeting(["a"],"a")).toBe("a");
    expect(chooseGreeting(["a","a"],"a")).toBe("a");
    expect(chooseGreeting([],"a")).toBe("");
  });
  it("renders saved text safely, updates at the boundary and keeps fallback for empty lists", async () => {
    vi.useFakeTimers(); vi.setSystemTime(at(9,59));
    const c = defaults(); c.enabled = true;
    c.features.greeting.rules = [{name:"test",start:"09:00",end:"10:00",messages:["<b>custom</b>"]}];
    localStorage.setItem("lastGreeting","<b>custom</b>");
    const ui = () => <AppearanceProvider raw={JSON.stringify(c)}><NativeGreeting fallback="original" /></AppearanceProvider>;
    const view = render(ui());
    expect(screen.getByText("<b>custom</b>")).toBeInTheDocument();
    expect(view.container.querySelector("b")).toBeNull();
    await act(async () => { vi.advanceTimersByTime(60000); });
    expect(screen.getByText("original")).toBeInTheDocument();
    c.features.greeting.rules = []; view.rerender(ui());
    expect(screen.getByText("original")).toBeInTheDocument();
    c.features.greeting.rules = [{name:"all",start:"00:00",end:"00:00",messages:["new"]}]; view.rerender(ui());
    expect(screen.getByText("new")).toBeInTheDocument();
    c.features.greeting.enabled = false; view.rerender(ui());
    expect(screen.getByText("original")).toBeInTheDocument();
  });
  it("interpolates custom hex colors and preserves the legacy endpoints", () => {
    expect(mixClockColor("#000000","#ffffff",0.5)).toBe("rgb(128, 128, 128)");
    expect(mixClockColor("#123456","#abcdef",0)).toBe("rgb(18, 52, 86)");
    expect(mixClockColor("#123456","#abcdef",1)).toBe("rgb(171, 205, 239)");
    expect(mixClockColor("#ffffff","#ff2828",1)).toBe("rgb(255, 40, 40)");
  });
  it("applies custom clock colors and restores the DOM when disabled", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026,8,26,23,59,59));
    const root = document.createElement("div"); root.className = "flex items-center font-medium text-sm";
    root.innerHTML = '<div data-issues-count-animation="true">23</div><span class="opacity-50">:</span><div data-issues-count-animation="true">59</div><span class="opacity-50">:</span><div data-issues-count-animation="true">59</div>';
    document.body.append(root);
    const scope = new FeatureScope("clock");
    try {
      clock(scope,{...defaults().features.clock,hourEndColor:"#123456",minuteEndColor:"#abcdef",secondEndColor:"#010203"});
      expect(root.children[0]).toHaveStyle({color:"rgb(18, 52, 86)"});
      expect(root.children[2]).toHaveStyle({color:"rgb(171, 205, 239)"});
      expect(root.children[4]).toHaveStyle({color:"rgb(1, 2, 3)"});
      scope.dispose();
      expect((root.children[0] as HTMLElement).style.color).toBe("");
      expect(vi.getTimerCount()).toBe(0);
    } finally { scope.dispose(); root.remove(); }
  });
  it("rejects invalid times, colors and too many rules while accepting empty lists", () => {
    for (const change of [(c:any)=>c.features.greeting.rules[0].start="24:00",(c:any)=>c.features.clock.hourEndColor="red",(c:any)=>c.features.greeting.rules=Array(33).fill(c.features.greeting.rules[0])]) {
      const c=defaults(); change(c); expect(validate(c)).not.toBe("");
    }
    const c=defaults();c.features.greeting.rules=[];expect(validate(c)).toBe("");
  });
});
