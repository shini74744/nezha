import type {Feature} from "../config";
import type {CustomCharacter} from "../mascot-config";
import {FeatureScope} from "../scope";
export async function sakana(scope:FeatureScope,f:Feature){
 if(screen.width<768)return; // Preserve the original Live2D mobile guard.
 const {default:SakanaWidget}=await import("sakana-widget");
 if(!scope.active)return;
 const custom=(f.customCharacters||[]) as CustomCharacter[],builtin=SakanaWidget.getCharacter("chisato")!;
 const roles=[{id:"chisato",key:"chisato",name:"千束 Chisato"},{id:"takina",key:"takina",name:"泷奈 Takina"},...custom.map((r,i)=>({...r,key:"nz-custom-"+i}))];
 custom.forEach((r,i)=>SakanaWidget.registerCharacter("nz-custom-"+i,{...builtin,image:new URL(r.imageUrl).href.replace(/'/g,"%27")}));
 const host=scope.createElement("div");host.id="nz-sakana-widget";
 Object.assign(host.style,{position:"fixed",left:"0",right:"auto",bottom:"0",zIndex:"9990",width:"min("+f.size+"px, calc(100vw - 24px))",height:"min("+f.size+"px, calc(100vw - 24px))"});
 document.body.append(host);
 let index=Math.max(0,roles.findIndex(r=>r.id===f.character));
 const widget=new SakanaWidget({character:roles[index].key,size:f.size,autoFit:true,controls:f.controls,title:true,saveState:false});
 const anchor=document.createElement("div");Object.assign(anchor.style,{width:"100%",height:"100%",position:"relative"});host.append(anchor);
 let probe:HTMLImageElement|undefined;
 const show=(next:number)=>{
  if(probe){probe.onerror=null;probe.removeAttribute("src");probe=undefined}
  index=next;widget.setCharacter(roles[index].key);host.dataset.character=roles[index].id;
  const image=host.querySelector<HTMLElement>(".sakana-widget-img");image?.setAttribute("role","img");image?.setAttribute("aria-label",roles[index].name);
  // A separate artwork layer scales without replacing Sakana's physics transform.
  image?.querySelector(".nz-sakana-artwork")?.remove();
  const scale=index>1?(custom[index-2].scale??100)/100:1;
  // Reserve left-edge room for enlarged art; the outer host remains bottom-left.
  const mountedAnchor=host.firstElementChild as HTMLElement|null;
  if(mountedAnchor)mountedAnchor.style.left=Math.max(0,(f.size*.8*scale-f.size)/2)+"px";
  if(image&&index>1){
   const art=document.createElement("span");art.className="nz-sakana-artwork";art.setAttribute("aria-hidden","true");
   Object.assign(art.style,{position:"absolute",inset:"0",backgroundImage:image.style.backgroundImage,backgroundRepeat:"no-repeat",backgroundSize:"contain",backgroundPosition:"center bottom",transform:"scale("+scale+")",transformOrigin:"center bottom",pointerEvents:"none"});
   image.style.backgroundImage="none";image.append(art);
  }
  if(index>1){probe=new Image();probe.onerror=()=>{if(scope.active)show(0)};probe.src=custom[index-2].imageUrl}
 };
 widget.nextCharacter=()=>{show((index+1)%roles.length);return widget};
 widget.mount(anchor);show(index);
 scope.own(()=>{
  if(probe){probe.onerror=null;probe.removeAttribute("src")}
  if(host.firstElementChild?.childElementCount)widget.unmount();
  custom.forEach((_,i)=>SakanaWidget.registerCharacter("nz-custom-"+i,builtin));
 });
 if(f.autoMotion&&!matchMedia("(prefers-reduced-motion: reduce)").matches)widget.triggerAutoMode();
}
