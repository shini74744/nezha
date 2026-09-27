import {useLayoutEffect,useRef,useState} from "react";
import {safeLogoSource} from "../../../shared/other-routes";
import type {LogoValue} from "../../../shared/logo";
export default function ProviderLogo({value,mobileSlot=false}:{value?:LogoValue;mobileSlot?:boolean}){
 const src=safeLogoSource(value?.logo),[failed,setFailed]=useState(""),ref=useRef<HTMLSpanElement>(null);
 useLayoutEffect(()=>{const box=ref.current,card=box?.closest<HTMLElement>("[data-server-card]"),heading=box?.parentElement;if(!mobileSlot||!box||!card||!heading)return;let frame=0,disposed=false;
  const measure=()=>{if(disposed)return;const c=card.getBoundingClientRect(),a=card.querySelector<HTMLElement>('[data-metric-label="cpu"]'),b=card.querySelector<HTMLElement>('[data-metric-label="memory"]');let left=12,width=92;
   if(a&&b){const start=a.getBoundingClientRect();const range=document.createRange();range.selectNodeContents(b);const end=range.getBoundingClientRect();left=start.left-c.left-card.clientLeft;width=Math.max(24,end.right-start.left)}
   box.style.setProperty("--nz-logo-slot-left",left+"px");box.style.setProperty("--nz-logo-slot-width",width+"px");heading.style.setProperty("--nz-logo-heading-inset",Math.max(0,left+width+12-(heading.getBoundingClientRect().left-c.left))+"px");
  };
  const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(measure)};const observer=new ResizeObserver(schedule);observer.observe(card);for(const e of card.querySelectorAll("[data-metric-label]"))observer.observe(e);window.addEventListener("resize",schedule);document.fonts?.ready.then(schedule);measure();return()=>{disposed=true;observer.disconnect();cancelAnimationFrame(frame);window.removeEventListener("resize",schedule)};
 },[src,mobileSlot,failed]);
 if(!src||failed===src)return null;
 return <span ref={ref} data-provider-logo-box data-mobile-slot={mobileSlot?"true":undefined} style={{display:"flex",alignItems:"center",justifyContent:"center",width:"100%",maxWidth:80,height:28,alignSelf:"center",marginBottom:4}}>
  <img data-provider-logo src={src} alt={value?.logoLibraryName||"服务器厂商 Logo"} referrerPolicy="no-referrer" onError={()=>setFailed(src)} style={{width:"auto",height:"auto",maxWidth:"100%",maxHeight:28,objectFit:"scale-down",objectPosition:"center",backgroundColor:value?.logoBackground||undefined,borderRadius:2}}/>
 </span>;
}
