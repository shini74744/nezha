import { describe, it, expect } from "vitest";
import { createServer } from "@/test/fixtures";
import { homeNetworkServer } from "@/lib/home-network";
import { networkRate, networkHistoricalPoints } from "@/lib/network-interface-rates";
describe("homepage scope",()=>{
 it("projects only homepage metrics without mutating source and preserves default",()=>{
  const server=createServer({state:{net_out_speed:999,net_in_speed:888,net_out_transfer:777,net_in_transfer:666}});
  expect(homeNetworkServer(server)).toBe(server);
  server.home_network={interfaces:["ens18","wg0"],in_speed:10,out_speed:20,in_transfer:100,out_transfer:200,rates_available:true,counters_available:true};
  expect(homeNetworkServer(server).state.net_out_speed).toBe(20);
  expect(homeNetworkServer(server).state.net_in_transfer).toBe(100);
  expect(server.state.net_out_speed).toBe(999);
  server.home_network.rates_available=false;
  expect(Number.isNaN(homeNetworkServer(server).state.net_out_speed)).toBe(true);
 });
 it("deduplicates live multi-selection and leaves missing NICs as gaps",()=>{
  const s=createServer({state:{network_interfaces:[{name:"a",in_speed:10,out_speed:20,available:true},{name:"b",in_speed:30,out_speed:40,available:true}]}});
  expect(networkRate(s,["a","b","a"])).toEqual({upload:60,download:40});
  expect(networkRate(s,["a","gone"])).toEqual({upload:null,download:null});
 });
 it("historical sums require complete timestamp alignment across every selected NIC",()=>{
  const series=[[{ts:1000,value:1024**2}],[{ts:1000,value:0}],[{ts:1000,value:2*1024**2}],[{ts:2000,value:3*1024**2}]];
  expect(networkHistoricalPoints(series)).toEqual([{timeStamp:"1000",upload:3,download:null},{timeStamp:"2000",upload:null,download:null}]);
 });
});
