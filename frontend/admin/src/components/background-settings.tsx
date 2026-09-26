import {useEffect,useRef,useState} from "react";
import {Input} from "@/components/ui/input";
import {Textarea} from "@/components/ui/textarea";
import {Switch} from "@/components/ui/switch";
import {Button} from "@/components/ui/button";
import {mediaLines,parseMediaLines,readPath,type Media,type ScheduleRule} from "@/lib/background-config";
import type {Feature} from "@/lib/appearance-config";
export function MediaLines({label,value,onChange}:{label:string;value:Media[];onChange:(next:Media[])=>void}){
 const [text,setText]=useState(()=>mediaLines(value)),last=useRef(JSON.stringify(value));
 useEffect(()=>{const serialized=JSON.stringify(value);if(last.current!==serialized){last.current=serialized;setText(mediaLines(value))}},[value]);
 return <label className="block space-y-2"><span>{label}（每行一条）</span><Textarea aria-label={label} rows={4} value={text} placeholder={"https://example.com/background.jpg\nhttps://example.com/background.mp4"} onChange={e=>{setText(e.target.value);const next=parseMediaLines(e.target.value,value);last.current=JSON.stringify(next);onChange(next)}}/></label>;
}
export function BackgroundSettings({value:f,sound,onChange,onSoundChange}:{value:Feature;sound:Feature;onChange:(f:Feature)=>void;onSoundChange:(f:Feature)=>void}){
 const [lookup,setLookup]=useState(""),[testing,setTesting]=useState(false);
 const update=(key:string,value:unknown)=>onChange({...f,[key]:value});
 const toggle=(key:string,label:string)=><label className="flex items-center justify-between gap-3"><span>{label}</span><Switch aria-label={label} checked={f[key]} onCheckedChange={v=>update(key,v)}/></label>;
 const field=(key:string,label:string,type="text")=><label className="block space-y-1"><span>{label}</span><Input aria-label={label} type={type} value={f[key]} onChange={e=>update(key,type==="number"?Number(e.target.value):e.target.value)}/></label>;
 const textList=(key:string,label:string)=><label className="block space-y-1"><span>{label}（逗号或换行分隔）</span><Textarea aria-label={label} value={f[key].join(", ")} onChange={e=>update(key,e.target.value.split(/[,，\n]/).map((v:string)=>v.trim()))}/></label>;
 const patchRule=(index:number,patch:Partial<ScheduleRule>)=>update("scheduleRules",f.scheduleRules.map((r:ScheduleRule,i:number)=>i===index?{...r,...patch}:r));
 const testLookup=async()=>{setTesting(true);setLookup("");try{const response=await fetch(f.regionApi,{credentials:"omit",signal:AbortSignal.timeout(8000)});if(!response.ok)throw Error("HTTP "+response.status);const data=await response.json();setLookup("运营商："+(readPath(data,f.regionOrgPath)||"未找到")+"；地区："+(readPath(data,f.regionCountryPath)||"未找到"))}catch(e){setLookup("查询失败："+String(e)+"。接口需允许浏览器跨域访问。")}finally{setTesting(false)}};
 return <div className="space-y-6">
  <p className="text-sm text-muted-foreground">每行填写一个直接返回图片或视频的地址，可混合使用。进入页面随机选择一条，加载失败尝试下一条；HTTPS 站点建议填写 HTTPS 地址。</p>
  <div className="grid gap-4 md:grid-cols-2">
   <MediaLines label="电脑背景地址" value={f.desktopMedia} onChange={v=>update("desktopMedia",v)}/>
   <MediaLines label="手机背景地址" value={f.mobileMedia} onChange={v=>update("mobileMedia",v)}/>
  </div>
  <p className="text-sm text-muted-foreground">手机列表留空时使用电脑列表。旧地址的图片/视频类型保留，新地址自动识别。</p>
  <fieldset className="rounded border p-4 space-y-4"><legend className="px-2 font-semibold">分时背景</legend>
   {toggle("scheduleEnabled","启用分时背景")}
   <div className="grid gap-4 sm:grid-cols-2">{field("timezone","分时时区")}{toggle("showScheduleNotice","显示分时切换提示")}</div>
   <p className="text-sm text-muted-foreground">例如 Asia/Shanghai 或 UTC；开始时间包含、结束时间不包含，支持跨午夜，相同时间表示全天。重叠时按列表从上到下匹配，页面停留时自动切换。</p>
   {f.scheduleRules.map((r:ScheduleRule,i:number)=><div key={i} className="rounded border p-3 space-y-3" data-schedule-rule={i}>
    <div className="flex items-center gap-3"><Input aria-label={"分时规则名称 "+(i+1)} value={r.name} onChange={e=>patchRule(i,{name:e.target.value})}/><Switch aria-label={"启用分时规则 "+(i+1)} checked={r.enabled} onCheckedChange={enabled=>patchRule(i,{enabled})}/></div>
    <div className="grid gap-3 sm:grid-cols-2"><label>开始时间<Input aria-label={"开始时间 "+(i+1)} type="time" value={r.start} onChange={e=>patchRule(i,{start:e.target.value})}/></label><label>结束时间<Input aria-label={"结束时间 "+(i+1)} type="time" value={r.end} onChange={e=>patchRule(i,{end:e.target.value})}/></label></div>
    <div className="grid gap-3 md:grid-cols-2"><MediaLines label={"分时电脑背景 "+(i+1)} value={r.desktopMedia} onChange={desktopMedia=>patchRule(i,{desktopMedia})}/><MediaLines label={"分时手机背景 "+(i+1)} value={r.mobileMedia} onChange={mobileMedia=>patchRule(i,{mobileMedia})}/></div>
    <div className="flex gap-2"><Button type="button" variant="outline" disabled={i===0} onClick={()=>{const rules=[...f.scheduleRules];[rules[i-1],rules[i]]=[rules[i],rules[i-1]];update("scheduleRules",rules)}}>上移规则</Button><Button type="button" variant="outline" onClick={()=>update("scheduleRules",f.scheduleRules.filter((_:unknown,j:number)=>j!==i))}>删除规则</Button></div>
   </div>)}
   <Button type="button" variant="outline" onClick={()=>update("scheduleRules",[...f.scheduleRules,{name:"新分时规则",enabled:false,start:"22:00",end:"06:00",desktopMedia:[],mobileMedia:[]}])}>添加分时规则</Button>
  </fieldset>
  <fieldset className="rounded border p-4 space-y-4"><legend className="px-2 font-semibold">特殊地区背景与运营商查询</legend>
   {toggle("regionEnabled","启用特殊地区背景")}
   {field("regionApi","运营商查询地址")}
   <div className="grid gap-4 sm:grid-cols-2">{field("regionOrgPath","运营商字段路径")}{field("regionCountryPath","地区字段路径")}</div>
   <p className="text-sm text-muted-foreground">接口返回 JSON，例如 org、country；嵌套字段可填 asn.asn、data.country。查询失败使用普通/分时背景，不影响面板。</p>
   <Button type="button" variant="outline" disabled={testing||!f.regionApi} onClick={()=>void testLookup()}>{testing?"查询中…":"测试运营商查询"}</Button>{lookup&&<p role="status" className="text-sm break-all">{lookup}</p>}
   <div className="grid gap-4 sm:grid-cols-2">{textList("asns","运营商 ASN 或关键词")}{textList("regionCountries","国家或地区代码")}</div>
   <p className="text-sm text-muted-foreground">运营商关键词为包含匹配，地区代码为精确匹配；任意一项命中即生效。两项均留空则不匹配。</p>
   <div className="grid gap-4 md:grid-cols-2"><MediaLines label="特殊地区电脑背景" value={f.chinaMedia} onChange={v=>update("chinaMedia",v)}/><MediaLines label="特殊地区手机背景" value={f.regionMobileMedia} onChange={v=>update("regionMobileMedia",v)}/></div>
   <label className="block space-y-1"><span>背景规则优先级</span><select aria-label="背景规则优先级" className="w-full rounded border bg-background p-2" value={f.priority} onChange={e=>update("priority",e.target.value)}><option value="region-first">特殊地区优先，其次分时，最后普通背景</option><option value="schedule-first">分时优先，其次特殊地区，最后普通背景</option></select></label>
  </fieldset>
  <fieldset className="rounded border p-4 space-y-4"><legend className="px-2 font-semibold">背景视频与关联设置</legend>
   <div className="grid gap-4 sm:grid-cols-2">
    {field("blur","卡片模糊（像素）","number")}{field("opacity","卡片背景不透明度","number")}{toggle("peakCutDesktop","普通电脑背景下网络图默认启用削峰")}
    {[["enabled","视频声音控制"],["showControl","显示独立声音按钮"],["toggleMuteOnControlClick","允许按钮切换静音"],["unmuteOnVideoClick","点击背景视频开启声音"]].map(([key,label])=><label key={key} className="flex items-center justify-between gap-3"><span>{label}</span><Switch aria-label={label} checked={sound[key]} onCheckedChange={v=>onSoundChange({...sound,[key]:v})}/></label>)}
   </div>
   <p className="text-sm text-muted-foreground">视频默认静音自动播放，开启声音需要点击专用按钮。普通电脑分支可关联网络图削峰；手机、分时和特殊地区分支不强制开启。</p>
  </fieldset>
 </div>;
}
