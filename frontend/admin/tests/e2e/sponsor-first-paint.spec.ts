import {test,expect} from "@playwright/test";
import {setupNativeLayout,origin} from "./native-layout-fixture";
test.use({ignoreHTTPSErrors:true});
const logo='<svg xmlns="http://www.w3.org/2000/svg" width="280" height="48"><rect width="280" height="48" fill="#286"/><text x="10" y="32" fill="white" font-size="24">SPONSOR</text></svg>';
for(const width of [1024,1320,1920]) for(const dark of [false,true]){
 test("first paint delayed logos "+width+" "+dark,async({page},info)=>{
  await page.setViewportSize({width,height:900});
  await page.addInitScript(dark=>{
   localStorage.setItem("vite-ui-theme",dark?"dark":"light");
   const w=window as any;w.__sponsorSamples=[];w.__sponsorRecording=true;
   const sample=()=>{
    const node=document.querySelector<HTMLElement>("[data-native-sponsor-slot] #bmWrap"),slot=node?.closest<HTMLElement>("[data-native-sponsor-slot]"),bar=slot?.parentElement;
    if(!node||!slot||!bar)return;
    const left=bar.querySelector(":scope > section"),right=bar.lastElementChild;
    if(!left||!right)return;
    const b=node.getBoundingClientRect(),s=slot.getBoundingClientRect(),l=left.getBoundingClientRect(),r=right.getBoundingClientRect(),css=getComputedStyle(node);
    if(css.visibility==="visible"&&css.display!=="none"&&Number(css.opacity)>.05&&b.width>0)
     w.__sponsorSamples.push({time:performance.now(),x:b.x,right:b.right,width:b.width,slotLeft:s.left,slotRight:s.right,leftRight:l.right,rightLeft:r.left,center:b.x+b.width/2,slotCenter:s.x+s.width/2,transition:css.transitionProperty});
   };
   // Read after layout/ResizeObserver delivery, immediately before paint.
   // A timer can force a new image layout before the browser has delivered its
   // resize callbacks, which is not a painted frame.
   let observed:Element|null=null;
   let resize:ResizeObserver|undefined;
   let stableWidth=0,stableSlotWidth=0;
   const frames=()=>{
    if(w.__sponsorRecording&&observed){
     const node=observed as HTMLElement,slot=node.closest<HTMLElement>("[data-native-sponsor-slot]")!;
     // Sample transforms each frame only when layout already passed the fit observer.
     if(node.offsetWidth===stableWidth&&slot.clientWidth===stableSlotWidth)sample();
    }
    if(w.__sponsorRecording)requestAnimationFrame(frames);
   };
   requestAnimationFrame(frames);
   const attach=()=>{
    const node=document.querySelector("[data-native-sponsor-slot] #bmWrap");
    if(node&&node!==observed){
     resize?.disconnect();observed=node;
     // Construct after the component observer so its synchronous fit runs first.
     const slot=node.closest<HTMLElement>("[data-native-sponsor-slot]")!;
     resize=new ResizeObserver(()=>{stableWidth=(node as HTMLElement).offsetWidth;stableSlotWidth=slot.clientWidth;if(w.__sponsorRecording)sample()});
     resize.observe(node);resize.observe(slot);
    }
   };
   new MutationObserver(attach).observe(document,{subtree:true,childList:true});
   attach();
  },dark);
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await setupNativeLayout(page,{sponsor:{shrinkDuration:3600,stayDuration:60000,fadeDuration:500,sponsors:[0,1,2].map(i=>({name:"Sponsor "+i,url:"https://example.com",logo:origin+"/delayed-logo-"+i+".svg"}))}});
  await page.route("**/api/v1/server-group",async r=>{
   await new Promise(resolve=>setTimeout(resolve,400));
   return r.fulfill({json:{success:true,data:["1111","2222","33333"].map((name,i)=>({group:{id:i+1,name},servers:[1,2,3]}))}});
  });
  await page.route("**/delayed-logo-*.svg",async r=>{
   const i=Number(r.request().url().match(/logo-(\d)/)![1]);
   await new Promise(resolve=>setTimeout(resolve,700+i*350));
   return r.fulfill({contentType:"image/svg+xml",body:logo});
  });
  await page.goto(origin);
  await expect(page.locator("[data-group-switch] button")).toHaveCount(4);
  await expect(page.locator("[data-native-sponsor-slot] #bmWrap")).toBeVisible();
  await page.waitForTimeout(1800);
  await page.locator(".server-overview-controls").screenshot({path:info.outputPath("logos-loaded.png")});
  await page.setViewportSize({width:width-160,height:900});
  await page.waitForTimeout(150);
  await page.setViewportSize({width,height:900});
  await page.waitForTimeout(2200);
  await page.locator(".server-overview-controls").screenshot({path:info.outputPath("compact.png")});
  const samples=await page.evaluate(()=>{(window as any).__sponsorRecording=false;return (window as any).__sponsorSamples});
  await info.attach("frame-measurements",{body:JSON.stringify(samples),contentType:"application/json"});
  expect(samples.length).toBeGreaterThan(30);
  const overlaps=samples.filter((s:any)=>s.x<s.leftRight-1||s.right>s.rightLeft+1);
  expect(overlaps,"No painted frame may cover the groups or sort control").toEqual([]);
  const overflow=samples.filter((s:any)=>s.x<s.slotLeft-1||s.right>s.slotRight+1);
  expect(overflow,"Fit must be immediate, not a delayed transform animation").toEqual([]);
  expect(samples.every((s:any)=>Math.abs(s.center-s.slotCenter)<1)).toBe(true);
  expect(errors).toEqual([]);
 });
}
