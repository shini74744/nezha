import type {Feature} from "../config";
import type {FeatureScope} from "../scope";
import {fitCounter} from "../counter-layout";

// Fixed desktop corner, legacy mobile center; content always takes priority.
export function counter(scope: FeatureScope, config: Feature) {
 const node=scope.createElement("div") as HTMLDivElement;
 node.className="footer-background";node.setAttribute("aria-hidden","true");
 Object.assign(node.style,{position:"fixed",backgroundImage:`url(${JSON.stringify(config.imageUrl)})`,
  backgroundSize:"contain",backgroundRepeat:"no-repeat",pointerEvents:"none",zIndex:"9988"});
 scope.append(document.body,node);
 let frame=0,header:Element|null=null;
 const update=()=>{
  const desktop=window.innerWidth>=768,viewport=document.documentElement.clientWidth||window.innerWidth;
  const desired=desktop?config.desktopWidth*window.innerWidth/1366:config.mobileWidth;
  const ratio=desktop?config.desktopWidth/config.desktopHeight:config.mobileWidth/config.mobileHeight;
  const top=desktop?config.desktopTop:config.mobileTop;
  const preferred=desktop?viewport-config.desktopRight-desired:viewport/2+config.mobileOffset-desired/2;
  const obstacles=Array.from(header?.children||[]).map(el=>el.getBoundingClientRect());
  const box=fitCounter(viewport,desired,ratio,top,preferred,obstacles,desktop);
  const visible=window.scrollY<=config.scrollThreshold,hasRoom=box.width>=24;
  node.className="footer-background "+(desktop?"is-desktop":"is-mobile");
  Object.assign(node.style,{left:desktop?"auto":box.left+"px",right:desktop?(viewport-box.left-box.width)+"px":"auto",
   top:top+"px",width:box.width+"px",height:box.height+"px",
   backgroundPosition:desktop?"right top":"center center",transformOrigin:desktop?"top right":"center",   transition:desktop?"opacity 0.5s ease-in-out, transform 0.5s ease-in-out":"none",
   display:hasRoom&&(desktop||visible)?"block":"none",opacity:desktop&&!visible?"0":"1",
   transform:desktop?(visible?"scale(1)":"scale(0)"):"none"});
 };
 const schedule=()=>{if(!frame)frame=scope.requestAnimationFrame(()=>{frame=0;update()})};
 const resize=typeof ResizeObserver==="undefined"?null:scope.resizeObserver(schedule);
 const mutations=scope.mutationObserver(()=>{bind();schedule()});
 const bind=()=>{
  const next=document.querySelector(".header-top");
  if(next===header)return;
  resize?.disconnect();mutations.disconnect();header=next;
  if(header){
   resize?.observe(header);for(const child of header.children)resize?.observe(child);
   mutations.observe(header,{childList:true,subtree:true,characterData:true,attributes:true});
  }
  schedule();
 };
 scope.mutationObserver(bind).observe(document.body,{childList:true,subtree:true});
 scope.listen(window,"resize",schedule);scope.listen(window,"scroll",schedule,{passive:true});
 scope.listen(window,"load",schedule);scope.listen(document,"load",schedule,true);
 void document.fonts?.ready.then(()=>{if(scope.active)schedule()});
 bind();update();
}