import {expect,test,type Page} from "@playwright/test"
import {createServer} from "../../../user/src/test/fixtures"
import manifest from "../../../user/src/appearance/manifest.json" with {type:"json"}
test.use({ignoreHTTPSErrors:true})
async function setup(page:Page,theme:string,effects:boolean,combined=false,initialPath="/server/7",networkChunkDelay=0,rateBits?:boolean,secondaryDelay=0,connectivityDelay=0) {
 const origin="https://127.0.0.1:"+(theme==="default"?"18477":"18478"), now=Date.now()
 const servers=Array.from({length:119},(_,i)=>createServer({id:i+1,name:"响应测试节点 "+(i+1),country_code:"hk",last_active:new Date(now).toISOString()}))
 const appearance={version:1,enabled:effects,features:{...Object.fromEntries(manifest.map(d=>[d.key,{...d.defaults,enabled:!["live2d","analytics","visitorIP","footerIP"].includes(d.key)}])),background:{enabled:effects,desktopMedia:[{type:"image",src:origin+"/entry-wallpaper.svg"}],mobileMedia:[{type:"image",src:origin+"/entry-wallpaper.svg"}],nightEnabled:false,lightOpacity:0.82,darkOpacity:0.82}}}
 if(rateBits!==undefined){appearance.enabled=true;for(const feature of Object.values(appearance.features))feature.enabled=false;appearance.features.speed={...manifest.find(d=>d.key==="speed")!.defaults,enabled:true,cardEnabled:true,bits:rateBits}}
 const monitors=Array.from({length:18},(_,i)=>({monitor_id:i+1,monitor_name:"监控 "+i,display_index:0,server_id:7,server_name:servers[6].name,
  created_at:Array.from({length:1440},(_,j)=>now-(1440-j)*60000),avg_delay:Array.from({length:1440},(_,j)=>80+i*10+Math.sin(j)*20),packet_loss:Array(1440).fill(0)}))
 const topology={family:"IPv4",status:"ok",total:322,source:"RIPE RIS",paths:Array.from({length:24},(_,i)=>({origin:{asn:4760,name:"Origin"},direct:{asn:3491,name:"Transit"},second:{asn:1299+i,name:"Peer "+i},count:30-i}))}
 const state={reads:{} as Record<string,number>,posts:[] as string[],assets:[] as string[],networkChunkLoads:0,networkChunkReleased:false,monitorBeforeChunk:false,secondaryBeforePrimary:false,events:[] as {path:string,phase:string,at:number}[],tick:()=>{}}
 await page.addInitScript(()=>{localStorage.setItem("language","zh-CN");localStorage.setItem("vite-ui-theme","light");localStorage.setItem("doraemon-ui-theme","light")})
 await page.routeWebSocket("**/api/v1/ws/server",ws=>{let frame=0;state.tick=()=>{const at=now+frame++*1000;ws.send(JSON.stringify({now:at,servers:servers.map(s=>({...s,last_active:new Date(at).toISOString(),state:{...s.state,cpu:12+frame%30}})),online:119}))};state.tick()})
 await page.route("**/*",async route=>{
  const req=route.request(),u=new URL(req.url())
  if(u.origin!==origin)return route.abort()
  if(u.pathname==="/entry-wallpaper.svg")return route.fulfill({contentType:"image/svg+xml",body:'<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="950"><defs><linearGradient id="b"><stop stop-color="#bae6fd"/><stop offset=".5" stop-color="#d9f99d"/><stop offset="1" stop-color="#fce7f3"/></linearGradient></defs><rect width="1440" height="950" fill="url(#b)"/><path d="M0 800L1440 160M0 860L1440 220" stroke="#65a30d" stroke-width="32"/></svg>'})
  if(!u.pathname.startsWith("/api/")){
   state.assets.push(u.pathname)
   if(networkChunkDelay && /\/NetworkChart[-.][^/]+\.js$/.test(u.pathname)){
    state.networkChunkLoads++
    await new Promise(r=>setTimeout(r,networkChunkDelay))
    state.networkChunkReleased=true
   }
   if(secondaryDelay && /\/(ServerConnectivity|ServerNetworkInsight|BGPTopology)[-.][^/]+\.js$/.test(u.pathname)){
    state.events.push({path:u.pathname,phase:"module-start",at:Date.now()})
    await new Promise(r=>setTimeout(r,secondaryDelay))
    state.events.push({path:u.pathname,phase:"module-ready",at:Date.now()})
   }
   return route.continue()
  }
  state.reads[u.pathname]=(state.reads[u.pathname]||0)+1
  if(req.method()==="POST")state.posts.push(u.pathname)
  if(/\/(connectivity|bgp|streaming)$/.test(u.pathname)){
   state.secondaryBeforePrimary ||= !state.reads["/api/v1/server/7/service"]
   state.events.push({path:u.pathname,phase:"data-start",at:Date.now()})
   if(secondaryDelay)await new Promise(r=>setTimeout(r,secondaryDelay))
   if(connectivityDelay && u.pathname.endsWith("/connectivity"))await new Promise(r=>setTimeout(r,connectivityDelay))
   state.events.push({path:u.pathname,phase:"data-ready",at:Date.now()})
  }
  let data:any=[]
  if(u.pathname==="/api/v1/setting")data={tsdb_enabled:true,config:{language:"zh-CN",site_name:"响应测试",show_network_in_detail:combined,appearance_config:JSON.stringify(appearance),doraemon_appearance_config:JSON.stringify(appearance),custom_code:""}}
  else if(u.pathname==="/api/v1/profile")return route.fulfill({status:401,json:{success:false}})
  else if(u.pathname==="/api/v1/service")data={services:{},cycle_transfer_stats:{}}
  else if(/server\/\d+\/service$/.test(u.pathname)){data=monitors;state.monitorBeforeChunk ||= !state.networkChunkReleased}
  else if(u.pathname.endsWith("/bgp"))data={server_id:7,online:true,can_run:false,state:"complete",available_families:["IPv4"],topologies:[topology],finished_at:now,history:[]}
  else if(u.pathname.endsWith("/streaming"))data={server_id:7,online:true,can_run:false,state:"complete",results:["netflix","youtube","disneyplus","bbc","tvb","spotify"].map(id=>({id,name:id,family:"IPv4",status:"unlocked",region:"HK"}))}
  else if(u.pathname.endsWith("/connectivity"))data={server_id:7,state:"complete",online:true,can_run:false,rounds:3,results:[],groups:[]}
  else if(u.pathname.endsWith("/metrics"))data={data_points:[]}
  return route.fulfill({json:{success:true,data}})
 })
 await page.goto(origin+initialPath)
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
 // Diagnostic CPU sampling is opt-in; normal regression timings must not include its overhead.
 const captureProfile=process.env.DETAIL_CPU_PROFILE==="1"
 if(captureProfile){await cdp.send("Profiler.enable");await cdp.send("Profiler.start")}
 for(const label of ["网络","BGP","流媒体","连通性","详情","网络","BGP","流媒体","详情"]) {
  const tab=tabs.getByRole("button",{name:label,exact:true})
  const result=await tab.evaluate(async el=>{
   const start=performance.now();(el as HTMLElement).click()
   await new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())))
   return {paint:performance.now()-start,pressed:el.getAttribute("aria-pressed")}
  })
  await expect(tab).toHaveAttribute("aria-pressed","true")
  // Completion budget matches other dense charts under 4x CPU; input latency
  // remains independently bounded below and in the native-event tests.
  if(label==="网络")await expect(page.locator("[data-server-network] .recharts-line-curve")).toHaveCount(18,{timeout:15000}).catch(async error=>{
   if(captureProfile){
    const {profile}=await cdp.send("Profiler.stop")
    await info.attach("failed-network-profile",{body:JSON.stringify(profile),contentType:"application/json"})
    const counts=new Map<number,number>();for(const id of profile.samples||[])counts.set(id,(counts.get(id)||0)+1)
    console.log("FAILED_NETWORK_HOT",JSON.stringify(profile.nodes.map((n:any)=>({...n.callFrame,hits:counts.get(n.id)||0})).sort((a:any,b:any)=>b.hits-a.hits).slice(0,20)))
   }
   throw error
  })
  if(label==="详情")await expect(page.locator(".server-charts [data-chart]")).toHaveCount(6,{timeout:15000})
  if(label==="BGP")await expect(page.locator("[data-bgp-graph]")).toBeVisible()
  if(label==="流媒体")await expect(page.locator("[data-media-card]")).toHaveCount(6,{timeout:15000})
  times.push({label,...result});state.tick()
 }
 if(captureProfile){
  const {profile}=await cdp.send("Profiler.stop")
  await info.attach("cpu-profile",{body:JSON.stringify(profile),contentType:"application/json"})
 }
 console.log("DENSE_RESPONSE",JSON.stringify({theme,effects,times,captureProfile}))
 // Separate event turns model a user clicking before the previous pane finishes.
 await page.evaluate(async()=>{
  for(const label of ["网络","BGP","详情","连通性","流媒体","网络","BGP"]) {
   const button=[...document.querySelectorAll<HTMLElement>(".server-info-tab button")].find(e=>e.textContent===label)!
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
 expect(await page.locator(".detail-pane-enter").evaluate(el=>getComputedStyle(el).animationName)).toBe("none")
})


// Native input is sent from the browser process while the renderer is mounting
// charts. Locator.click() would wait for renderer stability and hide this stall.
for (const theme of ["default","doraemon"]) for (const delay of [0,80,200]) for (const warm of [false,true]) test("native first-entry input "+theme+" delay="+delay+" warm="+warm,async({page},info)=>{
 // Warm cases include two full visits at 4x CPU plus artifact capture; the input budget below remains 250 ms.
 test.setTimeout(90000)
 await page.setViewportSize({width:1440,height:950})
 const cdp=await page.context().newCDPSession(page)
 await cdp.send("Emulation.setCPUThrottlingRate",{rate:4})
 const state=await setup(page,theme,true,true,"/")
 const card=theme==="doraemon"?page.getByRole("link",{name:"查看服务器 响应测试节点 7",exact:true}):page.getByText("响应测试节点 7",{exact:true}).first()
 await card.scrollIntoViewIfNeeded()
 for(let i=0;i<30;i++)state.tick()
 // Drain the incoming frame burst before measuring the navigation itself.
 await page.waitForTimeout(1500)
 if(warm){
  await card.evaluate(el=>(el as HTMLElement).click())
  await expect(page.locator(".server-charts .recharts-surface")).toHaveCount(6,{timeout:20000})
  await expect(page.locator("[data-server-network] .recharts-line-curve")).toHaveCount(18,{timeout:20000})
  await page.goBack()
  await card.scrollIntoViewIfNeeded()
 }
 let sent:Promise<void>|undefined
 await page.exposeFunction("sendNativeTab",({x,y}:{x:number,y:number})=>{
  sent=(async()=>{
   await new Promise(r=>setTimeout(r,delay))
   const timestamp=Date.now()/1000
   await cdp.send("Input.dispatchMouseEvent",{type:"mousePressed",x,y,button:"left",clickCount:1,timestamp})
   await cdp.send("Input.dispatchMouseEvent",{type:"mouseReleased",x,y,button:"left",clickCount:1,timestamp:Date.now()/1000})
  })()
 })
 await page.evaluate(()=>{
  const w=window as any;w.entryMeasurements={tasks:[],input:[],paint:0}
  new PerformanceObserver(list=>{for(const e of list.getEntries())w.entryMeasurements.tasks.push({start:e.startTime,duration:e.duration})}).observe({type:"longtask"})
  document.addEventListener("pointerdown",e=>{if((e.target as Element).closest(".server-info-tab"))w.entryMeasurements.input.push({start:e.timeStamp,handled:performance.now(),delay:performance.now()-e.timeStamp})},true)
  let found=false
  const observer=new MutationObserver(()=>{
   const button=[...document.querySelectorAll<HTMLElement>(".server-info-tab button")].find(el=>el.textContent==="BGP")
   if(!button)return
   if(!found){found=true;const b=button.getBoundingClientRect();w.entryMeasurements.tabs=performance.now();void w.sendNativeTab({x:b.x+b.width/2,y:b.y+b.height/2})}
   if(button.getAttribute("aria-pressed")==="true"){observer.disconnect();requestAnimationFrame(()=>requestAnimationFrame(()=>{w.entryMeasurements.paint=performance.now()}))}
  })
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:["aria-pressed"]})
  w.entryMeasurements.start=performance.now()
 })
 // Keep CPU sampling out of the native-input latency measurement: under CPU
 // throttling the profiler itself substantially changes scheduling latency.
 await card.evaluate(el=>(el as HTMLElement).click())
 await expect(page.locator(".server-info-tab").getByRole("button",{name:"BGP",exact:true})).toHaveAttribute("aria-pressed","true",{timeout:20000})
 await sent
 // Cold module/chart completion at 4x CPU has the same budget as dense network charts.
 // Input responsiveness remains independently limited to 250 ms below.
 await expect(page.locator("[data-bgp-graph]")).toBeVisible({timeout:15000})
 const measurements=await page.evaluate(()=>(window as any).entryMeasurements)
 await info.attach("entry-measurements",{body:JSON.stringify(measurements),contentType:"application/json"})
 console.log("NATIVE_ENTRY",JSON.stringify({theme,delay,warm,...measurements}))
 expect(measurements.input).toHaveLength(1)
 expect(measurements.input[0].delay).toBeLessThan(250)
 // Screenshot encoding is not part of the measured interaction.
 await cdp.send("Emulation.setCPUThrottlingRate",{rate:1})
 await page.screenshot({path:info.outputPath("native-entry.png")})
 expect(state.posts).toEqual([])
})

for(const theme of ["default","doraemon"])for(const combined of [false,true])test("primary detail and network preload "+theme+" combined="+combined,async({page})=>{
 const state=await setup(page,theme,false,combined,"/server/7",1200)
 await expect(page.locator(".server-charts .recharts-surface")).toHaveCount(6)
 await expect.poll(()=>state.reads["/api/v1/server/7/service"]||0).toBe(1)
 expect(state.networkChunkLoads).toBe(1)
 expect(state.monitorBeforeChunk).toBe(true)
 expect(state.secondaryBeforePrimary).toBe(false)
 await expect(page.locator("[data-server-connectivity], [data-network-insight]")).toHaveCount(0)
 if(!combined){
  await expect(page.locator("[data-server-network]")).toHaveCount(0)
  await page.locator(".server-info-tab").getByRole("button",{name:"网络",exact:true}).click()
 }else{
  await expect(page.locator(".server-info-tab").getByRole("button",{name:"网络",exact:true})).toHaveCount(0)
 }
 await expect(page.locator("[data-server-network] .recharts-line-curve")).toHaveCount(18)
 expect(state.reads["/api/v1/server/7/service"]).toBe(1)
 expect(state.posts).toEqual([])
})

for(const width of [320,1440])for(const bits of [true,false])test("default detail rate units "+width+" bits="+bits,async({page},info)=>{
 await page.setViewportSize({width,height:900})
 const state=await setup(page,"default",false,false,"/server/7",0,bits)
 const charts=page.locator(".server-charts")
 await expect(charts.getByText(bits?"16.0Mbps":"2.00M/s",{exact:true})).toBeVisible()
 await expect(charts.getByText(bits?"8.00Mbps":"1.00M/s",{exact:true})).toBeVisible()
 await expect(charts.locator(".recharts-surface")).toHaveCount(6,{timeout:15000})
 const network=charts.locator("[data-chart]").nth(4)
 state.tick()
 await expect(network).toContainText(bits?"Mbps":"M/s")
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
 await network.screenshot({path:info.outputPath("detail-rate.png")})
})

for(const theme of ["default","doraemon"])test("secondary cold click timing "+theme,async({page},info)=>{
 test.setTimeout(45000)
 const state=await setup(page,theme,false,false,"/server/7",10000,undefined,700)
 const tabs=page.locator(".server-info-tab")
 await expect(tabs).toBeVisible()
 const started=Date.now()
 // Evaluate click does not secretly warm with Playwright's hover first.
 await tabs.getByRole("button",{name:"连通性",exact:true}).evaluate(el=>(el as HTMLElement).click())
 await expect(page.locator("[data-server-connectivity]")).toBeVisible()
 await expect.poll(()=>state.events.some(e=>e.path.endsWith("/connectivity")&&e.phase==="data-ready")).toBe(true)
 await expect(page.locator("[data-server-connectivity] [role=status]")).toHaveCount(0)
 const moduleReady=state.events.find(e=>e.path.includes("ServerConnectivity")&&e.phase==="module-ready")!
 const dataStart=state.events.find(e=>e.path.endsWith("/connectivity")&&e.phase==="data-start")!
 expect(dataStart.at).toBeLessThan(moduleReady.at)
 expect(state.reads["/api/v1/server/7/connectivity"]).toBe(1)
 console.log("SECONDARY_COLD_TIMING",JSON.stringify({theme,total:Date.now()-started,events:state.events}))
 expect(state.posts).toEqual([])
 await page.screenshot({path:info.outputPath("secondary-cold.png")})
})

for(const theme of ["default","doraemon"])test("secondary idle results reuse and warm tab content "+theme,async({page},info)=>{
 const state=await setup(page,theme,false,true)
 await expect(page.locator(".server-charts .recharts-surface")).toHaveCount(6)
 await expect.poll(()=>state.reads["/api/v1/server/7/bgp"]||0).toBe(1)
 await expect(page.locator("[data-network-insight], [data-server-connectivity]")).toHaveCount(0)
 const times:any[]=[]
 for(const label of ["连通性","流媒体","BGP","连通性","BGP"]){
  const before=Date.now()
  await page.locator(".server-info-tab").getByRole("button",{name:label,exact:true}).evaluate(el=>(el as HTMLElement).click())
  if(label==="连通性")await expect(page.locator("[data-server-connectivity]")).toBeVisible()
  else if(label==="BGP")await expect(page.locator("[data-bgp-graph]")).toBeVisible()
  else await expect(page.locator("[data-media-card]")).toHaveCount(6)
  times.push({label,ms:Date.now()-before})
 }
 expect(times.every(t=>t.ms<1500)).toBe(true)
 for(const kind of ["connectivity","bgp","streaming"])expect(state.reads["/api/v1/server/7/"+kind]).toBe(1)
 expect(state.posts).toEqual([])
 console.log("SECONDARY_WARM",JSON.stringify({theme,times}))
 await page.screenshot({path:info.outputPath("secondary-warm.png")})
})

for(const theme of ["default","doraemon"])for(const width of [390,1440])test("tab switch keeps current scroll offset "+theme+" "+width,async({page},info)=>{
 await page.setViewportSize({width,height:760})
 const state=await setup(page,theme,false,true)
 const tab=(label:string)=>page.locator(".server-info-tab").getByRole("button",{name:label,exact:true})
 await tab("BGP").click()
 await expect(page.locator("[data-bgp-graph]")).toBeVisible()
 const initial=await page.evaluate(()=>{
  const top=document.querySelector(".server-info-tab")!.getBoundingClientRect().top+scrollY
  window.scrollTo({top:Math.max(80,top-70),behavior:"instant"})
  return scrollY
 })
 expect(initial).toBeGreaterThan(40)
 async function switchAtCurrent(label:string){
  const samples=await tab(label).evaluate(async el=>{
   const before=scrollY,ys=[before]
   ;(el as HTMLElement).click()
   for(let i=0;i<24;i++){await new Promise<void>(r=>requestAnimationFrame(()=>r()));ys.push(scrollY)}
   return {before,ys}
  })
  expect(Math.max(...samples.ys.map(y=>Math.abs(y-samples.before)))).toBeLessThanOrEqual(2)
  await expect(tab(label)).toHaveAttribute("aria-pressed","true")
 }
 await switchAtCurrent("连通性")
 await expect(page.locator("[data-server-connectivity]")).toBeVisible()
 await switchAtCurrent("流媒体") // A much shorter pane must not collapse the page.
 await expect(page.locator("[data-media-card]")).toHaveCount(6)
 await switchAtCurrent("BGP")
 // Return from a different offset: do not restore this tab's old position.
 await page.evaluate(()=>window.scrollTo({top:Math.max(20,scrollY-45),behavior:"instant"}))
 const changed=await page.evaluate(()=>scrollY)
 expect(changed).toBeLessThan(initial-20)
 await switchAtCurrent("连通性")
 await switchAtCurrent("连通性") // Repeated activation is a no-op.
 await switchAtCurrent("BGP")
 expect(await page.evaluate(()=>scrollY)).toBeCloseTo(changed,0)
 await page.screenshot({path:info.outputPath("stable-tab-scroll.png")})
 await page.evaluate(()=>window.scrollTo({top:0,behavior:"instant"}))
 await expect.poll(()=>page.locator("[data-detail-viewport]").evaluate(el=>(el as HTMLElement).style.minHeight)).toBe("")
 expect(state.posts).toEqual([])
})

for(const theme of ["default","doraemon"])test("tab scroll holds through pending result and user scrolling "+theme,async({page})=>{
 await page.setViewportSize({width:1440,height:760})
 const state=await setup(page,theme,false,false,"/server/7",0,undefined,0,3000)
 const tab=(label:string)=>page.locator(".server-info-tab").getByRole("button",{name:label,exact:true})
 await tab("BGP").click()
 await expect(page.locator("[data-bgp-graph]")).toBeVisible()
 await page.evaluate(()=>window.scrollTo({top:250,behavior:"instant"}))
 const y=await page.evaluate(()=>scrollY)
 await tab("连通性").evaluate(el=>(el as HTMLElement).click())
 await expect(page.getByText("正在读取检测结果…",{exact:true})).toBeVisible()
 expect(await page.evaluate(()=>scrollY)).toBe(y)
 // User input during loading wins; a late response must never undo it.
 await page.evaluate(()=>window.scrollTo({top:180,behavior:"instant"}))
 await expect(page.locator("[data-server-connectivity] [role=status]")).toHaveCount(0,{timeout:10000})
 expect(await page.evaluate(()=>scrollY)).toBe(180)
 await tab("BGP").evaluate(el=>(el as HTMLElement).click())
 await expect(page.locator("[data-bgp-graph]")).toBeVisible()
 expect(await page.evaluate(()=>scrollY)).toBe(180)
 expect(state.posts).toEqual([])
})
