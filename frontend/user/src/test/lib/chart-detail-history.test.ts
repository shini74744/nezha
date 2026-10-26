import {describe,it,expect,vi} from "vitest";
import {loadDetailHistory} from "@/lib/chart-detail-history";
import {fetchServerMetrics} from "@/lib/nezha-api";
vi.mock("@/lib/nezha-api",()=>({fetchServerMetrics:vi.fn()}));
describe("detailed history data",()=>{
 it("merges timestamps, scales units and keeps missing series distinct from zero",async()=>{
  vi.mocked(fetchServerMetrics).mockResolvedValueOnce({success:true,data:{data_points:[{ts:1000,value:0},{ts:2000,value:100}]}} as any)
   .mockResolvedValueOnce({success:true,data:{data_points:[{ts:2000,value:50},{ts:3000,value:0}]}} as any);
  const signal=new AbortController().signal;
  expect(await loadDetailHistory({serverId:7,metrics:[{metric:"memory",key:"mem",scale:0.1},{metric:"swap",key:"swap",scale:0.2}]},signal))
   .toEqual([{ts:1000,mem:0,swap:null},{ts:2000,mem:10,swap:10},{ts:3000,mem:null,swap:0}]);
  expect(fetchServerMetrics).toHaveBeenCalledWith(7,"memory","1d",signal);
 });
 it("rejects partial errors and unsuccessful envelopes",async()=>{
  vi.mocked(fetchServerMetrics).mockResolvedValueOnce({success:true,data:{data_points:[]}} as any).mockRejectedValueOnce(new Error("offline"));
  await expect(loadDetailHistory({serverId:7,metrics:[{metric:"cpu",key:"cpu"},{metric:"swap",key:"swap"}]},new AbortController().signal)).rejects.toThrow("offline");
  vi.mocked(fetchServerMetrics).mockResolvedValueOnce({success:false,data:{data_points:[]}} as any);
  await expect(loadDetailHistory({serverId:7,metrics:[{metric:"cpu",key:"cpu"}]},new AbortController().signal)).rejects.toThrow();
 });
});
