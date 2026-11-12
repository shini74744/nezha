import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import useSWR from "swr"
import { Shield, ArrowLeft, RefreshCw, Search } from "lucide-react"
import { toast } from "sonner"
import { fetcher, FetcherMethod, swrFetcher } from "@/api/api"
import { useSSHRead } from "@/hooks/use-ssh-read"
import { SSHListPager } from "@/components/ssh-list-pager"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { useAuth } from "@/hooks/useAuth"
import { useNotification } from "@/hooks/useNotfication"

type Policy = {
 enabled: boolean; success: boolean; failure: boolean; notification_group_id: number
 ports: number[]; auto_ban: boolean; whitelist_only: boolean; max_retry: number; find_time: number; ban_time: number
 block_times?:Record<string,number>; allowlist: string[]; revision: number; block_ips: string[]; block_updated_at: number
}
type BanEntry = {ip:string;banned_at:number;expires_at:number}
type BanPage = {items:BanEntry[];total:number;page:number;page_size:number;observed_at:number;complete:boolean}
type Status = { ban_paging?:boolean;ban_total?:number; imported_allowlist?: string[]; updated_at: number; revision: number; source: string; message: string; ports: number[]; banned: string[]; ban_ready: boolean; block_ready: boolean; dropped: number; reused: boolean; migrated: boolean; existing?: {active: boolean; ports: number[]; max_retry: number; find_time: number; ban_time: number; allowlist: string[]} }
type Row = { id: number; name: string; policy: Policy; status: Status }
type Event = { id: string; time: number; username: string; source_ip: string; port: number; method: string; success: boolean; reason: string }
export function parseSSHPorts(value: string) {
 const parts = value.trim().split(/[,，\s]+/)
 if (!value.trim() || parts.some(v => !/^\d+$/.test(v))) throw Error("端口须为 1–65535 的整数，以逗号分隔")
 const ports = parts.map(Number)
 if (ports.length > 32 || ports.some(v => v < 1 || v > 65535) || new Set(ports).size !== ports.length) throw Error("请选择 1–32 个不重复的有效端口")
 return ports.sort((a,b) => a-b)
}
const when = (n: number) => n ? new Date(n).toLocaleString("zh-CN", { hour12: false }) : "—"
const stateText = (row: Row) => {
 if (!row.status.updated_at) return "等待连接"
 if (Date.now()/1000 - row.status.updated_at > 45) return "暂未连接"
 if (row.policy.revision !== row.status.revision) return "等待设置生效"
 return row.status.message || (row.policy.enabled ? "监测中" : "未启用")
}
const stateClass=(row:Row)=>stateText(row)==="监测中"?"text-emerald-600 dark:text-emerald-400":"text-muted-foreground"
export default function SSHLoginPage() {
 const { profile } = useAuth()
 const admin = profile?.role === 0
 const { notifierGroup } = useNotification()
 const { data, error, isLoading, mutate } = useSWR<Row[]>(admin ? "/api/v1/ssh-login" : null, swrFetcher, { refreshInterval: 10000 })
 const [activeTab,setActiveTab]=useState("settings")
 const [selected, setSelected] = useState<number | null>(null)
 const [search, setSearch] = useState("")
 const [draft, setDraft] = useState<Policy | null>(null)
 const [ports, setPorts] = useState("")
 const [allowlist, setAllowlist] = useState("")
 const [blockIPs,setBlockIPs]=useState("")
 const [dirty, setDirty] = useState(false)
 const [saving, setSaving] = useState(false)
 const [unbanning, setUnbanning] = useState("")
 const [banSearch,setBanSearch]=useState("")
 const [debouncedBanSearch,setDebouncedBanSearch]=useState("")
 const [banPage,setBanPage]=useState(1)
 const [banSize,setBanSize]=useState(20)
 const [manualSearch,setManualSearch]=useState("")
 const [manualPage,setManualPage]=useState(1)
 const [manualSize,setManualSize]=useState(20)
 useEffect(()=>{const t=setTimeout(()=>{setDebouncedBanSearch(banSearch.trim());setBanPage(1)},300);return()=>clearTimeout(t)},[banSearch])

 const row = data?.find(r => r.id === selected)
 const rows = useMemo(() => (data || []).filter(r => (r.name + " " + r.id).toLowerCase().includes(search.toLowerCase())), [data, search])
 const eventsKey=admin&&selected&&activeTab==="records"?`/api/v1/ssh-login/${selected}/events`:null
 const {data:events,error:eventsError,loading:eventsLoading,refresh:refreshEvents}=useSSHRead<Event[]>(eventsKey,String(selected))
 const bansKey=admin&&selected&&activeTab==="bans"?"/api/v1/ssh-login/"+selected+"/bans?page="+banPage+"&page_size="+banSize+"&search="+encodeURIComponent(debouncedBanSearch):null
 const {data:bans,error:bansError,loading:bansLoading,current:bansCurrent,refresh:refreshBans}=useSSHRead<BanPage>(bansKey,selected+"|"+debouncedBanSearch)
 const manualFiltered=(row?.policy.block_ips||[]).filter(ip=>ip.toLowerCase().includes(manualSearch.trim().toLowerCase()))
 const actualManualPage=Math.min(manualPage,Math.max(1,Math.ceil(manualFiltered.length/manualSize)))
 const manualItems=manualFiltered.slice((actualManualPage-1)*manualSize,actualManualPage*manualSize)
 useEffect(()=>{if(bansCurrent&&!bansLoading&&bans&&bans.page!==banPage)setBanPage(bans.page)},[bans,bansCurrent,bansLoading,banPage])
 useEffect(() => {
  if (row && !dirty) {
   const e=row.status.existing
   const p=row.policy.revision===0 && e?.active ? {...row.policy,auto_ban:true,ports:e.ports.length?e.ports:row.policy.ports,max_retry:e.max_retry||row.policy.max_retry,find_time:e.find_time||row.policy.find_time,ban_time:e.ban_time||row.policy.ban_time,allowlist:e.allowlist} : row.policy
   setDraft(p);setPorts(p.ports.join(", "));setAllowlist([...new Set([...(p.allowlist || []),...(row.status.imported_allowlist||[])])].join("\n"));setBlockIPs((row.policy.block_ips||[]).join("\n"))}
 }, [row, dirty])
 function choose(id: number) {
  if (id === selected) return
  if (dirty && !window.confirm("当前修改尚未保存，切换服务器将放弃这些修改。")) return
  setSelected(id);setDirty(false);setDraft(null);setActiveTab("settings");setBanPage(1);setBanSearch("");setDebouncedBanSearch("");setManualPage(1);setManualSearch("")
 }
 function patch(next: Partial<Policy>) {setDirty(true);setDraft(p => p ? {...p,...next} : p)}
 async function save() {
  if (!row || !draft) return
  try {
   const policy = {...draft,ports:parseSSHPorts(ports),allowlist:allowlist.split(/[,，\s]+/).filter(Boolean),block_ips:blockIPs.split(/[,，\s]+/).filter(Boolean)}
   if (policy.enabled && policy.whitelist_only && !policy.allowlist.length) throw Error("仅白名单模式需要至少一个有效 IP 或网段")
   if (policy.enabled && (policy.success || policy.failure) && !policy.notification_group_id) throw Error("请选择通知组")
   if (!Number.isInteger(policy.max_retry) || policy.max_retry < 1 || policy.max_retry > 1000 || !Number.isInteger(policy.find_time) || policy.find_time < 10 || policy.find_time > 604800 || !Number.isInteger(policy.ban_time) || (policy.ban_time !== -1 && (policy.ban_time < 60 || policy.ban_time > 31536000))) throw Error("请检查失败次数、统计时间和封禁时长")
   setSaving(true)
   await fetcher(FetcherMethod.PUT,"/api/v1/ssh-login",{server_ids:[row.id],policy})
   setDirty(false);await mutate();toast.success("设置已保存，等待生效")
  } catch(e) {toast.error(e instanceof Error ? e.message : "保存失败")}
  finally {setSaving(false)}
 }
 async function unban(ip: string) {
  if (!row) return
  try {
   setUnbanning(ip)
   await fetcher(FetcherMethod.POST,"/api/v1/ssh-login/unban",{server_id:row.id,ip})
   toast.success("解封请求已提交，请等待服务器确认")
   await mutate();void refreshBans().catch(()=>{})
  } catch(e) {toast.error(e instanceof Error ? e.message : "解封失败")}
  finally {setUnbanning("")}
 }

 async function ipAction(ip:string,action:"whitelist"|"blacklist"){
  if(!row||dirty||saving)return
  setSaving(true)
  try{
   await fetcher(FetcherMethod.POST,"/api/v1/ssh-login/ip-action",{server_id:row.id,ip,action,revision:row.policy.revision})
   await mutate()
   toast.success(action==="whitelist"?"白名单已保存，等待解封确认":"已加入黑名单，等待生效")
   void refreshBans().catch(()=>{})
  }catch(e){toast.error(e instanceof Error?e.message:"操作失败");void mutate()}
  finally{setSaving(false)}
 }
 async function removeBlacklist(ip:string){
  if(!row||dirty)return
  setSaving(true)
  try{
   const policy={...row.policy,allowlist:[...new Set([...(row.policy.allowlist||[]),...(row.status.imported_allowlist||[])])],block_ips:(row.policy.block_ips||[]).filter(v=>v!==ip)}
   await fetcher(FetcherMethod.PUT,"/api/v1/ssh-login",{server_ids:[row.id],policy})
   await mutate();toast.success("已移出黑名单，等待生效")
  }catch(e){toast.error(e instanceof Error?e.message:"移除失败")}
  finally{setSaving(false)}
 }
 if (!admin) return <p className="p-4">仅管理员可以管理 SSH 安全设置。</p>
 return <div className="min-w-0 px-3 pb-8">
  <div data-testid="ssh-page-toolbar" className="my-4 flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
   <Button variant="outline" size="sm" asChild><Link to="/dashboard" aria-label="返回服务器列表"><ArrowLeft className="h-4 w-4 sm:mr-1"/><span className="hidden sm:inline">服务器列表</span></Link></Button>
   <h1 className="flex items-center gap-2 text-lg font-semibold"><Shield className="h-5 w-5"/>SSH 安全</h1>
   <Button variant="outline" size="sm" className="ml-auto shrink-0" onClick={() => {void mutate().catch(()=>{});void refreshEvents();void refreshBans()}}><RefreshCw className="mr-1 h-4 w-4"/>刷新</Button>
  </div>
  {error && <p role="alert" className="mb-4 text-sm text-red-500">加载失败，请重试。</p>}
  <div className="grid min-w-0 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
   <aside className="min-w-0 rounded-lg border bg-card/80 p-3 shadow-sm">
    <Input aria-label="搜索服务器" placeholder="搜索服务器名称或 ID" value={search} onChange={e=>setSearch(e.target.value)}/>
    <div aria-label="SSH 服务器列表" className="mt-3 max-h-48 space-y-1 overflow-y-auto overscroll-contain lg:max-h-[70vh]">
     {isLoading ? <p className="p-2 text-sm">加载中…</p> : rows.map(s=><button key={s.id} disabled={saving} aria-pressed={selected===s.id} onClick={()=>choose(s.id)} className={"w-full rounded-md p-3 text-left transition-colors "+(selected===s.id?"bg-accent text-accent-foreground":"hover:bg-muted")}>
      <span className="block break-words text-sm font-medium">{s.name}</span>
      <span className="mt-1 block text-xs text-muted-foreground">#{s.id} · <span className={stateClass(s)}>{stateText(s)}</span></span>
     </button>)}
     {!isLoading && rows.length===0 && <p className="p-2 text-sm text-muted-foreground">没有符合条件的服务器</p>}
    </div>
   </aside>
   {!row || !draft ? <section className="rounded-lg border p-6 text-sm text-muted-foreground">选择一台服务器，查看设置和封禁列表。</section> :
   <main className="min-w-0 space-y-4">
    <h2 className="break-words font-semibold">{row.name}</h2>
    <Tabs value={activeTab} onValueChange={setActiveTab}>
    <TabsList className="grid w-full grid-cols-3 sm:w-auto sm:min-w-80">
     <TabsTrigger value="settings">设置</TabsTrigger>
     <TabsTrigger value="records">登录记录</TabsTrigger>
     <TabsTrigger value="bans">封禁列表</TabsTrigger>
    </TabsList>
    <TabsContent value="settings" className="space-y-4 pt-2">
    <section className="min-w-0 space-y-4 rounded-lg border bg-card/80 p-4 shadow-sm">
     <div className="flex flex-wrap items-start justify-between gap-2"><h2 className="font-semibold">监测设置</h2><span role="status" className={"text-sm "+stateClass(row)}>{stateText(row)}</span></div>
     <label className="flex items-center gap-2"><Checkbox aria-label="启用 SSH 监测" checked={draft.enabled} disabled={saving} onCheckedChange={v=>patch({enabled:!!v})}/>启用 SSH 监测</label>
     <label className="block space-y-2 text-sm"><span>SSH 监听端口</span><Input aria-label="SSH 监听端口" value={ports} disabled={saving} placeholder="例如 22, 2222" onChange={e=>{setDirty(true);setPorts(e.target.value)}}/></label>
     {(row.status.ports || []).length>0 && <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>已识别：</span>{row.status.ports.map(p=><Button key={p} type="button" variant="outline" size="sm" disabled={saving} onClick={()=>{setDirty(true);setPorts(v=>[...new Set([...v.split(/[,，\s]+/).filter(Boolean),String(p)])].join(", "))}}>{p}</Button>)}</div>}
     <p className="text-xs text-muted-foreground">多个端口用逗号分隔。</p>
    </section>
    <section className="min-w-0 space-y-4 rounded-lg border bg-card/80 p-4 shadow-sm">
     <h2 className="font-semibold">登录通知</h2>
     <div className="flex flex-wrap gap-5 text-sm">
      <label className="flex items-center gap-2"><Checkbox aria-label="登录成功通知" checked={draft.success} disabled={saving} onCheckedChange={v=>patch({success:!!v})}/>登录成功</label>
      <label className="flex items-center gap-2"><Checkbox aria-label="登录失败通知" checked={draft.failure} disabled={saving} onCheckedChange={v=>patch({failure:!!v})}/>登录失败</label>
     </div>
     <label className="block space-y-2 text-sm"><span>通知组</span><select aria-label="SSH 通知组" className="h-10 w-full min-w-0 rounded-md border bg-background px-3" value={draft.notification_group_id} disabled={saving} onChange={e=>patch({notification_group_id:Number(e.target.value)})}><option value={0}>请选择通知组</option>{notifierGroup?.map(n=><option key={n.group.id} value={n.group.id}>{n.group.name}</option>)}</select></label>
    </section>
    <section className="min-w-0 space-y-4 rounded-lg border bg-card/80 p-4 shadow-sm">
     <h2 className="font-semibold">自动封禁</h2>
     {row.status.existing?.active && <div className="space-y-2 rounded-md bg-muted p-3 text-sm">
      <p>{"已识别本机原有 SSH 防护"}</p>
      <p className="text-xs text-muted-foreground">当前：{row.status.existing.ports.join(", ")||"端口待确认"} · {row.status.existing.find_time} 秒内 {row.status.existing.max_retry} 次 · 封禁 {row.status.existing.ban_time===-1?"永久":row.status.existing.ban_time+" 秒"}</p>
      <Button size="sm" variant="outline" disabled={saving} onClick={()=>{
       const e=row.status.existing!;patch({auto_ban:true,max_retry:e.max_retry,find_time:e.find_time,ban_time:e.ban_time})
       if(e.ports.length)setPorts(e.ports.join(", "))
       setAllowlist(e.allowlist.join("\n"))
      }}>使用本机当前参数</Button>
     </div>}
     <label className="flex items-center gap-2 text-sm"><Checkbox aria-label="启用自动封禁" checked={draft.auto_ban} disabled={saving} onCheckedChange={v=>patch({auto_ban:!!v})}/>启用自动封禁</label>
     {draft.auto_ban && <>
      <div className="grid gap-3 sm:grid-cols-3">
       <label className="space-y-2 text-sm"><span>失败次数</span><Input aria-label="失败次数" type="number" min={1} max={1000} value={draft.max_retry} disabled={saving} onChange={e=>patch({max_retry:Number(e.target.value)})}/></label>
       <label className="space-y-2 text-sm"><span>检测周期（秒）</span><Input aria-label="统计时间" type="number" min={10} max={604800} value={draft.find_time} disabled={saving} onChange={e=>patch({find_time:Number(e.target.value)})}/></label>
       <label className="space-y-2 text-sm"><span>封禁时长（秒）</span><Input aria-label="封禁时长" type="number" min={-1} max={31536000} value={draft.ban_time} disabled={saving} onChange={e=>patch({ban_time:Number(e.target.value)})}/></label>
      </div>
      <p className="text-xs text-muted-foreground">-1 表示永久封禁，其他时长至少 60 秒。封禁仅作用于所选 SSH 端口。</p>

     </>}
     </section>
    <section className="min-w-0 space-y-4 rounded-lg border bg-card/80 p-4 shadow-sm">
     <h2 className="font-semibold">IP 黑名单</h2>
     <p className="text-xs text-muted-foreground">手动添加需要拦截的来源，仅作用于所选 SSH 端口。</p>
     <label className="block space-y-2 text-sm"><span>拉黑 IP／网段</span><textarea aria-label="拉黑 IP 网段" className="min-h-24 w-full rounded-md border bg-background p-3" value={blockIPs} disabled={saving} placeholder="每行一个 IPv4、IPv6 或 CIDR" onChange={e=>{setDirty(true);setBlockIPs(e.target.value)}}/></label>
     {row.policy.block_updated_at>0&&<p className="text-xs text-muted-foreground">更新时间：{when(row.policy.block_updated_at*1000)} · <span className={row.status.block_ready?"text-emerald-600 dark:text-emerald-400":""}>{row.status.block_ready?"已生效":"等待生效"}</span></p>}
    </section>
    <section className="min-w-0 space-y-4 rounded-lg border bg-card/80 p-4 shadow-sm">
     <h2 className="font-semibold">IP 白名单</h2>
     <label className="flex items-start gap-2 text-sm"><Checkbox aria-label="仅白名单模式" checked={!!draft.whitelist_only} disabled={saving} onCheckedChange={v=>patch({whitelist_only:!!v})}/><span>仅允许白名单访问所选 SSH 端口</span></label>
     <label className="block space-y-2 text-sm"><span>IP 白名单</span><textarea aria-label="IP 白名单" className="min-h-24 w-full rounded-md border bg-background p-3" value={allowlist} disabled={saving} placeholder="每行一个 IP 或 CIDR" onChange={e=>{setDirty(true);setAllowlist(e.target.value)}}/></label>
     <p className="text-xs text-muted-foreground">白名单优先放行。仅白名单模式会拒绝其他来源访问所选 SSH 端口，请先填入自己的管理 IP。</p>
     <Button onClick={save} disabled={saving || !!error || !dirty} className="w-full sm:w-auto">{saving?"保存中…":"保存这台服务器的设置"}</Button>
    </section>
    </TabsContent>
    <TabsContent value="bans" className="space-y-4 pt-2">
    <section className="min-w-0 space-y-3 rounded-lg border bg-card/80 p-4 shadow-sm">
     <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">自动封禁 <span className="text-sm font-normal text-muted-foreground">({bans?.total??row.status.ban_total??row.status.banned?.length??0})</span></h2>{bans?.observed_at&&<span className="text-xs text-muted-foreground">更新：{when(bans.observed_at)}</span>}</div>
     <div className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground"/><Input aria-label="搜索自动封禁 IP" className="pl-9" placeholder="搜索 IP 地址" value={banSearch} onChange={e=>setBanSearch(e.target.value)}/></div>
     {dirty&&<p className="text-xs text-amber-600">请先保存设置中的修改，再操作名单。</p>}
     <p role="status" className="min-h-5 text-sm text-muted-foreground">{bansLoading?(bansCurrent&&bans?"正在更新…":"正在读取第 "+banPage+" 页…"):""}</p>
     {bansError&&<p role="alert" className="text-sm text-red-500">{bansError instanceof Error?bansError.message:"读取失败，请重试"}</p>}
     {bans&&!bans.complete&&<p className="text-xs text-amber-600">升级 Agent 后可查看完整列表和封禁时间。</p>}
     {(!bansError?bans?.items||[]:[]).map(b=><article key={b.ip} data-testid="automatic-ban-row" className="flex min-w-0 flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1"><code className="block break-all text-sm">{b.ip}</code><div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>封禁：{b.banned_at?when(b.banned_at):"未记录"}</span><span>到期：{b.expires_at===-1?"永久":b.expires_at?when(b.expires_at):"未记录"}</span></div></div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2"><Button size="sm" variant="outline" disabled={!bansCurrent||saving||dirty||!!unbanning} onClick={()=>ipAction(b.ip,"whitelist")}>白名单</Button><Button size="sm" variant="outline" disabled={!bansCurrent||saving||!!unbanning||Date.now()/1000-row.status.updated_at>45} onClick={()=>unban(b.ip)}>{unbanning===b.ip?"提交中…":"解封"}</Button></div>
     </article>)}
     {!bansLoading&&!bansError&&bans&&!bans.items.length&&<p className="py-3 text-center text-sm text-muted-foreground">{debouncedBanSearch?"没有符合条件的封禁":"暂无封禁记录"}</p>}
     <SSHListPager label="自动封禁" total={bans?.total||0} page={banPage} pageSize={banSize} busy={saving} onPage={setBanPage} onSize={n=>{setBanSize(n);setBanPage(1)}}/>
    </section>
    <section className="min-w-0 space-y-3 rounded-lg border bg-card/80 p-4 shadow-sm">
     <h2 className="font-semibold">手动黑名单 <span className="text-sm font-normal text-muted-foreground">({manualFiltered.length})</span></h2>
     <Input aria-label="搜索手动黑名单" placeholder="搜索 IP 或网段" value={manualSearch} onChange={e=>{setManualSearch(e.target.value);setManualPage(1)}}/>
     {manualItems.map(ip=><article key={ip} className="flex min-w-0 flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0 space-y-1"><code className="block break-all text-sm">{ip}</code><span className="text-xs text-muted-foreground">添加：{row.policy.block_times?.[ip]?when(row.policy.block_times[ip]):"未记录"}</span></div><div className="flex shrink-0 justify-end gap-2">{!ip.includes("/")&&<Button size="sm" variant="outline" disabled={saving||dirty} onClick={()=>ipAction(ip,"whitelist")}>白名单</Button>}<Button size="sm" variant="outline" disabled={saving||dirty} onClick={()=>removeBlacklist(ip)}>移除</Button></div></article>)}
     {!manualItems.length&&<p className="py-3 text-center text-sm text-muted-foreground">{manualSearch?"没有符合条件的黑名单":"暂无手动黑名单"}</p>}
     <SSHListPager label="手动黑名单" total={manualFiltered.length} page={actualManualPage} pageSize={manualSize} busy={saving} onPage={setManualPage} onSize={n=>{setManualSize(n);setManualPage(1)}}/>
    </section>
    </TabsContent>
    <TabsContent value="records" className="pt-2">
    <section className="min-w-0 space-y-3 rounded-lg border bg-card/80 p-4 shadow-sm">
     <h2 className="font-semibold">本机登录记录</h2>
     <p className="text-xs text-muted-foreground">最近 24 小时 · 最新 50 条</p>
     {eventsLoading&&<p role="status" className="text-sm text-muted-foreground">{events?"正在更新…":"正在读取本机记录…"}</p>}
     {eventsError&&<p role="alert" className="text-sm text-red-500">{eventsError instanceof Error?eventsError.message:"读取失败，请重试"}</p>}
     {!!row.status.dropped&&<p className="text-xs text-amber-600">有 {row.status.dropped} 条提醒因离线过久或队列已满未能投递，可在本机日志中查看。</p>}
     {(!eventsError ? events || [] : []).map(e=><article key={e.id} className="rounded-md border p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong className={e.success?"text-emerald-600":"text-red-500"}>{e.success?"登录成功":"登录失败"}</strong><span className="text-xs text-muted-foreground">{when(e.time)}</span></div><p className="mt-2 break-all">账号：{e.username} · 来源：{e.source_ip}</p><div className="mt-2 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">SSH 端口：{e.port || "未能确认"} · {({password:"密码",publickey:"公钥","keyboard-interactive/pam":"交互认证"} as Record<string,string>)[e.method]||e.method} {e.reason}</p><div className="ml-auto flex shrink-0 gap-2"><Button size="sm" variant="outline" disabled={saving||dirty} onClick={()=>ipAction(e.source_ip,"blacklist")}>拉黑</Button><Button size="sm" variant="outline" disabled={saving||dirty} onClick={()=>ipAction(e.source_ip,"whitelist")}>白名单</Button></div></div></article>)}
     {!eventsLoading && !eventsError && !events?.length && <p className="text-sm text-muted-foreground">暂无记录</p>}
    </section>
    </TabsContent>
    </Tabs>
   </main>}
  </div>
 </div>
}
