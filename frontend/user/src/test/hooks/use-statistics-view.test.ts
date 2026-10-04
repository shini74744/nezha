import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useStatisticsView } from "@/hooks/use-statistics-view";

describe("statistics preferences", () => {
	it("starts closed, keeps themes independent and restores explicit choices", () => {
		localStorage.setItem("statisticsView","traffic");
		const {result,rerender}=renderHook(({prefix})=>useStatisticsView(prefix,true,true),{initialProps:{prefix:"doraemon:"}});
		expect(result.current[0]).toBe("closed");
		act(()=>result.current[1]("uptime"));
		expect(localStorage.getItem("statisticsView")).toBe("traffic");
		expect(localStorage.getItem("doraemon:statisticsView")).toBe("uptime");
		rerender({prefix:""});
		expect(result.current[0]).toBe("traffic");
	});
	it("migrates legacy open state after data loads, never on every refresh", () => {
		localStorage.setItem("showServices","1");
		const {result,rerender}=renderHook(({ready,traffic})=>useStatisticsView("",ready,traffic),{initialProps:{ready:false,traffic:false}});
		expect(result.current[0]).toBe("closed");
		rerender({ready:true,traffic:true});
		expect(result.current[0]).toBe("traffic");
		act(()=>result.current[1]("uptime"));
		rerender({ready:true,traffic:false});
		expect(result.current[0]).toBe("uptime");
	});
	it("respects an explicit closed choice over ForceShowServices", () => {
		window.ForceShowServices=true;
		localStorage.setItem("statisticsView","closed");
		const {result}=renderHook(()=>useStatisticsView("",true,true));
		expect(result.current[0]).toBe("closed");
	});
	it("keeps a choice made before the query finishes", () => {
		window.ForceShowServices=true;
		const {result,rerender}=renderHook(({ready})=>useStatisticsView("",ready,true),{initialProps:{ready:false}});
		act(()=>result.current[1]("uptime"));
		rerender({ready:true});
		expect(result.current[0]).toBe("uptime");
	});
	it("handles invalid preferences and unavailable browser storage", () => {
		localStorage.setItem("statisticsView","both");
		const {result}=renderHook(()=>useStatisticsView("",true,true));
		expect(result.current[0]).toBe("closed");
		vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new Error("blocked")});
		act(()=>result.current[1]("traffic"));
		expect(result.current[0]).toBe("traffic");
	});
});
