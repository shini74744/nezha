import {useState} from "react";
import {afterEach,it,expect} from "vitest";
import {cleanup,render,screen,fireEvent} from "@testing-library/react";
import {SakanaCharacters} from "@/components/sakana-characters";
import {defaults,type Feature} from "@/lib/appearance-config";
afterEach(cleanup);
function Harness(){const [f,setF]=useState<Feature>(()=>({...defaults().features.live2d,character:"custom-plane",customCharacters:[{id:"custom-plane",name:"飞机",imageUrl:"https://example.test/plane.png",scale:125},{id:"custom-cat",name:"猫",imageUrl:"https://example.test/cat.png",scale:80}]}));return <><SakanaCharacters value={f} onChange={setF}/><output data-testid="state">{JSON.stringify(f)}</output></>}
it("starts collapsed and retains edits when collapsing or switching characters",()=>{
 render(<Harness/>);const before=screen.getByTestId("state").textContent;
 expect(screen.queryByLabelText("自定义角色名称 1")).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"飞机默认角色"}));
 expect((screen.getByLabelText("自定义角色缩放 1") as HTMLInputElement).value).toBe("125");
 expect(screen.getByTestId("state").textContent).toBe(before);
 fireEvent.change(screen.getByLabelText("自定义角色名称 1"),{target:{value:"新飞机"}});
 fireEvent.click(screen.getByRole("button",{name:"猫"}));
 expect(screen.queryByLabelText("自定义角色名称 1")).toBeNull();
 expect((screen.getByLabelText("自定义角色缩放 2") as HTMLInputElement).value).toBe("80");
 fireEvent.click(screen.getByRole("button",{name:"新飞机默认角色"}));
 expect((screen.getByLabelText("自定义角色名称 1") as HTMLInputElement).value).toBe("新飞机");
 fireEvent.click(screen.getByRole("button",{name:"新飞机默认角色"}));
 expect(screen.queryByLabelText("自定义角色名称 1")).toBeNull();
});
it("opens new characters and deletion preserves other characters and default fallback",()=>{
 render(<Harness/>);fireEvent.click(screen.getByRole("button",{name:"添加自定义角色"}));
 expect(screen.getByLabelText("自定义角色名称 3")).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:"飞机默认角色"}));
 fireEvent.click(screen.getByRole("button",{name:"删除自定义角色 1"}));
 const value=JSON.parse(screen.getByTestId("state").textContent!);
 expect(value.character).toBe("chisato");expect(value.customCharacters).toHaveLength(2);
 expect(value.customCharacters[0]).toMatchObject({id:"custom-cat",scale:80});
});
