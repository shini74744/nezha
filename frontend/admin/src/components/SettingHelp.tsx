import {useEffect,useRef,useState,type ReactNode} from "react";
import {Popover,PopoverContent,PopoverTrigger} from "@/components/ui/popover";
export default function SettingHelp({label,children}:{label:string;children:ReactNode}){
 const [open,setOpen]=useState(false);
 const closedByScroll=useRef(false);
 useEffect(()=>{
  if(!open)return;
  const dismiss=()=>{closedByScroll.current=true;setOpen(false)};
  const options={capture:true,passive:true};
  window.addEventListener("wheel",dismiss,options);
  window.addEventListener("touchmove",dismiss,options);
  window.addEventListener("scroll",dismiss,options);
  return ()=>{
   window.removeEventListener("wheel",dismiss,true);
   window.removeEventListener("touchmove",dismiss,true);
   window.removeEventListener("scroll",dismiss,true);
  };
 },[open]);
 return <Popover open={open} onOpenChange={value=>{if(value)closedByScroll.current=false;setOpen(value)}}>
  <PopoverTrigger asChild><button type="button" aria-label={label+"说明"} className="ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] font-normal text-muted-foreground align-middle">?</button></PopoverTrigger>
  <PopoverContent align="start" collisionPadding={12} className="w-[min(300px,calc(100vw-40px))] text-xs leading-relaxed" data-setting-help
   onCloseAutoFocus={event=>{if(closedByScroll.current)event.preventDefault()}}>{children}</PopoverContent>
 </Popover>;
}
