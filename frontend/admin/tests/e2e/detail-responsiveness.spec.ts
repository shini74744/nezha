import {expect,test,type Page} from "@playwright/test"
import {createServer} from "../../../user/src/test/fixtures"
import manifest from "../../../user/src/appearance/manifest.json" with {type:"json"}
test.use({ignoreHTTPSErrors:true})
async function setup(page:Page,theme:string,effects:boolean,combined=false) {
 const origin="https://127.0.0.1:"+(theme==="default"?"18477":"18478"), now=Date.now()
 const servers=Array.from({length:119},(_,i)=>createServer({id:i+1,name:"响应测试节点 "+(i+1),country_code:"hk",last_active:new Date(now).toISOString()}))
 const appearance={version:1,enabled:effects,features:Object.fromEntries(manifest.map(d=>[d.key,{...d.defaults,enabled:!["live2d","analytics","visitorIP","footerIP"].includes(d.key)}]))}
 const monitors=Array.from({length:18},(_,i)=>({monitor_id:i+1,monitor_name:"监控 "+i,display_index:0,server_id:7,server_name:servers[6].name,
  created_at:Array.from({length:1440},(_,j)=>now-(1440-j)*60000),avg_delay:Array.from({length:1440},(_,j)=>80+i*10+Math.sin(j)*20),packet_loss:Array(1440).fill(0)}))
 const topology={family:"IPv4",status:"ok",total:322,source:"RIPE RIS",paths:Array.from({length:24},(_,i)=>({origin:{asn:4760,name:"Origin"},direct:{asn:3491,name:"Transit"},second:{asn:1299+i,name:"Peer "+i},count:30-i}))}
 const state={reads:{} as Record<string,number>,posts:[] as string[],tick:()=>{}}
 await page.addInitScript(()=>{localStorage.setItem("language","zh-CN");localStorage.setItem("vite-ui-theme","light");localStorage.setItem("doraemon-ui-theme","light")})
 await page.routeWebSocket("**/api/v1/ws/server",ws=>{let frame=0;state.tick=()=>{const at=now+frame++*1000;ws.send(JSON.stringify({now:at,servers:servers.map(s=>({...s,last_active:new Date(at).toISOString(),state:{...s.state,cpu:12+frame%30}})),online:119}))};state.tick()})
 await page.route("**/*",async route=>{
  const req=route.request(),u=new URL(req.url())
  if(u.origin!==origin)return route.abort()
  if(!u.pathname.startsWith("/api/"))return route.continue()
  state.reads[u.pathname]=(state.reads[u.pathname]||0)+1
  if(req.method()==="POST")state.posts.push(u.pathname)
  let data:any=[]
  if(u.pathname==="/api/v1/setting")data={tsdb_enabled:true,config:{language:"zh-CN",site_name:"响应测试",show_network_in_detail:combined,appearance_config:JSON.stringify(appearance),doraemon_appearance_config:JSON.stringify(appearance),custom_code:""}}
  else if(u.pathname==="/api/v1/profile")return route.fulfill({status:401,json:{success:false}})
  else if(u.pathname==="/api/v1/service")data={services:{},cycle_transfer_stats:{}}
  else if(/server\/\d+\/service$/.test(u.pathname))data=monitors
  else if(u.pathname.endsWith("/bgp"))data={server_id:7,online:true,can_run:false,state:"complete",available_families:["IPv4"],topologies:[topology],finished_at:now,history:[]}
  else if(u.pathname.endsWith("/streaming"))data={server_id:7,online:true,can_run:false,state:"complete",results:["netflix","youtube","disneyplus","bbc","tvb","spotify"].map(id=>({id,name:id,family:"IPv4",status:"unlocked",region:"HK"}))}
  else if(u.pathname.endsWith("/connectivity"))data={server_id:7,state:"complete",online:true,can_run:false,rounds:3,results:[],groups:[]}
  else if(u.pathname.endsWith("/metrics"))data={data_points:[]}
  return route.fulfill({json:{success:true,data}})
 })
 await page.goto(origin+"/server/7")
 return state
}
for(const theme of ["default","doraemon"])for(const effects of [false,true])test("dense rapid detail response "+theme+" effects="+effects,async({page},info)=>{
 test.setTimeout(90000)
 await page.setViewportSize({width:1440,height:950})
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message))
 const cdp=await page.context().newCDPSession(page)
 await cdp.send("Emulation.setCPUThrottlingRate",{rate:4})
 const state=await setup(page,theme,effects)
 const tabs=page.locator(".server-info-tab")
 await expect(page.locator(".server-charts [data-chart]")).toHaveCount(6,{timeout:15000})
 const times:any[]=[]
 await cdp.send("Profiler.enable");await cdp.send("Profiler.start")
 for(const label of ["网络","BGP","流媒体","连通性","详情","网络","BGP","流媒体","详情"]) {
  const tab=tabs.getByRole("button",{name:label,exact:true})
  const result=await tab.evaluate(async el=>{
   const start=performance.now();(el as HTMLElement).click()
   await new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())))
   return {paint:performance.now()-start,pressed:el.getAttribute("aria-pressed")}
  })
  await expect(tab).toHaveAttribute("aria-pressed","true")
  if(label==="网络")await expect(page.locator("[data-server-network] .recharts-line-curve")).toHaveCount(18)
  if(label==="详情")await expect(page.locator(".server-charts [data-chart]")).toHaveCount(6,{timeout:15000})
  if(label==="BGP")await expect(page.locator("[data-bgp-graph]")).toBeVisible()
  if(label==="流媒体")await expect(page.locator("[data-media-card]")).toHaveCount(6,{timeout:15000})
  times.push({label,...result});state.tick()
 }
 const {profile}=await cdp.send("Profiler.stop")
 await info.attach("cpu-profile",{body:JSON.stringify(profile),contentType:"application/json"})
 const hits=new Map<number,number>();for(const id of profile.samples||[])hits.set(id,(hits.get(id)||0)+1)
 const hot=profile.nodes.map((n:any)=>({name:n.callFrame.functionName,url:n.callFrame.url,hits:hits.get(n.id)||0})).sort((a:any,b:any)=>b.hits-a.hits).slice(0,20)
 console.log("DENSE_RESPONSE",JSON.stringify({theme,effects,times,hot}))
 // Separate event turns model a user clicking before the previous pane finishes.
 await page.evaluate(async()=>{
  for(const label of ["网络","BGP","详情","连通性","流媒体","网络","BGP"]) {
   const button=[...document.querySelectorAll<HTMLElement>(".server-info-tab [role=button]")].find(e=>e.textContent===label)!
   button.click();await new Promise(r=>setTimeout(r,25))
  }
 })
 await expect(tabs.getByRole("button",{name:"BGP",exact:true})).toHaveAttribute("aria-pressed","true")
 await expect(page.locator("[data-bgp-graph]")).toBeVisible()
 await expect(page.locator(".server-charts:visible")).toHaveCount(0)
 await expect(page.locator("[data-server-network]:visible")).toHaveCount(0)
 await expect(page.locator("[data-media-card]:visible")).toHaveCount(0)
 expect(times.every(t=>t.pressed==="true")).toBe(true)
 expect(times[5].paint).toBeLessThan(1500) // Warm network re-entry used to block for over 2 s at 4x CPU.
 expect(errors).toEqual([]);expect(state.posts).toEqual([])
 await page.screenshot({path:info.outputPath("rapid-final.png")})
})

for(const theme of ["default","doraemon"])for(const width of [390,1440])test("card entry and immediate tab change "+theme+" "+width,async({page},info)=>{
 test.setTimeout(60000)
 await page.setViewportSize({width,height:900})
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message))
 const state=await setup(page,theme,false,true)
 const origin=new URL(page.url()).origin
 await page.goto(origin)
 const card=theme==="doraemon" ? page.getByRole("link",{name:"查看服务器 响应测试节点 7",exact:true}) : page.getByText("响应测试节点 7",{exact:true}).first()
 await card.scrollIntoViewIfNeeded()
 const timing=await card.evaluate(async el=>{
  const started=performance.now();(el as HTMLElement).click()
  await new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())))
  return performance.now()-started
 })
 await expect(page).toHaveURL(/\/server\/7$/)
 const tabs=page.locator(".server-info-tab")
 // Interact without waiting for detail/network charts to finish mounting.
 await tabs.getByRole("button",{name:"BGP",exact:true}).click()
 await tabs.getByRole("button",{name:"流媒体",exact:true}).click()
 await tabs.getByRole("button",{name:"BGP",exact:true}).click()
 await expect(page.locator("[data-bgp-graph]")).toBeVisible()
 await expect(tabs.getByRole("button",{name:"BGP",exact:true})).toHaveAttribute("aria-pressed","true")
 await expect(tabs.getByRole("button",{name:"网络",exact:true})).toHaveCount(0)
 await expect(page.locator("[data-server-network]:visible")).toHaveCount(0)
 await tabs.getByRole("button",{name:"详情",exact:true}).click()
 await expect(page.locator(".server-charts [data-chart]")).toHaveCount(6,{timeout:15000})
 await expect(page.locator("[data-server-network] .recharts-line-curve")).toHaveCount(18,{timeout:15000})
 await expect(page.locator("[data-bgp-graph]")).toHaveCount(0)
 console.log("CARD_ENTRY",JSON.stringify({theme,width,firstPaint:timing}))
 await page.screenshot({path:info.outputPath("card-entry.png")})
 expect(errors).toEqual([]);expect(state.posts).toEqual([])
})

for(const theme of ["default","doraemon"])test("live updates do not starve rapid tabs "+theme,async({page})=>{
 test.setTimeout(60000)
 await page.setViewportSize({width:390,height:900})
 const state=await setup(page,theme,false)
 const timer=setInterval(()=>state.tick(),250)
 try {
  const tabs=page.locator(".server-info-tab")
  await tabs.getByRole("button",{name:"网络",exact:true}).click()
  await expect(page.locator("[data-server-network] .recharts-line-curve")).toHaveCount(18,{timeout:15000})
  for(const label of ["BGP","详情","网络","流媒体","BGP"])await tabs.getByRole("button",{name:label,exact:true}).click()
  await expect(page.locator("[data-bgp-graph]")).toBeVisible()
  await expect(tabs.getByRole("button",{name:"BGP",exact:true})).toHaveAttribute("aria-pressed","true")
  const monitorReads=state.reads["/api/v1/server/7/service"]||0
  await page.waitForTimeout(11000) // Observe a complete monitor polling interval while its pane is absent.
  expect(state.reads["/api/v1/server/7/service"]||0).toBe(monitorReads)
  await tabs.getByRole("button",{name:"详情",exact:true}).click()
  await expect(page.locator(".server-charts [data-chart]")).toHaveCount(6,{timeout:15000})
 } finally {clearInterval(timer)}
 expect(state.posts).toEqual([])
})

for(const theme of ["default","doraemon"])test("detail tabs respect reduced motion "+theme,async({page})=>{
 await page.emulateMedia({reducedMotion:"reduce"})
 await setup(page,theme,false)
 await page.locator(".server-info-tab").getByRole("button",{name:"BGP",exact:true}).click()
 await expect(page.locator("[data-bgp-graph]")).toBeVisible()
 expect(await page.locator(".server-info-tab .active-indicator-fade-in").evaluate(el=>getComputedStyle(el).transitionProperty)).toBe("none")
})
