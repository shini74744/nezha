import {useState} from "react";
import {afterEach,it,expect} from "vitest";
import {cleanup,render,screen,fireEvent} from "@testing-library/react";
import {BackgroundSettings} from "@/components/background-settings";
import {defaults,validate} from "@/lib/appearance-config";
afterEach(cleanup);
function Harness(){const [c,setC]=useState(defaults);return <><BackgroundSettings value={c.features.background} sound={c.features.video} onChange={f=>setC({...c,features:{...c.features,background:f}})} onSoundChange={()=>{}}/><output data-testid="validation">{validate(c)}</output></>}
it("edits the two themes independently and validates empty and out-of-range input",()=>{
 render(<Harness/>);
 const light=screen.getByLabelText("白天模式（亮色）卡片背景不透明度") as HTMLInputElement;
 const dark=screen.getByLabelText("黑夜模式（暗色）卡片背景不透明度") as HTMLInputElement;
 const lightBlur=screen.getByLabelText("白天模式（亮色）卡片模糊（像素）") as HTMLInputElement;
 const darkBlur=screen.getByLabelText("黑夜模式（暗色）卡片模糊（像素）") as HTMLInputElement;
 fireEvent.change(light,{target:{value:"0"}});fireEvent.change(dark,{target:{value:"1"}});
 fireEvent.change(lightBlur,{target:{value:"0"}});fireEvent.change(darkBlur,{target:{value:"30"}});
 expect([light.value,dark.value,lightBlur.value,darkBlur.value]).toEqual(["0","1","0","30"]);
 expect(screen.getByTestId("validation").textContent).toBe("");
 fireEvent.change(light,{target:{value:""}});expect(light.value).toBe("");expect(screen.getByTestId("validation").textContent).not.toBe("");
 fireEvent.change(light,{target:{value:"1.1"}});expect(screen.getByTestId("validation").textContent).not.toBe("");
 fireEvent.change(light,{target:{value:"0.4"}});expect(screen.getByTestId("validation").textContent).toBe("");
 expect(dark.value).toBe("1");
});
