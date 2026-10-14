import {act,renderHook} from "@testing-library/react";
import {expect,it} from "vitest";
import {networkCardMode,useNetworkCardView} from "@/hooks/use-network-card-view";
it("uses per-server default, toggles only both, resets when switching servers",()=>{
 const {result,rerender}=renderHook(({id,mode,view})=>useNetworkCardView({id,network_display_mode:mode,network_default_view:view}),{initialProps:{id:1,mode:"both",view:"latency"}});
 expect(result.current.view).toBe("latency");act(()=>result.current.toggle());expect(result.current.view).toBe("connectivity");
 rerender({id:2,mode:"both",view:"latency"});expect(result.current.view).toBe("latency");
 rerender({id:2,mode:"connectivity",view:"latency"});expect(result.current.view).toBe("connectivity");
 act(()=>result.current.toggle());expect(result.current.view).toBe("connectivity");
 rerender({id:2,mode:"hidden",view:"latency"});expect(result.current.visible).toBe(false);
});
it("preserves hidden legacy nodes and follows batch connectivity switches",()=>{
 expect(networkCardMode({connectivity_disabled:true})).toBe("hidden");
 expect(networkCardMode({connectivity_disabled:true,connectivity_local_only:true})).toBe("both");
 expect(networkCardMode({network_display_mode:"both",connectivity_disabled:true})).toBe("latency");
 expect(networkCardMode({network_display_mode:"connectivity",connectivity_disabled:true})).toBe("hidden");
});
