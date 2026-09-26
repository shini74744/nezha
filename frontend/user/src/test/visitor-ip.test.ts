import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {FeatureScope} from "@/appearance/scope";
import {visitorIP} from "@/appearance/modules/visitorIP";
import {defaults,normalize,validate} from "@/appearance/config";
let scope:FeatureScope,c:any,requests:string[];
const full={ip:"203.0.113.9",country:"Japan",city:"Tokyo",asn:"AS64500",org:"AS64500 Example Net"};
beforeEach(()=>{
 vi.useFakeTimers();localStorage.clear();requests=[];scope=new FeatureScope("visitorIP");c={...defaults().features.visitorIP,ipApiUrls:["https://ip.test/json"],fallbackUrl:"https://fallback.test/json",queryTimeout:500,fallbackTimeout:600,checkTimeout:700,switchTimeout:800,checkNodes:[{name:"First",url:"https://one.test/ping"},{name:"Second",url:"https://two.test/ping"},{name:"Third",url:"https://three.test/ping"}]};
 vi.spyOn(document,"readyState","get").mockReturnValue("complete");
 vi.spyOn(navigator,"userAgent","get").mockReturnValue("Desktop");
 vi.stubGlobal("fetch",vi.fn(async(url:any)=>{requests.push(String(url));return new Response(String(url).includes("/json")?JSON.stringify(full):null,{status:200})}));
});
afterEach(()=>{scope.dispose();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();document.body.innerHTML=""});
const tick=()=>vi.advanceTimersByTimeAsync(350);
it("migrates old settings without resetting existing values",()=>{
 const config=defaults();config.enabled=true;config.features.visitorIP={enabled:false,cacheDuration:1234,bottomThreshold:77};
 const upgraded=normalize(config);expect(upgraded.enabled).toBe(true);expect(upgraded.features.visitorIP).toMatchObject({enabled:false,cacheDuration:1234,bottomThreshold:77,queryTimeout:4000,showASN:true});
 expect(upgraded.features.visitorIP.checkNodes).toHaveLength(2);expect(validate(upgraded)).toBe("");
});
it("uses configured APIs, nodes and timeout values; cycles every node",async()=>{
 const timers=vi.spyOn(scope,"setTimeout");visitorIP(scope,c);await tick();
 expect(requests).toEqual(["https://ip.test/json","https://one.test/ping","https://two.test/ping","https://three.test/ping"]);
 expect(document.querySelector("#ip-base")?.textContent).toBe("203.0.113.9 ｜ Japan · Tokyo ｜ AS64500 Example Net");
 expect(document.querySelector("#ip-net")?.textContent).toContain("First");
 for(const name of ["Second","Third","First"]){(document.querySelector("#ip-net") as HTMLElement).click();await tick();expect(document.querySelector("#ip-net")?.textContent).toContain(name)}
 expect(timers.mock.calls.map(x=>x[1])).toEqual(expect.arrayContaining([500,700,800]));
});
it("display switches suppress region, ASN in organization, and downlink; network can be disabled",async()=>{
 c.showRegion=false;c.showASN=false;c.networkEnabled=false;c.showDownlink=false;
 visitorIP(scope,c);await tick();expect(document.querySelector("#ip-base")?.textContent).toBe("203.0.113.9 ｜ Example Net");
 expect(document.querySelector("#ip-val")?.getAttribute("title")).not.toMatch(/Japan|Tokyo|AS64500/);expect(requests).toEqual(["https://ip.test/json"]);
 scope.dispose();scope=new FeatureScope("visitorIP");c.showOrganization=false;visitorIP(scope,c);await tick();expect(document.querySelector("#ip-base")?.textContent).toBe("203.0.113.9");
});
it("uses configurable fallback and its timeout to fill missing metadata",async()=>{
 c.networkEnabled=false;
 vi.stubGlobal("fetch",vi.fn(async(url:any)=>{requests.push(String(url));return new Response(JSON.stringify(String(url).includes("fallback")?full:{ip:full.ip}),{status:200})}));
 const timers=vi.spyOn(scope,"setTimeout");visitorIP(scope,c);await tick();
 expect(requests).toEqual(["https://ip.test/json","https://fallback.test/json"]);expect(timers.mock.calls.map(x=>x[1])).toContain(600);expect(document.querySelector("#ip-base")?.textContent).toContain("AS64500");
});
it("changing API source invalidates cache; zero cache duration does not read or write",async()=>{
 c.networkEnabled=false;visitorIP(scope,c);await tick();expect(localStorage.length).toBe(1);scope.dispose();scope=new FeatureScope("visitorIP");
 c.ipApiUrls=["https://new.test/json"];vi.stubGlobal("fetch",vi.fn(()=>Promise.reject(Error("offline"))));visitorIP(scope,c);await tick();expect(document.querySelector("#ip-base")?.textContent).toBe("无法获取IP信息");
 scope.dispose();scope=new FeatureScope("visitorIP");localStorage.clear();c.cacheDuration=0;vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(full))));
 visitorIP(scope,c);await tick();expect(localStorage.length).toBe(0);
});
it("query timeout cancels slow requests and dispose removes the feature",async()=>{
 let aborted=false;c.networkEnabled=false;c.fallbackUrl="";
 vi.stubGlobal("fetch",vi.fn((_url:any,options:any)=>new Promise((_resolve,reject)=>options.signal.addEventListener("abort",()=>{aborted=true;reject(new DOMException("abort","AbortError"))}))));
 visitorIP(scope,c);await vi.advanceTimersByTimeAsync(600);expect(aborted).toBe(true);expect(document.querySelector("#ip-base")?.textContent).toBe("无法获取IP信息");scope.dispose();expect(document.querySelector("#ip-bar")).toBeNull();
});
it("mobile preserves IP/region-only display and no network probes",async()=>{
 vi.spyOn(navigator,"userAgent","get").mockReturnValue("iPhone");visitorIP(scope,c);await tick();expect(requests).toEqual(["https://ip.test/json"]);expect(document.querySelector("#ip-base")?.textContent).toBe("203.0.113.9 ｜ Japan · Tokyo");
});
it("validates bounds, empty or unsafe URLs and duplicate nodes",()=>{
 for(const patch of [{ipApiUrls:[]},{ipApiUrls:[""]},{ipApiUrls:["javascript:alert(1)"]},{fallbackUrl:"https://a:b@example.com"},{queryTimeout:10001},{queryTimeout:100.5},{checkNodes:[]},{checkNodes:[{name:" ",url:"https://ok.test"}]},{checkNodes:[{name:"A",url:"https://a.test"},{name:" A ",url:"https://b.test"}]}]){
  const config=defaults();Object.assign(config.features.visitorIP,patch);expect(validate(config)).not.toBe("");
 }
 const config=defaults();Object.assign(config.features.visitorIP,{networkEnabled:false,checkNodes:[],fallbackUrl:""});expect(validate(config)).toBe("");
});
