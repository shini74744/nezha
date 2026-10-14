import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {useState} from "react";
import NetworkCardSettings from "@/components/NetworkCardSettings";
afterEach(cleanup);
it("separates collapsed controls, default slider, and independent visibility",()=>{
 const changed=vi.fn();
 function Fixture(){const [s,set]=useState<any>({network_display_mode:"both",network_default_view:"connectivity",connectivity_disabled:false,connectivity_local_only:false});return <NetworkCardSettings mode={s.network_display_mode} defaultView={s.network_default_view} disabled={s.connectivity_disabled} localOnly={s.connectivity_local_only} onChange={v=>{set(v);changed(v)}}/>}
 render(<Fixture/>);
 expect(screen.queryByRole("radio")).toBeNull();
 fireEvent.click(screen.getByRole("switch",{name:"默认显示延迟"}));
 expect(changed.mock.lastCall?.[0].network_default_view).toBe("latency");
 fireEvent.click(screen.getByRole("button",{name:/连通性设置/}));
 fireEvent.click(screen.getByRole("radio",{name:"仅本地"}));
 expect(changed.mock.lastCall?.[0]).toMatchObject({connectivity_disabled:true,connectivity_local_only:true,network_display_mode:"both"});
 fireEvent.click(screen.getByRole("radio",{name:"隐藏"}));
 expect(changed.mock.lastCall?.[0]).toMatchObject({network_display_mode:"latency",network_default_view:"latency"});
 expect((screen.getByRole("switch",{name:"默认显示延迟"}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole("button",{name:/延迟设置/}));
 fireEvent.click(screen.getByRole("radio",{name:"隐藏"}));
 expect(changed.mock.lastCall?.[0].network_display_mode).toBe("hidden");
 fireEvent.click(screen.getByRole("button",{name:/连通性设置/}));
 fireEvent.click(screen.getByRole("radio",{name:"服务器＋本地"}));
 expect(changed.mock.lastCall?.[0]).toMatchObject({network_display_mode:"connectivity",network_default_view:"connectivity",connectivity_disabled:false,connectivity_local_only:false});
});
