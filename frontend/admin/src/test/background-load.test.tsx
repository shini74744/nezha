import {useState} from "react";
import {afterEach,it,expect} from "vitest";
import {cleanup,render,screen,fireEvent} from "@testing-library/react";
import {BackgroundSettings} from "@/components/background-settings";
import {defaults,normalize,validate} from "@/lib/appearance-config";
import {backgroundLoadEffects,getBackgroundLoad} from "@/lib/background-load";
afterEach(cleanup);
function Harness(){const [c,setC]=useState(defaults);return <><BackgroundSettings value={c.features.background} sound={c.features.video} onChange={f=>setC({...c,features:{...c.features,background:f}})} onSoundChange={()=>{}}/><output data-testid="validation">{validate(c)}</output><output data-testid="json">{JSON.stringify(c)}</output></>}
it("edits and roundtrips independent device effects and durations",()=>{
 render(<Harness/>);
 fireEvent.click(screen.getByRole("button",{name:"载入效果"}));
 const desktop=screen.getByLabelText("电脑载入效果"),mobile=screen.getByLabelText("手机载入效果");
 const duration=screen.getByLabelText("电脑载入时长（秒）") as HTMLInputElement;
 fireEvent.change(desktop,{target:{value:"left"}});fireEvent.change(duration,{target:{value:"4.5"}});
 fireEvent.change(mobile,{target:{value:"zoom"}});
 fireEvent.change(screen.getByLabelText("手机载入时长（秒）"),{target:{value:"0.8"}});
 const saved=normalize(screen.getByTestId("json").textContent!);
 expect(getBackgroundLoad(saved.features.background,false)).toEqual({effect:"left",duration:4.5});
 expect(getBackgroundLoad(saved.features.background,true)).toEqual({effect:"zoom",duration:0.8});
 fireEvent.change(desktop,{target:{value:"none"}});expect(duration.disabled).toBe(true);
 fireEvent.change(desktop,{target:{value:"fade"}});expect(duration.disabled).toBe(false);expect(duration.value).toBe("4.5");
 for(const value of ["","-1","10.1"]){fireEvent.change(duration,{target:{value}});expect(screen.getByTestId("validation").textContent).not.toBe("");}
 for(const value of ["0","10"]){fireEvent.change(duration,{target:{value}});expect(screen.getByTestId("validation").textContent).toBe("");}
});
it("accepts all effects, rejects unknown ones and preserves legacy defaults",()=>{
 const c=defaults();for(const {value} of backgroundLoadEffects){c.features.background.desktopLoadEffect=value;expect(validate(c)).toBe("");}
 c.features.background.mobileLoadEffect="bad";expect(validate(c)).not.toBe("");
 delete c.features.background.desktopLoadEffect;delete c.features.background.mobileLoadEffect;
 delete c.features.background.desktopLoadDuration;delete c.features.background.mobileLoadDuration;
 const old=normalize(JSON.stringify(c));expect(getBackgroundLoad(old.features.background,true)).toEqual({effect:"center",duration:1.2});
 expect(getBackgroundLoad(old.features.background,false)).toEqual({effect:"center",duration:1.2});
});
