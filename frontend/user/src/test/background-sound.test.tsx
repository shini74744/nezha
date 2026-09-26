import {it,expect,vi,afterEach} from "vitest";
import {render,screen,fireEvent,act,cleanup} from "@testing-library/react";
import {AppearanceProvider} from "@/appearance/context";
import {defaults} from "@/appearance/config";
import {NativeBackground} from "@/appearance/background";
import {BackgroundSoundLogo} from "@/appearance/background-sound";
afterEach(()=>{cleanup();vi.restoreAllMocks()});
function setup(){
 const c=defaults();c.enabled=true;
 Object.assign(c.features.background,{enabled:true,regionEnabled:false,scheduleEnabled:false,desktopMedia:[{type:"video",src:"https://example.test/bg.mp4"}],mobileMedia:[]});
 const navigate=vi.fn();
 const renderUI=()=> <AppearanceProvider raw={JSON.stringify(c)}><NativeBackground/><div onClick={navigate}><BackgroundSoundLogo><img alt="logo"/></BackgroundSoundLogo></div></AppearanceProvider>;
 const view=render(renderUI());return{c,view,navigate,renderUI};
}
it("uses the logo to toggle sound both ways without navigating or floating control",async()=>{
 const play=vi.spyOn(HTMLMediaElement.prototype,"play").mockResolvedValue();
 const {navigate}=setup();const video=document.querySelector("video")!;
 expect(video.muted).toBe(true);expect(document.querySelector(".nz-background-sound")).toBeNull();
 await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"开启背景声音"}))});
 expect(video.muted).toBe(false);expect(screen.getByRole("button",{name:"关闭背景声音"})).toHaveAttribute("aria-pressed","true");
 await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"关闭背景声音"}))});
 expect(video.muted).toBe(true);expect(play).toHaveBeenCalledTimes(2);expect(navigate).not.toHaveBeenCalled();
});it("failed playback returns to mute and disabling restores normal logo behavior",async()=>{
 vi.spyOn(HTMLMediaElement.prototype,"play").mockRejectedValue(new Error("blocked"));
 const {c,view,navigate,renderUI}=setup();
 await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"开启背景声音"}))});
 expect(document.querySelector("video")!.muted).toBe(true);
 c.features.video.enabled=false;view.rerender(renderUI());
 expect(screen.queryByRole("button",{name:/背景声音/})).toBeNull();
 fireEvent.click(screen.getByAltText("logo"));expect(navigate).toHaveBeenCalledTimes(1);
});
it("image fallback unregisters the logo controller",async()=>{
 const {c,view,renderUI}=setup();
 c.features.background.desktopMedia=[{type:"image",src:"https://example.test/bg.png"}];
 view.rerender(renderUI());await act(async()=>{});
 expect(screen.queryByRole("button",{name:/背景声音/})).toBeNull();
 expect(document.querySelector("video")).toBeNull();
});