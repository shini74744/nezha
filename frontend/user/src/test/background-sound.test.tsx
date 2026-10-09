import {it,expect,vi,afterEach} from "vitest";
import {render,screen,fireEvent,act,cleanup,waitFor} from "@testing-library/react";
import {AppearanceProvider} from "@/appearance/context";
import {defaults} from "@/appearance/config";
import {NativeBackground} from "@/appearance/background";
import {BackgroundSoundLogo,publishBackgroundSound} from "@/appearance/background-sound";
afterEach(()=>{cleanup();vi.restoreAllMocks()});
function setup(){
 const c=defaults();c.enabled=true;
 Object.assign(c.features.background,{enabled:true,regionEnabled:false,scheduleEnabled:false,desktopMedia:[{type:"video",src:"https://example.test/bg.mp4"}],mobileMedia:[]});
 const navigate=vi.fn();
 const renderUI=()=> <AppearanceProvider raw={JSON.stringify(c)}><NativeBackground/><div onClick={navigate}><BackgroundSoundLogo><img alt="logo"/></BackgroundSoundLogo></div></AppearanceProvider>;
 vi.spyOn(HTMLMediaElement.prototype,"pause").mockImplementation(()=>{});
 if(!vi.isMockFunction(HTMLMediaElement.prototype.play))vi.spyOn(HTMLMediaElement.prototype,"play").mockResolvedValue();
 const view=render(renderUI());
 const video=document.querySelector("video")!;Object.defineProperty(video,"readyState",{value:2,configurable:true});fireEvent.loadedData(video);
 return{c,view,navigate,renderUI};
}
it("uses the logo to toggle sound both ways without navigating or floating control",async()=>{
 const play=vi.spyOn(HTMLMediaElement.prototype,"play").mockResolvedValue();
 const {navigate}=setup();const video=document.querySelector("video")!;play.mockClear();
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
 view.rerender(renderUI());
 expect(screen.getByRole("button",{name:"开启背景声音"})).toBeInTheDocument();
 const image=document.querySelector("img[src*=bg]")!;Object.defineProperty(image,"naturalWidth",{value:100});
 await act(async()=>{fireEvent.load(image)});fireEvent.animationEnd(image.parentElement!);
 expect(screen.queryByRole("button",{name:/背景声音/})).toBeNull();
 await waitFor(()=>expect(document.querySelector("video")).toBeNull(),{timeout:2000});
});
it("keeps the same logo image when background sound appears and disappears",()=>{
 const view=render(<BackgroundSoundLogo><img alt="stable logo" src="/logo.png"/></BackgroundSoundLogo>);
 const logo=screen.getByAltText("stable logo");
 let clear=()=>{};
 act(()=>{clear=publishBackgroundSound({muted:true,toggle:async()=>{}})});
 expect(screen.getByAltText("stable logo")).toBe(logo);
 act(()=>clear());
 expect(screen.getByAltText("stable logo")).toBe(logo);
 view.unmount();
});
