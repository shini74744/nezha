import {useState} from "react";
import {Button} from "@/components/ui/button";
import {Popover,PopoverContent,PopoverTrigger} from "@/components/ui/popover";
import {Command,CommandInput,CommandList,CommandEmpty,CommandItem} from "@/components/ui/command";
export type Choice={value:string;label:string;keywords?:string;icon?:string;background?:string};
export default function Picker({value,label,choices,onChange,disabled=false}:{value:string;label:string;choices:Choice[];onChange:(value:string)=>void;disabled?:boolean}){
 const [open,setOpen]=useState(false),selected=choices.find(c=>c.value===value);
 return <Popover modal open={open} onOpenChange={setOpen}><PopoverTrigger asChild>
  <Button type="button" disabled={disabled} variant="outline" role="combobox" aria-expanded={open}
   aria-label={label} className="w-full min-w-0 justify-start">
   {selected?.icon&&<img src={selected.icon} style={{backgroundColor:selected.background}} alt="" className="h-4 w-6 shrink-0 object-contain rounded-sm bg-stone-700"/>}
   <span className="truncate">{selected?.label||value||"请选择"}</span>
  </Button></PopoverTrigger>
  <PopoverContent align="start" collisionPadding={12} className="w-[min(350px,calc(100vw-40px))] max-h-[var(--radix-popover-content-available-height)] overflow-hidden p-0">
   <Command className="h-auto"><CommandInput placeholder={"搜索"+label} aria-label={"搜索"+label}/>
    <CommandList className="max-h-[min(300px,calc(var(--radix-popover-content-available-height)-48px))] min-h-0 overscroll-contain touch-pan-y" data-carrier-picker-list><CommandEmpty>暂无匹配项</CommandEmpty>
     {choices.map(c=><CommandItem key={c.value||"none"} value={c.value+" "+c.label+" "+(c.keywords||"")} onSelect={()=>{onChange(c.value);setOpen(false)}}>
      {c.icon&&<img src={c.icon} style={{backgroundColor:c.background}} alt="" className="h-5 w-8 shrink-0 object-contain rounded-sm bg-stone-700"/>}
      <span>{c.label}</span>
     </CommandItem>)}
    </CommandList>
   </Command>
  </PopoverContent>
 </Popover>;
}
