import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ChartTooltipContent } from "@/components/ui/chart";

type Props = ComponentProps<typeof ChartTooltipContent> & {
 coordinate?: { x?: number; y?: number };
 anchor: RefObject<HTMLDivElement | null>;
 onHoldChange: (held: boolean) => void;
};
export function ViewportChartTooltip({ anchor, coordinate, onHoldChange, ...content }: Props) {
 const ref=useRef<HTMLDivElement>(null);
 const [position,setPosition]=useState<{left:number;top:number}|null>(null);
 const [dismissed,setDismissed]=useState(false);
 const active=!!content.active && !!content.payload?.length && !dismissed;
 useEffect(()=>{
  if(!dismissed)return;
  const resume=()=>setDismissed(false);
  document.addEventListener("pointermove",resume,{once:true});
  return()=>document.removeEventListener("pointermove",resume);
 },[dismissed]);
 useEffect(()=>{
  if(!active)return;
  const dismiss=(event:KeyboardEvent)=>{if(event.key==="Escape"){setDismissed(true);onHoldChange(false);}};
  document.addEventListener("keydown",dismiss);
  return()=>document.removeEventListener("keydown",dismiss);
 },[active,onHoldChange]);
 useLayoutEffect(()=>{
  if(!active){setPosition(null);return;}
  const node=ref.current, chart=anchor.current;
  if(!node||!chart)return;
  const place=()=>{
   const bounds=chart.getBoundingClientRect(),box=node.getBoundingClientRect(),gap=12;
   const x=bounds.left+(coordinate?.x??0),y=bounds.top+(coordinate?.y??0);
   const left=Math.max(gap,Math.min(x+gap+box.width>innerWidth-gap?x-box.width-gap:x+gap,innerWidth-box.width-gap));
   const top=Math.max(gap,Math.min(y-box.height-gap,innerHeight-box.height-gap));
   setPosition(old=>old?.left===left&&old.top===top?old:{left,top});
  };
  place();const observer=new ResizeObserver(place);observer.observe(node);
  addEventListener("resize",place);addEventListener("scroll",place,{passive:true,capture:true});
  return()=>{observer.disconnect();removeEventListener("resize",place);removeEventListener("scroll",place,true);};
 },[active,anchor,coordinate?.x,coordinate?.y,content.payload?.length]);
 if(!active)return null;
 return createPortal(<div ref={ref} role="tooltip" tabIndex={0} data-network-chart-tooltip className="nz-viewport-chart-tooltip"
  style={{left:position?.left??12,top:position?.top??12,visibility:position?"visible":"hidden"}}
  onMouseMove={event=>event.stopPropagation()} onMouseOver={event=>event.stopPropagation()}
  onPointerEnter={()=>onHoldChange(true)} onPointerLeave={()=>onHoldChange(false)}
  onFocus={()=>onHoldChange(true)} onBlur={()=>onHoldChange(false)}
  onKeyDown={event=>{if(event.key==="Escape"){onHoldChange(false);(event.currentTarget as HTMLElement).blur();}}}>
  <ChartTooltipContent {...content}/>
 </div>,document.body);
}
