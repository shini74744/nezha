import {it,expect,vi,afterEach} from "vitest";
import {render,screen,act} from "@testing-library/react";
import {defaults,normalize} from "@/appearance/config";
import {AppearanceProvider} from "@/appearance/context";
import {usePeakCutDefault} from "@/appearance/peak-cut";
function Probe(){return <output>{String(usePeakCutDefault())}</output>}
afterEach(()=>vi.unstubAllGlobals());
it("migrates old disabled background switch and respects explicit settings",()=>{
 const c=defaults();delete c.features.peakCut;c.features.background.peakCutDesktop=false;
 expect(normalize(c).features.peakCut.enabled).toBe(false);
 c.features.peakCut={enabled:true,desktop:false,mobile:true};
 expect(normalize(c).features.peakCut).toEqual(c.features.peakCut);
});
it("is independent of background, follows device and cleans up",()=>{
 vi.stubGlobal("innerWidth",1366);const c=defaults();c.enabled=true;c.features.background.enabled=false;
 c.features.peakCut={enabled:true,desktop:true,mobile:false};
 const view=render(<AppearanceProvider raw={JSON.stringify(c)}><Probe/></AppearanceProvider>);
 expect(screen.getByRole("status")).toHaveTextContent("true");
 act(()=>{vi.stubGlobal("innerWidth",390);window.dispatchEvent(new Event("resize"))});
 expect(screen.getByRole("status")).toHaveTextContent("false");
 c.features.peakCut.mobile=true;view.rerender(<AppearanceProvider raw={JSON.stringify(c)}><Probe/></AppearanceProvider>);
 expect(screen.getByRole("status")).toHaveTextContent("true");
 c.features.peakCut.enabled=false;view.rerender(<AppearanceProvider raw={JSON.stringify(c)}><Probe/></AppearanceProvider>);
 expect(screen.getByRole("status")).toHaveTextContent("false");
});
