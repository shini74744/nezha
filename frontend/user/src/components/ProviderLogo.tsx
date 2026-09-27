import {logoPlacement} from "../../../shared/logo-layout";
import type {CSSProperties} from "react";
import {useLayoutEffect,useRef,useState} from "react";
import {safeLogoSource} from "../../../shared/other-routes";
import type {LogoValue} from "../../../shared/logo";
export default function ProviderLogo({value,mobileSlot=false}:{value?:LogoValue;mobileSlot?:boolean}){
 const src=safeLogoSource(value?.logo),[failed,setFailed]=useState(""),ref=useRef<HTMLSpanElement>(null);
 useLayoutEffect(()=>{const box=ref.current,card=box?.closest<HTMLElement>("[data-server-card]"),heading=box?.parentElement;if(!box||!card||!heading)return;let frame=0,disposed=false;
  const measure=()=>{if(disposed)return;const c=card.getBoundingClientRect(),h=heading.getBoundingClientRect(),progress=heading.querySelector<HTMLElement>("[data-expiry-progress]"),anchor=progress?.getBoundingClientRect().width?progress:heading.querySelector<HTMLElement>("[data-server-name]");if(anchor){const a=anchor.getBoundingClientRect();box.style.setProperty("--nz-logo-desktop-center",(a.left-h.left+35)+"px")}box.style.setProperty("--nz-logo-desktop-height",Math.max(8,Math.min(28,heading.getBoundingClientRect().top-c.top-8))+"px");if(!mobileSlot)return;const a=card.querySelector<HTMLElement>('[data-metric-label="cpu"]'),b=card.querySelector<HTMLElement>('[data-metric-label="memory"]');let left=12,width=92;
   if(a&&b){const start=a.getBoundingClientRect();const range=document.createRange();range.selectNodeContents(b);const end=range.getBoundingClientRect();left=start.left-c.left-card.clientLeft;width=Math.max(24,end.right-start.left)}
   box.style.setProperty("--nz-logo-slot-left",left+"px");box.style.setProperty("--nz-logo-slot-width",width+"px");
  };
  const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(measure)};const observer=new ResizeObserver(schedule);observer.observe(card);observer.observe(heading);for(const e of card.querySelectorAll("[data-metric-label]"))observer.observe(e);window.addEventListener("resize",schedule);document.fonts?.ready.then(schedule);measure();return()=>{disposed=true;observer.disconnect();cancelAnimationFrame(frame);window.removeEventListener("resize",schedule)};
 },[src,mobileSlot,failed]);
 if(!src||failed===src)return null;
 const desktop=logoPlacement(value?.logoLayout,"desktop"),mobile=logoPlacement(value?.logoLayout,"mobile");
 const vars={"--nz-logo-dx":desktop.x+"px","--nz-logo-dy":desktop.y+"px","--nz-logo-ds":desktop.scale/100,"--nz-logo-mx":mobile.x+"px","--nz-logo-my":mobile.y+"px","--nz-logo-ms":mobile.scale/100} as CSSProperties;
 return <span ref={ref} data-provider-logo-box data-mobile-slot={mobileSlot?"true":undefined} style={{...vars,display:"flex",alignItems:"center",justifyContent:"center",width:"100%",maxWidth:80,height:28,alignSelf:"center",marginBottom:4}}>
  <img data-provider-logo src={src} alt={value?.logoLibraryName||"服务器厂商 Logo"} referrerPolicy="no-referrer" onError={()=>setFailed(src)} style={{width:"auto",height:"auto",maxWidth:"100%",maxHeight:28,objectFit:"scale-down",objectPosition:"center",backgroundColor:value?.logoBackground||undefined,borderRadius:2}}/>
 </span>;
}
