import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ServerPlanTraffic, { ServerPlanTrafficCard, fetchServerPlanTraffic, validPlanTraffic, type ServerPlanTrafficStat } from "@/components/ServerPlanTraffic";
import { createServer } from "@/test/fixtures";
import { renderWithProviders as renderWithQuery } from "@/test/utils";
const stat: ServerPlanTrafficStat = {quota_type:"limited",max:1024,used:1200,in:500,out:700,direction:"2",reset_day:15,from:"2026-09-15T00:00:00+08:00",to:"2026-10-15T00:00:00+08:00"};
describe("server-owned cycle traffic",()=>{
 it.each(["1","2","3"])("shows the server cycle, both counters and direction %s",direction=>{
  render(<ServerPlanTrafficCard server={createServer({name:"Node"})} stat={{...stat,direction}}/>);
  expect(screen.getByText("statistics.cycleDirection"+direction)).toBeInTheDocument();
  expect(screen.getByText(/09\/15\/2026/)).toBeInTheDocument();
  expect(screen.getByText("statistics.cycleUpload")).toBeInTheDocument();
  expect(screen.getByText("statistics.cycleDownload")).toBeInTheDocument();
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow","100");
  expect(screen.getByText("117.2%")).toBeInTheDocument();
 });
 it.each(["unlimited","unset"] as const)("shows %s distinctly, without an invented quota percentage",quota_type=>{
  render(<ServerPlanTrafficCard server={createServer()} stat={{...stat,max:0,quota_type}}/>);
  expect(screen.getByText("statistics."+(quota_type==="unlimited"?"cycleUnlimited":"cycleUnset"), {exact:false})).toBeInTheDocument();
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  const bar=screen.getByRole("img");
  expect(bar).toHaveAttribute("data-cycle-flow-bar",quota_type);
  expect(bar).toHaveAccessibleName(new RegExp("statistics."+(quota_type==="unlimited"?"cycleUnlimited":"cycleUnset")));
  expect(bar).not.toHaveAttribute("aria-valuenow");
  expect(document.querySelector(".cycle-traffic-percent")).toBeNull();
  expect(bar.compareDocumentPosition(document.querySelector("dl")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 });
 it("does not present missing or invalid rows as zero or unlimited",()=>{
  const {rerender}=render(<ServerPlanTrafficCard server={createServer()}/>);
  expect(screen.getByText("statistics.cycleUnavailable")).toBeInTheDocument();
  rerender(<ServerPlanTrafficCard server={createServer()} stat={{...stat,error:"bad config"}}/>);
  expect(screen.getByText("statistics.cycleConfigError")).toBeInTheDocument();
  expect(document.querySelector("[data-cycle-flow-bar]")).toBeNull();
  expect(validPlanTraffic({...stat,in:NaN})).toBe(false);
  expect(validPlanTraffic({...stat,to:stat.from})).toBe(false);
  expect(validPlanTraffic({...stat,quota_type:"limited",max:0})).toBe(false);
 });
 it("marks partial and estimated historical accounting",()=>{
  render(<ServerPlanTrafficCard server={createServer()} stat={{...stat,partial:true,estimated:true}}/>);
  const note=screen.getByText(/statistics.cyclePartial/);
  expect(note).toHaveTextContent("statistics.cycleEstimated");
  expect(note.closest(".cycle-traffic-summary")).not.toBeNull();
  expect(note.compareDocumentPosition(screen.getByRole("progressbar")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(document.querySelector("dl")?.contains(note)).toBe(false);
 });
 it("requests the separate endpoint once, filters visible server IDs and closes independently",async()=>{
  const request=vi.fn().mockResolvedValue({ok:true,json:async()=>({success:true,data:{1:stat,2:stat}})});
  vi.stubGlobal("fetch",request);
  const close=vi.fn();
  renderWithQuery(<ServerPlanTraffic serverList={[createServer({id:1,name:"Allowed"})]} onClose={close}/>);
  expect(await screen.findByText("Allowed")).toBeInTheDocument();
  expect(document.querySelectorAll("[data-statistics-card=cycle]")).toHaveLength(1);
  expect(request.mock.calls[0][0]).toBe("/api/v1/server-traffic");
  expect(request).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button",{name:"statistics.close"}));expect(close).toHaveBeenCalledOnce();
 });
 it("shows retry after failure instead of fabricated data",async()=>{
  vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce({ok:false}).mockResolvedValue({ok:true,json:async()=>({success:true,data:{1:stat}})}));
  renderWithQuery(<ServerPlanTraffic serverList={[createServer({id:1,name:"Recovered"})]}/>);
  expect(await screen.findByText("statistics.error")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"statistics.retry"}));
  await waitFor(()=>expect(screen.getByText("Recovered")).toBeInTheDocument());
 });
 it.each([{success:false,data:{}},{success:true,data:[]},{success:true}])("rejects malformed API envelopes",async body=>{
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:true,json:async()=>body}));
  await expect(fetchServerPlanTraffic()).rejects.toThrow("Traffic unavailable");
 });
});
