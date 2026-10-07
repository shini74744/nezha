import {useEffect,useState} from "react";
import {useWebSocketContext} from "@/hooks/use-websocket-context";
import {useFeature} from "./context";
export function NativeFooterIP() {
 const f=useFeature("footerIP"),[visible,setVisible]=useState(false);
 const {connected,lastData}=useWebSocketContext();
 const mobile=/Mobi|Android/i.test(navigator.userAgent);
 const ready=connected&&lastData!==null;
 const shown=f.enabled&&!mobile&&ready&&visible;
 useEffect(()=>{
  setVisible(false);
  if(!f.enabled||mobile||!ready)return;
  let timer=0,last=window.scrollY;
  const atBottom=()=>innerHeight+scrollY>=document.documentElement.scrollHeight-2;
  const update=()=>{
   clearTimeout(timer);
   const down=window.scrollY>=last;last=window.scrollY;
   if(down&&atBottom())timer=window.setTimeout(()=>setVisible(atBottom()),300);
   else setVisible(false);
  };
  // Loading, filtering, font/image loads and card expansion can move the footer without scrolling.
  const observer=new ResizeObserver(update);
  observer.observe(document.documentElement);observer.observe(document.body);
  addEventListener("scroll",update,{passive:true});addEventListener("resize",update);
  update();
  return ()=>{clearTimeout(timer);observer.disconnect();removeEventListener("scroll",update);removeEventListener("resize",update)};
 },[f.enabled,mobile,ready]);
// biome-ignore lint/correctness/useExhaustiveDependencies: Notify layout consumers whenever footer visibility or configured height changes.
 useEffect(()=>{
  dispatchEvent(new Event("nz-footer-ip-change"));
  return ()=>{requestAnimationFrame(()=>dispatchEvent(new Event("nz-footer-ip-change")))};
 },[shown,f.height]);
 if(!f.enabled)return null;
 return <div data-native-footer-ip data-visible={shown?"true":"false"} className="nz-footer-ip"
  style={{display:mobile?"none":undefined,transform:"translateX(-50%) translateY("+(shown?0:20)+"px)",opacity:shown?1:0,pointerEvents:shown?"auto":"none",height:f.height}}>
  <iframe title="IP 详细信息" src={f.url} loading="lazy" sandbox="allow-scripts allow-same-origin"
   referrerPolicy="no-referrer" className="h-full w-full rounded-lg border-0"/>
 </div>;
}
