import SettingHelp from "./SettingHelp";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {type PublicNote} from "@/lib/public-note";
import {safeLink,type LinkTag} from "../../../shared/link-tags";
export default function LinkTagsEditor({note,onChange}:{note:PublicNote;onChange:(note:PublicNote)=>void}){
 const tags=note.planDataMod?.linkTags||[];
 const update=(linkTags:LinkTag[])=>onChange({...note,planDataMod:{...note.planDataMod,linkTags}});
 return <fieldset className="space-y-2 sm:col-span-2" data-link-tags-editor>
  <legend className="text-xs font-medium">链接标签<SettingHelp label="链接标签">显示在服务器名称、价格和剩余天数下方；点击在新标签页打开网址，不进入详情。最多 20 个。网址可直接填写域名，未填写协议时按 HTTPS 打开；也支持完整的 HTTP/HTTPS 地址，填写 HTTP 时不会强制改为 HTTPS。</SettingHelp></legend>
  {tags.map((tag,index)=><div key={index} className="space-y-1">
   <div className="grid grid-cols-1 sm:grid-cols-[1fr_2fr_auto] gap-2">
    <Input aria-label={"标签名称 "+(index+1)} maxLength={60} value={tag.name}
     onChange={e=>update(tags.map((t,i)=>i===index?{...t,name:e.target.value}:t))}/>
    <Input aria-label={"标签网址 "+(index+1)} maxLength={2048} value={tag.url}
     onChange={e=>update(tags.map((t,i)=>i===index?{...t,url:e.target.value}:t))}/>
    <Button type="button" variant="outline" size="sm" aria-label={"删除标签 "+(index+1)} onClick={()=>update(tags.filter((_,i)=>i!==index))}>删除</Button>
   </div>
   {(tag.name||tag.url)&&(!tag.name.trim()||!safeLink(tag.url))&&<p role="alert" className="text-xs text-destructive">请填写标签名称和有效网址（可直接填写域名，无需填写 http:// 或 https://）。</p>}
  </div>)}
  <Button type="button" variant="outline" size="sm" disabled={tags.length>=20} onClick={()=>update([...tags,{name:"",url:""}])}>添加链接标签</Button>
 </fieldset>;
}
