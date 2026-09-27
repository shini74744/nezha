import {useEffect,useRef,useState} from "react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {fetcher,FetcherMethod} from "@/api/api";
import {safeLogoSource} from "../../../shared/other-routes";
import type {LogoValue} from "../../../shared/logo";
import {processLogo} from "@/lib/logo-image";
export default function LogoEditor({value,label,onChange,builtIn=false,locked=false,onBusyChange}:{value:LogoValue;label:string;onChange:(v:LogoValue)=>void;builtIn?:boolean;locked?:boolean;onBusyChange?:(busy:boolean)=>void}){
 const [address,setAddress]=useState(value.logoWebsite||(value.logo?.startsWith("https:")?value.logo:"")||""),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState("");
 const sequence=useRef(0),change=useRef(onChange),active=useRef(false),busyChange=useRef(onBusyChange);change.current=onChange;busyChange.current=onBusyChange;useEffect(()=>()=>{sequence.current++;if(active.current)busyChange.current?.(false)},[]);
 const run=async(source:()=>Promise<{image:string;website?:string}>)=>{const id=++sequence.current;setBusy(true);active.current=true;busyChange.current?.(true);setError("");setMessage("");try{const input=await source(),result=await processLogo(input.image);if(id!==sequence.current)return;change.current({logo:result.logo,logoOriginal:result.logoOriginal,logoWebsite:input.website||""});setMessage(result.removed?"已去除边缘纯色背景，可恢复原图。":"已保留图案并裁剪透明留白；复杂背景不会强行去除。")}catch(e){if(id===sequence.current)setError(e instanceof Error?e.message:"Logo 处理失败")}finally{if(id===sequence.current){setBusy(false);active.current=false;busyChange.current?.(false)}}};
 const fetchLogo=(mode:"website"|"image")=>run(async()=>{const r=await fetcher<{image:string}>(FetcherMethod.POST,"/api/v1/logo/fetch",{url:address,mode});return {image:r.image,website:mode==="website"?address:""}});
 return <div className="space-y-2" data-logo-editor>
  <div className="flex gap-2"><Input disabled={locked||busy} aria-label={"Logo 地址 "+label} placeholder="网站或 HTTPS 图片地址，例如 www.starhub.com" value={address} onChange={e=>setAddress(e.target.value)}/>
   <Button disabled={locked||busy||!address.trim()} type="button" variant="outline" aria-label={"自动获取 Logo "+label} onClick={()=>void fetchLogo("website")}>{busy?"处理中…":"自动"}</Button></div>
  <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={locked||busy||!address} onClick={()=>{const logo=safeLogoSource(address);if(!logo||logo.startsWith("data:")){setError("图片地址须为 HTTPS；网站地址请点击自动。");return}sequence.current++;change.current({logo,logoOriginal:"",logoWebsite:""});setMessage("已使用图片地址；可点击处理透明背景。");setError("")}}>使用图片地址</Button>
   <Button type="button" size="sm" variant="outline" disabled={locked||busy||!address} onClick={()=>void fetchLogo("image")}>处理图片透明背景</Button></div>
  <label className="block text-xs">或上传 Logo（PNG/JPEG/WebP/GIF，前台固定尺寸）
   <input disabled={locked||busy} aria-label={"上传 Logo "+label} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="block mt-1 max-w-full" onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(!file)return;if(!["image/png","image/jpeg","image/webp","image/gif"].includes(file.type)){setError("请上传 PNG/JPEG/WebP/GIF 图片");return}void run(()=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error("Logo 读取失败"));reader.onload=()=>resolve({image:String(reader.result)});reader.readAsDataURL(file)}))}}/></label>
  <p className="text-xs text-muted-foreground">自动获取网站图标；官网不可用时仅向公共图标缓存查询域名。上传后保守去除纯色底，可恢复原图。地址及图片会公开，请勿填密钥。</p>
  <div className="flex flex-wrap gap-2"><Button type="button" size="sm" disabled={locked||busy} variant="outline" onClick={()=>{sequence.current++;change.current({logo:"",logoOriginal:"",logoWebsite:""});setAddress("");setMessage("");setError("")}}>{builtIn?"恢复自带 Logo":"清除 Logo"}</Button>
   {value.logoOriginal&&value.logo!==value.logoOriginal&&<Button type="button" size="sm" disabled={locked||busy} variant="outline" onClick={()=>{change.current({...value,logo:value.logoOriginal});setMessage("已恢复原图");setError("")}}>恢复原图</Button>}</div>
  {message&&<p role="status" className="text-xs text-muted-foreground">{message}</p>}{error&&<p role="alert" className="text-xs text-destructive">{error}，当前 Logo 未更改。</p>}
 </div>;
}
