import {useEffect,useState} from "react";
import {Button} from "./ui/button";
import {Input} from "./ui/input";
import SettingHelp from "./SettingHelp";
import CardLogoPreview from "./CardLogoPreview";
import {logoPlacement,defaultPlacement,type LogoLayout} from "../../../shared/logo-layout";
import type {PublicNote} from "@/lib/public-note";
export default function ProviderLayoutEditor({note,onChange,serverId,name}:{note:PublicNote;onChange:(note:PublicNote)=>void;serverId?:number;name?:string}){
 const [device,setDevice]=useState<"desktop"|"mobile">("mobile");
 const layout=note.planDataMod?.providerLogo?.logoLayout,p=logoPlacement(layout,device);
 const set=(next:LogoLayout)=>onChange({...note,planDataMod:{...note.planDataMod,providerLogo:{...note.planDataMod?.providerLogo,logoLayout:next}}});
 return <div className="min-w-0 w-full space-y-3 rounded-md border p-3" data-provider-layout-editor>
  <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-medium">卡片图标调整</span><SettingHelp label="卡片图标调整">每台服务器单独保存。负值向左/向上，正值向右/向下。缩放保持比例，不改变原图；过大或偏移过多可能遮住文字。预览复用前台卡片，未连接到实时状态时使用示例数据。保存服务器后才生效。</SettingHelp></div>
  <div className="flex gap-2">{(["desktop","mobile"] as const).map(d=><Button type="button" key={d} size="sm" variant={device===d?"default":"outline"} aria-pressed={device===d} onClick={()=>setDevice(d)}>{d==="desktop"?"电脑端":"手机端"}</Button>)}</div>
  {(["x","y","scale"] as const).map(k=><PlacementControl key={k} label={{x:"左右偏移",y:"上下偏移",scale:"图标大小"}[k]} unit={k==="scale"?"%":"px"} min={k==="scale"?25:-150} max={k==="scale"?250:150} value={p[k]} onChange={v=>set({...layout,[device]:{...p,[k]:v}})}/>)}
  <Button type="button" size="sm" variant="outline" onClick={()=>set({...layout,[device]:{...defaultPlacement}})}>恢复{device==="desktop"?"电脑端":"手机端"}默认</Button>
  <CardLogoPreview note={note} serverId={serverId} name={name} device={device}/>
 </div>;
}

function PlacementControl({label,unit,min,max,value,onChange}:{label:string;unit:string;min:number;max:number;value:number;onChange:(v:number)=>void}){
 const [text,setText]=useState(String(value));
 useEffect(()=>setText(String(value)),[value]);
 return <label className="block space-y-1 text-xs"><span>{label}（{unit}）</span><div className="flex items-center gap-3">
 <input className="min-w-0 flex-1" type="range" aria-label={label+"滑块"} min={min} max={max} step={1} value={value} onChange={e=>{setText(e.target.value);onChange(Number(e.target.value))}}/>
 <Input className="w-20" type="number" aria-label={label} min={min} max={max} value={text} onBlur={()=>setText(String(value))} onChange={e=>{setText(e.target.value);const v=e.target.valueAsNumber;if(Number.isFinite(v))onChange(Math.min(max,Math.max(min,v)))}}/>
 </div></label>;
}
