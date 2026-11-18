import {afterEach,expect,it,vi} from "vitest";
import {sakura} from "@/appearance/modules/sakura";
import {FeatureScope} from "@/appearance/scope";
import {defaults} from "@/appearance/config";

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals()});
it("applies mobile and desktop counts, motion parameters, and cancels frames on disposal",()=>{
 const frames=new Map<number,FrameRequestCallback>();let serial=0;
 vi.stubGlobal("requestAnimationFrame",(cb:FrameRequestCallback)=>{frames.set(++serial,cb);return serial});
 vi.stubGlobal("cancelAnimationFrame",(id:number)=>frames.delete(id));
 vi.stubGlobal("innerWidth",1440);vi.stubGlobal("innerHeight",900);
 vi.spyOn(Math,"random").mockReturnValue(.5);
 class LoadedImage extends EventTarget {complete=true;naturalWidth=24;src=""}
 vi.stubGlobal("Image",LoadedImage);
 const ctx={clearRect:vi.fn(),save:vi.fn(),translate:vi.fn(),rotate:vi.fn(),drawImage:vi.fn(),restore:vi.fn()};
 const canvas=document.createElement("canvas");
 vi.spyOn(canvas,"getContext").mockReturnValue(ctx as any);
 const c={...defaults().features.sakura,count:4,mobileCount:2,size:60,speed:2,wind:3};
 const scope=new FeatureScope("sakura");
 sakura(scope,c,canvas);
 expect(canvas.dataset.petalCount).toBe("4");
 const step=(time:number)=>{const entry=[...frames][0];frames.delete(entry[0]);entry[1](time)};
 step(100);expect(ctx.drawImage).toHaveBeenCalledTimes(4);
 expect(ctx.drawImage.mock.calls[0].slice(-2)).toEqual([30,30]);
 expect(ctx.translate.mock.calls[0][0]).toBe(726);
 expect(ctx.translate.mock.calls[0][1]).toBeCloseTo(453.7);
 vi.stubGlobal("innerWidth",390);window.dispatchEvent(new Event("resize"));
 expect(canvas.dataset.petalCount).toBe("2");ctx.drawImage.mockClear();
 step(116.67);expect(ctx.drawImage).toHaveBeenCalledTimes(2);
 scope.dispose();expect(frames.size).toBe(0);
 vi.stubGlobal("innerWidth",1440);window.dispatchEvent(new Event("resize"));
 expect(canvas.dataset.petalCount).toBe("2");
});
it("supports zero petals and disposal before the image loads",()=>{
 class PendingImage extends EventTarget {complete=false;naturalWidth=0;src=""}
 vi.stubGlobal("Image",PendingImage);
 const raf=vi.fn();vi.stubGlobal("requestAnimationFrame",raf);
 const canvas=document.createElement("canvas");
 vi.spyOn(canvas,"getContext").mockReturnValue({} as any);
 const scope=new FeatureScope("sakura");
 sakura(scope,{...defaults().features.sakura,count:0,mobileCount:0},canvas);
 expect(canvas.dataset.petalCount).toBe("0");scope.dispose();expect(raf).not.toHaveBeenCalled();
});
