import {logoPlacement} from "../../../shared/logo-layout";
import type {CSSProperties} from "react";
import {useLayoutEffect,useRef,useState} from "react";
import {safeLogoSource} from "../../../shared/other-routes";
import type {LogoValue} from "../../../shared/logo";
export default function ProviderLogo({value,mobileSlot=false}:{value?:LogoValue;mobileSlot?:boolean}){
 const src=safeLogoSource(value?.logo),[failed,setFailed]=useState(""),ref=useRef<HTMLSpanElement>(null);
 useLayoutEffect(()=>{const box=ref.current,card=box?.closest<HTMLElement>("[data-server-card]"),heading=box?.parentElement;if(!box||!card||!heading)return;let frame=0,disposed=false;
  const measure=()=>{if(disposed)return;const c=card.getBoundingClientRect(),h=heading.getBoundingClientRect(),progress=heading.querySelector<HTMLElement>("[data-expiry-progress]"),anchor=progress?.getBoundingClientRect().width?progress:heading.querySelector<HTMLElement>("[data-server-name]");if(anchor){const a=anchor.getBoundingClientRect();const width=anchor===progress?a.width:70;box.style.setProperty("--nz-logo-desktop-width",width+"px");box.style.setProperty("--nz-logo-desktop-center",(a.left-h.left+width/2)+"px")}const desktopTop=c.top+card.clientTop,desktopBottom=Math.max(desktopTop,h.top-4),desktopHeight=Math.min(28,desktopBottom-desktopTop);box.style.setProperty("--nz-logo-desktop-height",desktopHeight+"px");box.style.setProperty("--nz-logo-desktop-gap",(h.top-(desktopTop+desktopBottom)/2-desktopHeight/2-3)+"px");if(!mobileSlot)return;const a=card.querySelector<HTMLElement>('[data-metric-label="cpu"]'),b=card.querySelector<HTMLElement>('[data-metric-label="memory"]');let left=12,width=92;
   if(a&&b){const start=a.getBoundingClientRect();const range=document.createRange();range.selectNodeContents(b);const end=range.getBoundingClientRect();left=start.left-c.left-card.clientLeft;width=Math.max(24,end.right-start.left)}
   box.style.setProperty("--nz-logo-slot-left",left+"px");box.style.setProperty("--nz-logo-slot-width",width+"px");
   const img=box.querySelector("img"),ratio=(img?.naturalWidth&&img.naturalHeight)?img.naturalWidth/img.naturalHeight:1;
   const obstacles=[...card.querySelectorAll<HTMLElement>("[data-server-name],[data-server-status],[data-server-flag],[data-mobile-billing]")].map(el=>el.getBoundingClientRect()).filter(r=>r.width&&r.height).map(r=>({left:r.left-c.left-card.clientLeft,right:r.right-c.left-card.clientLeft,top:r.top-c.top-card.clientTop,bottom:r.bottom-c.top-card.clientTop}));
   const limit=a?a.getBoundingClientRect().top-c.top-card.clientTop-4:48;
   let fit:{top:number;width:number;height:number}|undefined;
   for(let cap=24;cap>=8&&!fit;cap--){
    const w=Math.min(64,width,img?.naturalWidth||64,cap*ratio),height=w/ratio,l=left+(width-w)/2;
    let gaps=[{top:12,bottom:limit}];
    for(const r of obstacles.filter(r=>l<r.right+2&&l+w>r.left-2)){
     gaps=gaps.flatMap(g=>r.bottom+2<=g.top||r.top-2>=g.bottom?[g]:[{top:g.top,bottom:Math.min(g.bottom,r.top-2)},{top:Math.max(g.top,r.bottom+2),bottom:g.bottom}]).filter(g=>g.bottom-g.top>=height);
    }
    const gap=gaps.filter(g=>g.bottom-g.top>=height).sort((a,b)=>(b.bottom-b.top)-(a.bottom-a.top)||a.top-b.top)[0];
    if(gap)fit={top:(gap.top+gap.bottom-height)/2,width:w,height};
   }
   box.style.setProperty("--nz-logo-mobile-top",(fit?.top??12)+"px");
   box.style.setProperty("--nz-logo-mobile-width",(fit?.width??0)+"px");
   box.style.setProperty("--nz-logo-mobile-height",(fit?.height??0)+"px");
   box.style.setProperty("--nz-logo-mobile-visible",fit?"visible":"hidden");

  };
  const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(measure)};const observer=new ResizeObserver(schedule);observer.observe(card);observer.observe(heading);const img=box.querySelector("img");img?.addEventListener("load",schedule);for(const e of card.querySelectorAll("[data-metric-label]"))observer.observe(e);window.addEventListener("resize",schedule);document.fonts?.ready.then(schedule);measure();return()=>{disposed=true;img?.removeEventListener("load",schedule);observer.disconnect();cancelAnimationFrame(frame);window.removeEventListener("resize",schedule)};
 },[src,mobileSlot,failed]);
 if(!src||failed===src)return null;
 const desktop=logoPlacement(value?.logoLayout,"desktop"),mobile=logoPlacement(value?.logoLayout,"mobile");
 const vars={"--nz-logo-dx":desktop.x+"px","--nz-logo-dy":desktop.y+"px","--nz-logo-ds":desktop.scale/100,"--nz-logo-mx":mobile.x+"px","--nz-logo-my":mobile.y+"px","--nz-logo-ms":mobile.scale/100} as CSSProperties;
 return <span ref={ref} data-provider-logo-box data-mobile-slot={mobileSlot?"true":undefined} style={{...vars,display:"flex",alignItems:"center",justifyContent:"center",width:"var(--nz-logo-desktop-width,70px)",maxWidth:"var(--nz-logo-desktop-width,70px)",height:28,alignSelf:"center",marginBottom:4}}>
  <img data-provider-logo src={src} alt={value?.logoLibraryName||"服务器厂商 Logo"} referrerPolicy="no-referrer" onError={()=>setFailed(src)} style={{width:"auto",height:"auto",maxWidth:"100%",maxHeight:28,objectFit:"scale-down",objectPosition:"center",backgroundColor:value?.logoBackground||undefined,borderRadius:2}}/>
 </span>;
}
