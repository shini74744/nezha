import {AppearanceSection} from "@/components/appearance-section"
import {Switch} from "@/components/ui/switch"
import type {Feature} from "@/lib/appearance-config"

const groups = [
 {title:"单台服务器卡片速率",enabled:"cardEnabled",description:"控制每台服务器卡片和列表中的上传、下载速率。",fields:[["bits","转换成 Mbps/Gbps"],["color","启用上下行颜色"],["animation","启用高速率动画"]]},
 {title:"网络概览卡片速率",enabled:"overviewEnabled",description:"控制顶部网络概览中汇总的上下行速率，不影响累计流量。",fields:[["overviewBits","转换成 Mbps/Gbps"],["overviewColor","启用上下行颜色"],["overviewAnimation","启用高速率动画"]]},
]
export function SpeedSettings({value,onChange}:{value:Feature;onChange:(next:Feature)=>void}){
 const update=(key:string,next:boolean)=>onChange({...value,[key]:next})
 return <div className="space-y-4">
  <p className="text-sm text-muted-foreground">两组设置互不影响；外层开关统一控制这两组速率美化。</p>
  {groups.map(group=><AppearanceSection key={group.enabled} headingLevel={3} title={group.title} description={group.description} enabled={value[group.enabled]} onEnabledChange={next=>update(group.enabled,next)}>
   <div className="grid gap-4 sm:grid-cols-2">
    {group.fields.map(([key,label])=><label key={key} className="flex items-center justify-between gap-3">
     <span>{label}</span><Switch aria-label={group.title+"："+label} checked={value[key]} onCheckedChange={next=>update(key,next)}/>
    </label>)}
   </div>
  </AppearanceSection>)}
 </div>
}
