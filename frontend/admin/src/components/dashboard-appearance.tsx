import "./dashboard-appearance.css";
import {createContext,useContext,useEffect,useMemo,useRef,useState,type ReactNode,type CSSProperties} from "react";
import {normalizeDashboard,dashboardDefaults,type DashboardAppearance,type DashboardFeature} from "@/lib/dashboard-appearance";
const Context=createContext<DashboardAppearance>(dashboardDefaults());
export const useDashboardAppearance=()=>useContext(Context);
export function useDashboardFeature(key:string):DashboardFeature{const c=useContext(Context);return {...c.features[key],enabled:c.enabled&&c.features[key].enabled}}
export function DashboardAppearanceProvider({raw,children}:{raw?:string;children:ReactNode}){
 const config=useMemo(()=>normalizeDashboard(raw),[raw]);
 return <Context.Provider value={config}><DashboardDecorations/>{children}</Context.Provider>;
}
const quote=(s:string)=>JSON.stringify(s).replace(/</g,"\\3c ");
function dashboardCSS(c:DashboardAppearance){
 if(!c.enabled)return "";
 const {font:f,background:b,appearance:a}=c.features;let css="";
 if(f.enabled)css+='html[data-nz-dashboard]{font-size:'+f.size+'}html[data-nz-dashboard] body,html[data-nz-dashboard] #root,html[data-nz-dashboard] #root *{font-family:'+quote(f.family)+',"PingFang SC","Microsoft YaHei",Arial,sans-serif!important}html[data-nz-dashboard] body{text-shadow:'+f.shadow+';font-variant-numeric:tabular-nums;'+(f.color?'color:'+f.color+'!important;':'')+'}';
 if(b.enabled)css+='html[data-nz-dashboard] body{height:auto;min-height:100dvh;background-image:'+(b.image?'url('+quote(b.image)+')':'none')+'!important;background-position:'+b.position+';background-size:'+b.size+';background-repeat:'+b.repeat+';background-attachment:'+b.attachment+'}html[data-nz-dashboard] #root{background:transparent!important}@media(max-width:768px){html[data-nz-dashboard] body{background-attachment:scroll}}';
 if(a.enabled)css+='html[data-nz-dashboard]{--background:0 0% 100% / '+a.lightBackgroundOpacity+';--card:0 0% 100% / '+a.lightCardOpacity+';--popover:0 0% 100% / '+a.lightPopoverOpacity+';--muted:0 0% 100% / '+a.lightMutedOpacity+';--secondary:0 0% 100% / .72;--accent:0 0% 100% / .78}html[data-nz-dashboard].dark{--background:0 0% 5% / '+a.darkBackgroundOpacity+';--card:0 0% 5% / '+a.darkCardOpacity+';--popover:0 0% 5% / '+a.darkPopoverOpacity+';--muted:0 0% 7% / '+a.darkMutedOpacity+';--secondary:0 0% 8% / .72;--accent:0 0% 10% / .78}html[data-nz-dashboard] #root header{background-color:hsl(var(--muted))!important;backdrop-filter:blur('+a.blur+');-webkit-backdrop-filter:blur('+a.blur+');box-shadow:'+(a.headerShadow?'0 4px 20px #0002':'none')+'!important}html[data-nz-dashboard] :is(.bg-card,.bg-popover,[role=dialog],[role=menu],[role=listbox]){backdrop-filter:blur('+a.blur+');-webkit-backdrop-filter:blur('+a.blur+')}';
 if(a.enabled&&a.hideFooter)css+="html[data-nz-dashboard] #root footer{display:none!important}";
 return css;
}
type Particle={id:number;x:number;y:number;dx:number;dy:number;angle:number;color:string;word?:string};
const words=["❤富强❤","❤民主❤","❤文明❤","❤和谐❤","❤自由❤","❤平等❤","❤公正❤","❤法治❤","❤爱国❤","❤敬业❤","❤诚信❤","❤友善❤"];
function DashboardDecorations(){
 const config=useContext(Context),f=useDashboardFeature("effects"),font=useDashboardFeature("font");
 const [particles,setParticles]=useState<Particle[]>([]),[showTop,setShowTop]=useState(false);
 const serial=useRef(0),wordIndex=useRef(0);
 useEffect(()=>{
  if(!config.enabled)return;
  const root=document.documentElement,previous=root.getAttribute("data-nz-dashboard");
  root.setAttribute("data-nz-dashboard","true");
  return()=>{if(previous===null)root.removeAttribute("data-nz-dashboard");else root.setAttribute("data-nz-dashboard",previous)};
 },[config.enabled]);
 useEffect(()=>{
  if(!font.enabled||!font.cssUrl)return;
  const link=document.createElement("link");link.rel="stylesheet";link.href=font.cssUrl;link.dataset.nzDashboardFont="true";document.head.append(link);
  return()=>link.remove();
 },[font.enabled,font.cssUrl]);
 useEffect(()=>{
  setParticles([]);if(!f.enabled||!f.clickEffect)return;
  const timers=new Set<ReturnType<typeof setTimeout>>();
  const click=(event:MouseEvent)=>{
   if(event.target instanceof Element&&event.target.closest('a,button,input,textarea,select,option,label,[role=button],[role=menuitem],[role=option],[contenteditable=true]'))return;
   const batch:Particle[]=[];
   const make=(word?:string):Particle=>({id:++serial.current,x:event.clientX,y:event.clientY,dx:(Math.random()-.5)*290,dy:(Math.random()-.5)*290,angle:Math.random()*720-360,color:"hsl("+Math.floor(Math.random()*360)+",80%,65%)",word});
   if(f.shatter)for(let i=0;i<f.shatterCount;i++)batch.push(make());
   if(f.clickWord)batch.push(make(words[wordIndex.current++%words.length]));
   setParticles(old=>old.slice(-400).concat(batch));
   const ids=new Set(batch.map(p=>p.id)),timer=setTimeout(()=>{timers.delete(timer);setParticles(old=>old.filter(p=>!ids.has(p.id)))},1600);timers.add(timer);
  };
  document.addEventListener("click",click,{passive:true});
  return()=>{document.removeEventListener("click",click);for(const timer of timers)clearTimeout(timer)};
 },[f.enabled,f.clickEffect,f.shatter,f.shatterCount,f.clickWord]);
 const scrollables=()=>Array.from(document.querySelectorAll<HTMLElement>('main,[data-radix-scroll-area-viewport]')).filter(el=>el.scrollHeight>el.clientHeight+30);
 useEffect(()=>{
  if(!f.enabled||!f.backToTop){setShowTop(false);return}
  const update=()=>setShowTop(Math.max(window.scrollY,...scrollables().map(el=>el.scrollTop))>300);
  update();document.addEventListener("scroll",update,true);window.addEventListener("resize",update);
  return()=>{document.removeEventListener("scroll",update,true);window.removeEventListener("resize",update)};
 },[f.enabled,f.backToTop]);
 if(!config.enabled)return null;
 return <>
  <style data-nz-dashboard-style>{dashboardCSS(config)}</style>
  {f.enabled&&particles.map(p=><span key={p.id} aria-hidden className={p.word?"nz-dashboard-word":"nz-dashboard-shatter"} style={{left:p.x,top:p.y,color:p.color,"--nz-dx":p.dx+"px","--nz-dy":p.dy+"px","--nz-angle":p.angle+"deg"} as CSSProperties} onAnimationEnd={()=>setParticles(old=>old.filter(x=>x.id!==p.id))}>{p.word}</span>)}
  {f.enabled&&f.backToTop&&<button id="nz-dashboard-back-top" type="button" aria-label="返回顶部" title="返回顶部" className={showTop?"nz-show":""} style={{right:f.backToTopRight,bottom:f.backToTopBottom,backdropFilter:"blur("+config.features.appearance.blur+")",WebkitBackdropFilter:"blur("+config.features.appearance.blur+")"}} onClick={()=>{const behavior=matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth";window.scrollTo({top:0,behavior});scrollables().forEach(el=>el.scrollTo({top:0,behavior}))}}>{f.backToTopIcon||"🚀"}</button>}
 </>;
}
