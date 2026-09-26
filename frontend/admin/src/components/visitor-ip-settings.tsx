import {Input} from "@/components/ui/input";
import {Button} from "@/components/ui/button";
import {Switch} from "@/components/ui/switch";
import type {Feature} from "@/lib/appearance-config";
type Props={value:Feature;onChange:(value:Feature)=>void};
export function VisitorIPSettings({value:v,onChange}:Props){
 const set=(key:string,value:unknown)=>onChange({...v,[key]:value});
 const num=(key:string,label:string,min:number,max:number)=><label className="block min-w-0 space-y-1"><span>{label}</span><Input aria-label={label} type="number" min={min} max={max} step={1} value={v[key]} onChange={e=>set(key,Number(e.target.value))}/></label>;
 const toggle=(key:string,label:string)=><label className="flex items-center justify-between gap-3"><span>{label}</span><Switch aria-label={label} checked={v[key]} onCheckedChange={x=>set(key,x)}/></label>;
 return <div className="space-y-6">
 <section className="space-y-3"><h3 className="font-semibold">IP 查询接口</h3>
 <p className="text-sm text-muted-foreground">并行查询，采用第一个有效结果。接口须支持浏览器跨域读取并返回 JSON（ip/query、country_name/country、city/region、asn、org/isp 等字段）。地址会下发到公开前台，不要填写密钥或内部地址；HTTPS 网站请使用 HTTPS 接口。</p>
 {v.ipApiUrls.map((url:string,i:number)=><div key={i} className="flex items-end gap-2"><label className="min-w-0 flex-1">查询接口 {i+1}<Input aria-label={"IP 查询接口 "+(i+1)} value={url} onChange={e=>set("ipApiUrls",v.ipApiUrls.map((s:string,j:number)=>j===i?e.target.value:s))}/></label><Button type="button" variant="outline" aria-label={"删除查询接口 "+(i+1)} disabled={v.ipApiUrls.length===1} onClick={()=>set("ipApiUrls",v.ipApiUrls.filter((_:string,j:number)=>j!==i))}>删除</Button></div>)}
 <Button type="button" variant="outline" disabled={v.ipApiUrls.length>=8} onClick={()=>set("ipApiUrls",[...v.ipApiUrls,""])}>添加查询接口</Button>
 <label className="block space-y-1">信息补全接口（留空关闭）<Input aria-label="信息补全接口（留空关闭）" value={v.fallbackUrl} onChange={e=>set("fallbackUrl",e.target.value)}/></label>
 <div className="grid gap-4 sm:grid-cols-2">{num("queryTimeout","IP 查询超时（毫秒）",100,10000)}{num("fallbackTimeout","信息补全超时（毫秒）",100,10000)}</div>
 </section>
 <section className="space-y-3 border-t pt-4"><h3 className="font-semibold">网络检测节点</h3>{toggle("networkEnabled","启用网络检测")}
 <p className="text-sm text-muted-foreground">电脑端首次并行检测，点击延迟数值按列表切换节点。这是浏览器 HTTP 请求耗时，不是 ICMP Ping 或下载测速；手机端保持原来的简洁显示。</p>
 {v.checkNodes.map((node:{name:string;url:string},i:number)=><div key={i} className="rounded border p-3 space-y-3"><div className="grid gap-3 sm:grid-cols-2">{(["name","url"] as const).map(key=><label key={key} className="block min-w-0">{key==="name"?"节点名称":"检测地址"}<Input aria-label={(key==="name"?"检测节点名称 ":"检测节点地址 ")+(i+1)} value={node[key]} onChange={e=>set("checkNodes",v.checkNodes.map((n:typeof node,j:number)=>j===i?{...n,[key]:e.target.value}:n))}/></label>)}</div>
 <div className="flex gap-2"><Button type="button" variant="outline" disabled={i===0} aria-label={"上移检测节点 "+(i+1)} onClick={()=>{const n=[...v.checkNodes];[n[i-1],n[i]]=[n[i],n[i-1]];set("checkNodes",n)}}>上移</Button><Button type="button" variant="outline" aria-label={"删除检测节点 "+(i+1)} onClick={()=>set("checkNodes",v.checkNodes.filter((_:unknown,j:number)=>j!==i))}>删除</Button></div></div>)}
 <Button type="button" variant="outline" disabled={v.checkNodes.length>=16} onClick={()=>set("checkNodes",[...v.checkNodes,{name:"",url:""}])}>添加检测节点</Button>
 <div className="grid gap-4 sm:grid-cols-2">{num("checkTimeout","首次检测超时（毫秒）",100,10000)}{num("switchTimeout","切换节点超时（毫秒）",100,10000)}</div>
 </section>
 <section className="space-y-3 border-t pt-4"><h3 className="font-semibold">显示内容</h3>
 <p className="text-sm text-muted-foreground">地区开关影响电脑和手机；ASN、运营商和浏览器估算带宽仅在电脑端显示。关闭 ASN 后也会从运营商文本中去除 ASN 编号。</p>
 <div className="grid gap-4 sm:grid-cols-2">{toggle("showRegion","显示地区")}{toggle("showASN","显示 ASN")}{toggle("showOrganization","显示运营商")}{toggle("showDownlink","显示浏览器估算带宽")}</div></section>
 <section className="space-y-3 border-t pt-4"><h3 className="font-semibold">缓存与位置</h3><p className="text-sm text-muted-foreground">缓存有效期 0 表示不读取缓存。变更查询接口后不会沿用旧接口缓存。</p>
 <div className="grid gap-4 sm:grid-cols-2">{num("cacheDuration","缓存有效期（毫秒）",0,604800000)}{num("bottomThreshold","底部隐藏距离（像素）",0,1000)}</div></section>
 </div>;
}
