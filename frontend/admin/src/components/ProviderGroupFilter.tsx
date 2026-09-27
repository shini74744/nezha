import {useState} from "react";
import {Button} from "./ui/button";
import {Input} from "./ui/input";
import {Dialog,DialogContent,DialogHeader,DialogTitle} from "./ui/dialog";
import Picker from "./LogoChoicePicker";
import useLogoGroups from "@/hooks/useLogoGroups";
import {fetcher,FetcherMethod} from "@/api/api";
export default function ProviderGroupFilter({value,onChange,onUpdated}:{value:string;onChange:(id:string)=>void;onUpdated:()=>void}){
 const {data:groups,error,mutate}=useLogoGroups(),[edit,setEdit]=useState<{id:string;name:string;version:number}|null>(null),[busy,setBusy]=useState(false),[failure,setFailure]=useState("");
 const group=groups?.find(g=>g.id===value);
 const save=async()=>{if(!edit||busy)return;setBusy(true);setFailure("");try{const saved=await fetcher<{id:string}>(edit.id?FetcherMethod.PUT:FetcherMethod.POST,"/api/v1/logo/groups"+(edit.id?"/"+edit.id:""),edit);await mutate();onChange(saved.id);setEdit(null);onUpdated()}catch(e){setFailure(String(e))}finally{setBusy(false)}};
 const remove=async()=>{if(!group||busy||!confirm("删除分组“"+group.name+"”？厂商将移到未分组，已有服务器不受影响。"))return;setBusy(true);setFailure("");try{await fetcher(FetcherMethod.DELETE,"/api/v1/logo/groups/"+group.id,{version:group.version});await mutate();onChange("_ungrouped");onUpdated()}catch(e){setFailure(String(e))}finally{setBusy(false)}};
 return <div className="space-y-2"><div className="flex flex-wrap items-center gap-2"><div className="min-w-40 flex-1"><Picker disabled={busy} value={value} label="厂商分组" choices={[{value:"",label:"全部分组"},{value:"_ungrouped",label:"未分组"},...(groups||[]).map(g=>({value:g.id,label:g.name}))]} onChange={onChange}/></div><Button disabled={busy||!!error} variant="outline" onClick={()=>{setFailure("");setEdit({id:"",name:"",version:0})}}>新建分组</Button>{group&&<><Button disabled={busy} variant="outline" onClick={()=>{setFailure("");setEdit(group)}}>重命名分组</Button><Button disabled={busy} variant="outline" onClick={()=>void remove()}>删除分组</Button></>}</div>{(failure||error)&&<p role="alert" className="text-xs text-destructive">{failure||"分组加载失败，请刷新重试"}</p>}
 {edit&&<Dialog open onOpenChange={v=>{if(!v&&!busy)setEdit(null)}}><DialogContent><DialogHeader><DialogTitle>{edit.id?"重命名分组":"新建厂商分组"}</DialogTitle></DialogHeader><form className="space-y-3" onSubmit={e=>{e.preventDefault();void save()}}><Input required maxLength={60} autoFocus disabled={busy} aria-label="分组名称" placeholder="例如：常用厂商 / 香港 / 日本" value={edit.name} onChange={e=>setEdit({...edit,name:e.target.value})}/>{failure&&<p role="alert">{failure}</p>}<Button type="submit" disabled={busy||!edit.name.trim()}>保存分组</Button></form></DialogContent></Dialog>}</div>;
}
