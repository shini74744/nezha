import {useSyncExternalStore,type ReactNode} from "react";
type Sound={muted:boolean;toggle:()=>Promise<void>};
let current:Sound|null=null;
const listeners=new Set<()=>void>();
const emit=()=>listeners.forEach(fn=>{fn();});
const subscribe=(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn)}};
export function publishBackgroundSound(value:Sound){
 current=value;emit();
 return()=>{if(current===value){current=null;emit()}};
}
export function BackgroundSoundLogo({children,className}:{children:ReactNode;className?:string}){
 const sound=useSyncExternalStore(subscribe,()=>current,()=>null);
 const label=sound?.muted?"开启背景声音":"关闭背景声音";
 // Keep the logo mounted when video readiness adds/removes its sound control.
 return <div className={`relative shrink-0 ${className||""}`}>
  {children}
  {sound&&<button type="button" className="absolute inset-0 z-10 rounded-sm nz-logo-sound" title={label}
   aria-label={label} aria-pressed={!sound.muted}
   onClick={event=>{event.stopPropagation();void sound.toggle()}}/>}
 </div>;
}