import {it,expect} from "vitest";
import {defaults,normalize,validate} from "@/appearance/config";
import {getBackgroundLoad,backgroundLoadEffects,validateBackgroundLoad} from "@/appearance/background-load";
it("uses independent device defaults and all effect values",()=>{
 const c=defaults();c.features.background.desktopLoadEffect="left";c.features.background.desktopLoadDuration=3.5;
 c.features.background.mobileLoadEffect="zoom";c.features.background.mobileLoadDuration=0;
 const saved=normalize(JSON.stringify(c));expect(getBackgroundLoad(saved.features.background,false)).toEqual({effect:"left",duration:3.5});
 expect(getBackgroundLoad(saved.features.background,true)).toEqual({effect:"zoom",duration:0});
 for(const {value} of backgroundLoadEffects){c.features.background.mobileLoadEffect=value;expect(validate(c)).toBe("");}
 expect(getBackgroundLoad({},true)).toEqual({effect:"center",duration:1.2});
});
it("rejects invalid config and guards runtime values",()=>{
 for(const value of [-1,10.01,NaN,Infinity,"3",null])expect(()=>validateBackgroundLoad({desktopLoadDuration:value})).toThrow();
 for(const value of [0,1.2,10])expect(()=>validateBackgroundLoad({mobileLoadDuration:value})).not.toThrow();
 expect(()=>validateBackgroundLoad({mobileLoadEffect:"unknown"})).toThrow();
 expect(getBackgroundLoad({desktopLoadEffect:"bad",desktopLoadDuration:-1},false)).toEqual({effect:"center",duration:1.2});
});
