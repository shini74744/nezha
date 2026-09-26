import {useSyncExternalStore,type ReactNode} from "react";
type Sound={muted:boolean;toggle:()=>Promise<void>};
let current:Sound|null=null;
const listeners=new Set<()=>void>();
const emit=()=>listeners.forEach(fn=>fn());
const subscribe=(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn)}};
export function publishBackgroundSound(value:Sound){
 current=value;emit();
 return()=>{if(current===value){current=null;emit()}};
}
export function BackgroundSoundLogo({children,className}:{children:ReactNode;className?:string}){
 const sound=useSyncExternalStore(subscribe,()=>current,()=>null);
 if(!sound)return <div className={className}>{children}</div>;
 const label=sound.muted?"开启背景声音":"关闭背景声音";
 return <button type="button" className={className+" nz-logo-sound"} title={label}
  aria-label={label} aria-pressed={!sound.muted}
  onClick={event=>{event.stopPropagation();void sound.toggle()}}>{children}</button>;
}