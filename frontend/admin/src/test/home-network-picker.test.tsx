import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { HomeNetworkPicker } from "@/components/home-network-picker"
const api = vi.hoisted(() => ({ get:vi.fn(), set:vi.fn() }))
vi.mock("@/api/server", () => ({getHomeNetwork:api.get,setHomeNetwork:api.set}))
vi.mock("sonner", () => ({toast:{success:vi.fn(),error:vi.fn()}}))
beforeEach(()=>{api.get.mockReset().mockResolvedValue({interfaces:["ens18"]});api.set.mockReset().mockImplementation((_id,interfaces)=>Promise.resolve({interfaces}))})
const inventory={available:true,interfaces:["ens18","wg0"].map(name=>({name,kind:"virtual",state:"up",default_monitored:true,monitored:true}))}
it("loads saved multi selection, preserves dirty draft on inventory refresh and saves only display scope",async()=>{
 const r=render(<HomeNetworkPicker sid={19} inventory={inventory}/>)
 await waitFor(()=>expect(screen.getByLabelText("首页统计 ens18").getAttribute("aria-checked")).toBe("true"))
 fireEvent.click(screen.getByText(/首页显示网卡/))
 fireEvent.click(screen.getByLabelText("首页统计 wg0"))
 r.rerender(<HomeNetworkPicker sid={19} inventory={{...inventory,interfaces:inventory.interfaces.slice(0,1)}}/>)
 expect(screen.getByLabelText("首页统计 wg0").getAttribute("aria-checked")).toBe("true")
 fireEvent.click(screen.getByRole("button",{name:"保存首页设置"}))
 await waitFor(()=>expect(api.set).toHaveBeenCalledWith(19,["ens18","wg0"]))
 fireEvent.click(screen.getByRole("button",{name:"全部"}))
 fireEvent.click(screen.getByRole("button",{name:"保存首页设置"}))
 await waitFor(()=>expect(api.set).toHaveBeenLastCalledWith(19,[]))
})
it("does not turn a read failure into an editable default",async()=>{
 api.get.mockRejectedValueOnce(new Error("offline"));render(<HomeNetworkPicker sid={19}/>)
 await waitFor(()=>expect(screen.getByText(/暂时无法读取首页设置/)).not.toBeNull())
 expect(api.set).not.toHaveBeenCalled();expect(screen.queryByRole("button",{name:"保存首页设置"})).toBeNull()
})
