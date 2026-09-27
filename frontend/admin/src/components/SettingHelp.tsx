import type {ReactNode} from "react";
import {Popover,PopoverContent,PopoverTrigger} from "@/components/ui/popover";
export default function SettingHelp({label,children}:{label:string;children:ReactNode}){
 return <Popover modal><PopoverTrigger asChild><button type="button" aria-label={label+"说明"} className="ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] font-normal text-muted-foreground align-middle">?</button></PopoverTrigger>
  <PopoverContent align="start" collisionPadding={12} className="w-[min(300px,calc(100vw-40px))] text-xs leading-relaxed" data-setting-help>{children}</PopoverContent></Popover>;
}
