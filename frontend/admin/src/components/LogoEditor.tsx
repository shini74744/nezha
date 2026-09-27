import SettingHelp from "./SettingHelp";
import {useEffect,useRef,useState} from "react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {fetcher,FetcherMethod} from "@/api/api";
import type {LogoValue} from "../../../shared/logo";
import {processLogo} from "@/lib/logo-image";
export default function LogoEditor({value,label,onChange,builtIn=false,locked=false,onBusyChange}:{value:LogoValue;label:string;onChange:(v:LogoValue)=>void;builtIn?:boolean;locked?:boolean;onBusyChange?:(busy:boolean)=>void}){
 const [address,setAddress]=useState(value.logoWebsite||(value.logo?.startsWith("https:")?value.logo:"")||""),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState("");
 const sequence=useRef(0),change=useRef(onChange),active=useRef(false),busyChange=useRef(onBusyChange);change.current=onChange;busyChange.current=onBusyChange;useEffect(()=>()=>{sequence.current++;if(active.current)busyChange.current?.(false)},[]);
 const run=async(source:()=>Promise<{image:string;website?:string}>)=>{const id=++sequence.current;setBusy(true);active.current=true;busyChange.current?.(true);setError("");setMessage("");try{const input=await source(),result=await processLogo(input.image);if(id!==sequence.current)return;const stored=await fetcher<LogoValue>(FetcherMethod.POST,"/api/v1/logo/store",{logo:result.logo,logoOriginal:result.logoOriginal});if(id!==sequence.current)return;change.current({...stored,logoWebsite:input.website||""});setMessage((result.height<56?`已保存 ${result.width}×${result.height}；来源分辨率较低，不会强行放大。`:`已保存 ${result.width}×${result.height}。`)+(result.removed?"已去除纯色底，可恢复原图。":""))}catch(e){if(id===sequence.current)setError(e instanceof Error?e.message:"Logo 处理失败")}finally{if(id===sequence.current){setBusy(false);active.current=false;busyChange.current?.(false)}}};
 const fetchLogo=(mode:"website"|"image")=>run(async()=>{const r=await fetcher<{image:string}>(FetcherMethod.POST,"/api/v1/logo/fetch",{url:address,mode});return {image:r.image,website:address}});
 return <div className="space-y-2" data-logo-editor>
  <div className="flex gap-2"><Input disabled={locked||busy} aria-label={"Logo 地址 "+label} placeholder="网站或 HTTPS 图片地址，例如 www.starhub.com" value={address} onChange={e=>setAddress(e.target.value)}/>
   <Button disabled={locked||busy||!address.trim()} type="button" variant="outline" aria-label={"自动获取 Logo "+label} onClick={()=>void fetchLogo("website")}>{busy?"处理中…":"自动"}</Button></div>
  <Button type="button" size="sm" variant="outline" disabled={locked||busy||!address} onClick={()=>void fetchLogo("image")}>使用图片地址</Button>
  <div className="block text-xs">上传 Logo<SettingHelp label={"上传 Logo "+label}>支持 PNG/JPEG/WebP/GIF。自动获取会优先选大尺寸图标，官网不可用时仅向公共缓存查询域名。上传后保守去除纯色底，保留原图。图片和地址会公开，请勿填密钥；小尺寸原图不能变成真正的高清图。</SettingHelp>
   <input disabled={locked||busy} aria-label={"上传 Logo "+label} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="block mt-1 max-w-full" onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(!file)return;if(!["image/png","image/jpeg","image/webp","image/gif"].includes(file.type)){setError("请上传 PNG/JPEG/WebP/GIF 图片");return}void run(()=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error("Logo 读取失败"));reader.onload=()=>resolve({image:String(reader.result)});reader.readAsDataURL(file)}))}}/></div>
  <div className="flex flex-wrap gap-2"><Button type="button" size="sm" disabled={locked||busy} variant="outline" onClick={()=>{sequence.current++;change.current({logo:"",logoOriginal:"",logoWebsite:""});setAddress("");setMessage("");setError("")}}>{builtIn?"恢复自带 Logo":"清除 Logo"}</Button>
   {value.logoOriginal&&value.logo!==value.logoOriginal&&<Button type="button" size="sm" disabled={locked||busy} variant="outline" onClick={()=>{change.current({...value,logo:value.logoOriginal});setMessage("已恢复原图");setError("")}}>恢复原图</Button>}</div>
  {message&&<p role="status" className="text-xs text-muted-foreground">{message}</p>}{error&&<p role="alert" className="text-xs text-destructive">{error}，当前 Logo 未更改。</p>}
 </div>;
}
