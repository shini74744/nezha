import { act, render, renderHook, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { StrictMode, useState, type ReactNode } from "react";
import { WebSocketProvider } from "@/context/websocket-provider";
import { useWebSocketContext } from "@/hooks/use-websocket-context";

class Socket {
 static OPEN=1; static CONNECTING=0; static instances:Socket[]=[]; static fail=0;
 readyState=0; onopen:(()=>void)|null=null; onclose:(()=>void)|null=null;
 onerror:(()=>void)|null=null; onmessage:((e:{data:string})=>void)|null=null;
 constructor(public url:string){if(Socket.fail-->0)throw new Error("constructor failed");Socket.instances.push(this)}
 open(){this.readyState=1;this.onopen?.()}
 close(){this.readyState=3;this.onclose?.()}
 sendFrame(now=1){this.onmessage?.({data:JSON.stringify({now,servers:[]})})}
}
beforeEach(()=>{Socket.instances=[];Socket.fail=0;vi.useFakeTimers();vi.stubGlobal("WebSocket",Socket);vi.spyOn(console,"error").mockImplementation(()=>{})});
function mount(strict=false) {
 return renderHook(()=>useWebSocketContext(),{wrapper:({children}:{children:ReactNode})=>strict?
  <StrictMode><WebSocketProvider url="/api/v1/ws/server">{children}</WebSocketProvider></StrictMode>:
  <WebSocketProvider url="/api/v1/ws/server">{children}</WebSocketProvider>});
}
it("recovers from constructor exceptions",()=>{
 Socket.fail=1;const view=mount();expect(Socket.instances).toHaveLength(0);
 act(()=>vi.advanceTimersByTime(3000));expect(Socket.instances).toHaveLength(1);
 act(()=>Socket.instances[0].open());expect(view.result.current.connected).toBe(true);
});
it("StrictMode and replacing a connecting socket do not leave the connection guard stuck",()=>{
 const view=mount(true);const count=Socket.instances.length;expect(count).toBeGreaterThanOrEqual(1);
 act(()=>view.result.current.reconnect());act(()=>vi.advanceTimersByTime(1000));
 expect(Socket.instances).toHaveLength(count+1);expect(Socket.instances[count-1].readyState).toBe(3);
 act(()=>Socket.instances[count].open());expect(view.result.current.connected).toBe(true);
});
it("coalesces manual retries and removes timers on unmount",()=>{
 const view=mount();act(()=>{view.result.current.reconnect();view.result.current.reconnect()});
 act(()=>vi.advanceTimersByTime(1000));expect(Socket.instances).toHaveLength(2);
 act(()=>view.result.current.reconnect());view.unmount();act(()=>vi.advanceTimersByTime(60000));
 expect(Socket.instances).toHaveLength(2);
 act(()=>{window.dispatchEvent(new Event("online"));window.dispatchEvent(new Event("focus"))});
 expect(Socket.instances).toHaveLength(2);
});
it("schedules one retry on error and close while preserving last data",()=>{
 const view=mount();const first=Socket.instances[0];
 act(()=>{first.open();first.sendFrame(22);first.onerror?.();first.close()});
 expect(view.result.current.lastData?.now).toBe(22);expect(view.result.current.connected).toBe(false);
 act(()=>vi.advanceTimersByTime(3000));expect(Socket.instances).toHaveLength(2);
});
it("recovers after retry exhaustion on focus/online without creating duplicate sockets",()=>{
 const view=mount();
 for(let i=0;i<30;i++)act(()=>{Socket.instances[Socket.instances.length-1].close();vi.advanceTimersByTime(3000)});
 act(()=>Socket.instances[Socket.instances.length-1].close());
 expect(Socket.instances).toHaveLength(31);act(()=>vi.advanceTimersByTime(100000));expect(Socket.instances).toHaveLength(31);
 act(()=>{window.dispatchEvent(new Event("online"));window.dispatchEvent(new Event("focus"))});
 expect(Socket.instances).toHaveLength(32);
 act(()=>Socket.instances[Socket.instances.length-1].open());
 act(()=>{window.dispatchEvent(new Event("focus"));window.dispatchEvent(new Event("online"))});
 expect(Socket.instances).toHaveLength(32);expect(view.result.current.connected).toBe(true);
});
it("resumes from bfcache and ignores events from a replaced socket",()=>{
 const view=mount();const first=Socket.instances[0];const stale=first.onmessage;
 act(()=>{first.open();first.sendFrame(1);window.dispatchEvent(new Event("pagehide"))});
 expect(view.result.current.connected).toBe(false);
 act(()=>window.dispatchEvent(new Event("pageshow")));expect(Socket.instances).toHaveLength(2);
 act(()=>{Socket.instances[1].open();Socket.instances[1].sendFrame(2);stale?.({data:JSON.stringify({now:999,servers:[]})})});
 expect(view.result.current.lastData?.now).toBe(2);
});
it("does not disconnect when beforeunload is cancelled",()=>{
 const view=mount();act(()=>{Socket.instances[0].open();window.dispatchEvent(new Event("beforeunload",{cancelable:true}))});
 expect(view.result.current.connected).toBe(true);expect(Socket.instances).toHaveLength(1);
});

it("changing authenticated identity reconnects and clears the old snapshot without unmounting the app",()=>{
 let mounts=0;
 function Probe(){useState(()=>{mounts++;return 0});const c=useWebSocketContext();return <p data-testid="now">{c.lastData?.now??"empty"}</p>}
 const view=render(<WebSocketProvider url="/api/v1/ws/server" viewerId={1}><Probe/></WebSocketProvider>);
 act(()=>{Socket.instances[0].open();Socket.instances[0].sendFrame(1)});
 expect(screen.getByTestId("now")).toHaveTextContent("1");
 view.rerender(<WebSocketProvider url="/api/v1/ws/server" viewerId={0}><Probe/></WebSocketProvider>);
 expect(screen.getByTestId("now")).toHaveTextContent("empty");expect(Socket.instances).toHaveLength(2);
 expect(Socket.instances[0].readyState).toBe(3);expect(mounts).toBe(1);
 act(()=>{Socket.instances[1].open();Socket.instances[1].sendFrame(2)});
 expect(screen.getByTestId("now")).toHaveTextContent("2");
});
