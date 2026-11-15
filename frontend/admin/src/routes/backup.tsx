import { useEffect, useRef, useState } from "react"
import useSWR from "swr"
import { toast } from "sonner"
import { Clock, DatabaseBackup, Download, Loader2, Plus, RefreshCw, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useAuth } from "@/hooks/useAuth"
import { getServers } from "@/api/server"
import {
 BackupDelivery, BackupPlan, BackupRun, BackupTarget, BackupTargetInput,
 backupTargetStatus, backupCommand, backupHistory, backupOverview, cancelBackup, deleteBackupTarget, prepareBackupTarget, probeBackupTarget,
 saveBackupPlan, saveBackupTarget, setupBackupTarget, startBackup,
} from "@/api/backup"

const box = "min-w-0 rounded-xl border bg-card/70 p-4 sm:p-5"
const selectClass = "flex h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm"
const ageInstallCommands = [
 {system:"Debian 12+ / Ubuntu 22.04+",command:"apt update && apt install -y age"},
 {system:"Fedora 33+",command:"dnf install -y age"},
 {system:"Alpine Linux 3.15+",command:"apk add age"},
 {system:"macOS（已安装 Homebrew）",command:"brew install age"},
 {system:"Windows（PowerShell）",command:"winget install --id FiloSottile.age --exact"},
]
const labels: Record<string,string> = {
 running:"进行中",queued:"等待中",success:"已完成",partial:"部分完成",warning:"完成但有异常",failed:"失败",interrupted:"已中断",cancelled:"已取消",
 preparing:"准备备份",snapshot:"生成快照",waiting:"等待传输",connecting:"连接目标",transferring:"打包并传输",verifying:"校验备份",completed:"已完成",recording:"正在补写记录",
}
const time = (v?:string|null,zone="Asia/Shanghai") => v ? new Date(v).toLocaleString("zh-CN", {hour12:false,timeZone:zone}) : "—"
const bytes = (v:number=0) => {
 const units=["B","KiB","MiB","GiB","TiB"];let n=Math.max(0,v),i=0
 while(n>=1024&&i<units.length-1){n/=1024;i++}
 return `${n.toFixed(i===0?0:1)} ${units[i]}`
}
function State({state}:{state:string}) {
 const color=state==="success"?"text-emerald-600 dark:text-emerald-400":["failed","interrupted"].includes(state)?"text-red-600 dark:text-red-400":["partial","warning"].includes(state)?"text-amber-600 dark:text-amber-400":"text-muted-foreground"
 return <span className={`text-sm font-medium ${color}`}>{labels[state]||state}</span>
}
function Progress({delivery:d}:{delivery:BackupDelivery}) {
 const verifying=d.phase==="verifying"
 const denominator=verifying?d.sent_bytes:d.total_bytes
 const numerator=verifying?d.verified_bytes:d.processed_bytes
 const pct=d.state==="success"?100:denominator>0?Math.min(100,Math.max(0,numerator/denominator*100)):0
 return <div className="mt-3 space-y-1.5">
  <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
   <span>{labels[d.phase]||d.phase}{denominator>0 ? ` · ${pct.toFixed(1)}%` : ""}</span>
   <span>{verifying ? `已校验 ${bytes(d.verified_bytes)} / ${bytes(d.sent_bytes)}` : `已传输 ${bytes(d.sent_bytes)}${d.bytes_per_second>0 ? ` · ${bytes(d.bytes_per_second)}/s` : ""}`}</span>
  </div>
  <div role="progressbar" aria-label={`${d.name}备份进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} className="h-2 overflow-hidden rounded-full bg-muted">
   <div className={`h-full rounded-full transition-[width] duration-300 ${d.state==="success"?"bg-emerald-500":d.state==="failed"?"bg-red-500":"bg-primary"}`} style={{width:`${pct}%`}}/>
  </div>
  {d.state==="running"&&d.phase==="transferring"&&<p className="text-xs text-muted-foreground">按已处理数据计算进度，传输完成后还会校验文件。</p>}
 </div>
}
function RunCard({run,action,busy,zone}:{zone?:string;run:BackupRun;action:(kind:string,run:BackupRun,target?:number)=>void;busy:boolean}) {
 const [open,setOpen]=useState(run.state==="running")
 return <article className={box} data-backup-round={run.id}>
  <div className="flex flex-wrap items-center justify-between gap-3">
   <button type="button" className="flex min-w-0 flex-wrap items-center gap-2 text-left font-semibold" onClick={()=>setOpen(!open)} aria-expanded={open}>
    第 {run.id} 轮 <State state={run.state}/><span className="text-xs font-normal text-muted-foreground">{run.trigger==="scheduled"?"自动备份":run.retry_of?`重试第 ${run.retry_of} 轮`:"手动备份"}</span>
   </button>
   <div className="flex gap-2">
    {run.state==="running"?<Button variant="outline" size="sm" disabled={busy} onClick={()=>action("cancel",run)}>取消</Button>
     :run.deliveries.some(d=>d.state!=="success")&&<Button variant="outline" size="sm" disabled={busy} onClick={()=>action("retry",run)}>重试未完成目标</Button>}
    <Button variant="ghost" size="sm" onClick={()=>setOpen(!open)}>{open?"收起":"查看详情"}</Button>
   </div>
  </div>
  <div className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
   <span>开始：{time(run.started_at,zone)}</span><span>完成：{time(run.finished_at,zone)}</span>
   <span>{run.deliveries.filter(d=>d.state==="success").length} / {run.deliveries.length} 台已完成</span>
   <span>{run.encrypted?"已加密":"未加密"} · 数据量 {bytes(run.total_bytes)}</span>
  </div>
  {run.state==="running"&&!run.snapshot_at&&<p role="status" className="mt-3 flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin"/>{labels[run.phase]||run.phase}</p>}
  {run.error&&<p role="alert" className="mt-3 break-words text-sm text-red-600 dark:text-red-400">{run.error}</p>}
  {(open||run.state==="running")&&<div className="mt-4 space-y-3">{run.deliveries.map(d=><div key={d.id||d.target_id} className="min-w-0 rounded-lg border bg-background/40 p-3">
   <div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{d.name}</span><State state={d.state}/></div>
   <Progress delivery={d}/>
   <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground"><span>开始：{time(d.started_at,zone)}</span><span>完成：{time(d.finished_at,zone)}</span></div>
   {d.error&&<p role="alert" className="mt-2 break-words text-sm text-red-600 dark:text-red-400">{d.error}</p>}
   {d.archive&&<p className="mt-2 break-all text-xs text-muted-foreground">文件：{d.archive}</p>}
   {d.sha256&&d.state==="success"&&<details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">校验值 SHA-256</summary><code className="mt-1 block break-all">{d.sha256}</code></details>}
   {d.state!=="success"&&run.state!=="running"&&<Button className="mt-2" variant="outline" size="sm" disabled={busy} onClick={()=>action("retry",run,d.target_id)}>重试此目标</Button>}
  </div>)}</div>}
 </article>
}
const defaultTarget:BackupTargetInput={id:0,name:"",server_id:0,host:"",port:2022,user:"",directory:"/var/lib/ddnezha-backup/backups",fingerprint:"",auth_type:"password",transport:"sftp"}
function TargetDialog({initial,onClose,onSaved}:{initial:BackupTarget|null;onClose:()=>void;onSaved:()=>void}) {
 const [form,setForm]=useState<BackupTargetInput>(initial?{...initial}:{...defaultTarget})
 const [source,setSource]=useState(initial?.server_id?"server":initial?"manual":"server")
 const [account,setAccount]=useState(initial?.receiver?"dedicated":initial?"existing":"dedicated")
 const [prepared,setPrepared]=useState(!!initial?.receiver)
 const [command,setCommand]=useState("")
 const [busy,setBusy]=useState("")
 const [error,setError]=useState("")
 const [tested,setTested]=useState(initial?.fingerprint&&initial.fingerprint!=="SHA256:pending"?"saved":"")
 const {data:servers}=useSWR(source==="server"?"/api/v1/server":null,getServers)
 useEffect(()=>{if(initial?.receiver)void backupCommand(initial.id).then(result=>setCommand(result.command)).catch((e:Error)=>setError(e.message))},[initial])
 const alive=useRef(true)
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
 const update=(key:keyof BackupTargetInput,value:any)=>{setForm(f=>({...f,[key]:value,...(["host","port","user","auth_type"].includes(key)?{fingerprint:""}:{})}));setTested("")}
 const selectServer=(id:number)=>{
  const s=servers?.find(s=>s.id===id)
  const ip=s?.geoip?.ip
  setForm(f=>({...f,server_id:id,name:s?.name||"",host:ip?.ipv4_addr||ip?.ipv6_addr||"",fingerprint:""}));setTested("")
 }
 const perform=async(kind:string)=>{
  setBusy(kind);setError("")
  try{
   if(kind==="prepare"||kind==="auto"){
    let current=form
    if(!prepared){const result=await prepareBackupTarget(form);current=result.target;setForm(current);setCommand(result.command);setPrepared(true)}
    if(kind==="prepare"&&prepared){const result=await backupCommand(current.id);setCommand(result.command)}
    if(kind==="auto"){
     let status=await setupBackupTarget(current.id)
     while(status.setup_state==="installing"){
      await new Promise(resolve=>setTimeout(resolve,1500))
      if(!alive.current)return
      status=await backupTargetStatus(current.id)
     }
     if(status.setup_state!=="success")throw new Error(status.setup_error||"安装结果尚未确认，请测试连接")
     toast.success("备份机器对接完成");onSaved()
    }
   }else if(kind==="test"){
    const result=await probeBackupTarget(form)
    if(alive.current){setForm(f=>({...f,fingerprint:result.fingerprint}));setTested("tested")}
   }else if(kind==="save"){
    await saveBackupTarget(form);toast.success("备份目标已保存");onSaved()
   }
  }catch(e:any){if(alive.current)setError(e.message||"操作失败，请重试")}
  finally{if(alive.current)setBusy("")}
 }
 const locked=!!busy||prepared
 return <Dialog open onOpenChange={open=>{if(!open&&(!busy||busy==="auto"))onClose()}}>
  <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" onInteractOutside={e=>{if(busy&&busy!=="auto")e.preventDefault()}}>
   <DialogHeader><DialogTitle>{initial?"编辑备份目标":"添加备份目标"}</DialogTitle><DialogDescription>选择存放位置，并配置加密传输连接。</DialogDescription></DialogHeader>
   <div className="grid min-w-0 gap-4 sm:grid-cols-2">
    {!initial&&<div className="sm:col-span-2"><Label htmlFor="backup-source">目标来源</Label><select id="backup-source" className={selectClass} disabled={locked} value={source} onChange={e=>{setSource(e.target.value);setForm(f=>({...f,server_id:0}))}}><option value="server">从服务器列表选择</option><option value="manual">手动添加外部机器</option></select></div>}
    {source==="server"&&!initial&&<div className="sm:col-span-2"><Label htmlFor="backup-server">服务器</Label><select id="backup-server" className={selectClass} disabled={locked} value={form.server_id} onChange={e=>selectServer(Number(e.target.value))}><option value={0}>请选择备份服务器</option>{servers?.map(s=><option key={s.id} value={s.id}>{s.name} · #{s.id}</option>)}</select></div>}
    <div><Label htmlFor="backup-name">名称</Label><Input id="backup-name" disabled={locked} value={form.name} maxLength={120} onChange={e=>update("name",e.target.value)}/></div>
    <div><Label htmlFor="backup-host">服务器地址</Label><Input id="backup-host" disabled={locked} value={form.host} onChange={e=>update("host",e.target.value)} placeholder="IP 或域名"/></div>
    <div><Label htmlFor="backup-port">{account==="dedicated"||form.receiver?"备份端口":"SSH 端口"}</Label><Input id="backup-port" type="number" min={1} max={65535} disabled={locked} value={form.port} onChange={e=>update("port",Number(e.target.value))}/></div>
    <div><Label htmlFor="backup-directory">备份位置</Label><Input id="backup-directory" disabled={locked} value={form.directory} onChange={e=>update("directory",e.target.value)}/></div>
    {!initial&&<div className="sm:col-span-2"><Label htmlFor="backup-account-mode">连接方式</Label><select id="backup-account-mode" className={selectClass} disabled={locked} value={account} onChange={e=>{setAccount(e.target.value);setForm(f=>({...f,port:e.target.value==="existing"?22:2022}))}}><option value="dedicated">安装 DDnezha 备份接收端</option><option value="existing">使用已有 SSH／SFTP 账号</option></select></div>}
    {account==="existing"&&<>
     <div><Label htmlFor="backup-user">账号</Label><Input id="backup-user" autoComplete="off" disabled={!!busy} value={form.user} onChange={e=>update("user",e.target.value)}/></div>
     <div><Label htmlFor="backup-auth">登录方式</Label><select id="backup-auth" className={selectClass} disabled={!!busy} value={form.auth_type} onChange={e=>update("auth_type",e.target.value)}><option value="password">密码</option><option value="key">私钥</option></select></div>
     <div className="sm:col-span-2"><Label htmlFor="backup-secret">{form.auth_type==="key"?"登录私钥":"登录密码"}</Label>
      {form.auth_type==="key"?<textarea id="backup-secret" className={selectClass+" h-24 font-mono"} spellCheck={false} autoComplete="off" value={form.private_key||""} onChange={e=>update("private_key",e.target.value)} placeholder={form.has_secret?"已保存，留空保持原密钥":"粘贴专用私钥"}/>:<Input id="backup-secret" type="password" autoComplete="new-password" value={form.password||""} onChange={e=>update("password",e.target.value)} placeholder={form.has_secret?"已保存，留空保持原密码":""}/>}
     </div>
    </>}
   </div>
   {account==="dedicated"&&<p className="text-sm text-muted-foreground">{source==="server"?"通过现有 Agent 从 DDnezha 仓库安装备份接收端，无需升级 Agent。":"生成命令后，在目标机器上以 root 身份执行，再回到这里测试连接。"} 接收端使用独立端口，不需要开放业务 SSH。</p>}
   {command&&<div className="min-w-0 space-y-2"><Label>手动对接命令</Label><textarea className={selectClass+" h-36 resize-y font-mono text-xs"} aria-label="手动对接命令" readOnly value={command}/><Button variant="outline" size="sm" onClick={async()=>{try{await navigator.clipboard.writeText(command);toast.success("命令已复制")}catch{toast.error("无法复制，请手动选择命令")}}}>复制命令</Button></div>}
   {form.fingerprint&&form.fingerprint!=="SHA256:pending"&&<p className="break-all text-xs text-muted-foreground">服务器指纹：{form.fingerprint}</p>}
   {tested==="tested"&&<p className="text-sm text-emerald-600 dark:text-emerald-400" role="status">连接测试通过，可以保存。</p>}
   {busy==="auto"&&<p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin"/>正在安装备份接收端，可关闭窗口并稍后查看结果。</p>}
   {error&&<p role="alert" className="break-words text-sm text-red-600 dark:text-red-400">{error}</p>}
   <div className="flex flex-wrap justify-end gap-2">
    <Button variant="ghost" disabled={!!busy&&busy!=="auto"} onClick={onClose}>{busy==="auto"?"关闭，后台继续":"关闭"}</Button>
    {account==="dedicated"&&<Button disabled={!!busy} onClick={()=>perform(source==="server"?"auto":"prepare")}>{busy==="auto"||busy==="prepare"?<Loader2 className="mr-2 size-4 animate-spin"/>:null}{source==="server"?"自动对接":prepared?"重新显示命令":"生成对接命令"}</Button>}
    {(account==="existing"||prepared)&&<><Button variant="outline" disabled={!!busy} onClick={()=>perform("test")}>{busy==="test"?<Loader2 className="mr-2 size-4 animate-spin"/>:null}测试连接</Button><Button disabled={!!busy||!tested} onClick={()=>perform("save")}>保存目标</Button></>}
   </div>
  </DialogContent>
 </Dialog>
}
const initialPlan:BackupPlan={mode:"manual",interval_minutes:60,daily_time:"03:00",target_ids:[],next_at:null,encrypt:false}
export default function BackupPage(){
 const {profile}=useAuth();const admin=profile?.role===0
 const [page,setPage]=useState(1)
 const {data,error,mutate}=useSWR(admin?"/api/v1/backup":null,backupOverview,{refreshInterval:2000,revalidateOnFocus:true})
 const {data:history,error:historyError,mutate:refreshHistory}=useSWR(admin?["/api/v1/backup/history",page]:null,()=>backupHistory(page),{refreshInterval:data?.active?5000:15000})
 const [plan,setPlan]=useState<BackupPlan>(initialPlan)
 const [password,setPassword]=useState("");const [confirmPassword,setConfirmPassword]=useState("")
 const [dirty,setDirty]=useState(false);const initialized=useRef(false)
 const [dialog,setDialog]=useState<BackupTarget|null|undefined>(undefined)
 const [busy,setBusy]=useState(false);const [actionError,setActionError]=useState("")
 const previousActive=useRef<number|null>(null)
 useEffect(()=>{if(data&&!initialized.current){setPlan(data.plan);initialized.current=true}},[data])
 useEffect(()=>{if(previousActive.current&&!data?.active)void refreshHistory();previousActive.current=data?.active?.id||null},[data?.active,refreshHistory])
 const change=(key:keyof BackupPlan,value:any)=>{setPlan(p=>({...p,[key]:value}));setDirty(true)}
 const refresh=async()=>{await Promise.all([mutate(),refreshHistory()])}
 const act=async(work:()=>Promise<unknown>,message?:string)=>{
  if(busy)return;setBusy(true);setActionError("")
  try{await work();if(message)toast.success(message);await refresh()}catch(e:any){setActionError(e.message||"操作失败，请重试");toast.error(e.message||"操作失败，请重试")}finally{setBusy(false)}
 }
 const persist=async()=>{
  if(plan.encrypt&&password!==confirmPassword)throw new Error("两次输入的备份密码不一致")
  await saveBackupPlan(plan,password);setPassword("");setConfirmPassword("");setDirty(false)
  const next=await mutate();if(next)setPlan(next.plan)
 }
 const runAction=(kind:string,run:BackupRun,target?:number)=>{
  if(kind==="cancel"){if(!window.confirm("取消本轮备份？已经完成的目标文件会保留。"))return;void act(()=>cancelBackup(run.id),"已请求取消")}
  else void act(()=>startBackup(target?[target]:undefined,run.id),"已创建新的重试轮次")
 }
 if(!admin)return <div className={box}>仅管理员可以管理数据备份。</div>
 return <div className="min-w-0 space-y-5" data-testid="backup-page">
  <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-xl font-semibold"><DatabaseBackup className="size-5"/>数据备份</h2><p className="mt-1 text-sm text-muted-foreground">备份面板配置、数据库、历史监控数据和上传文件。</p></div><Button variant="outline" disabled={busy} onClick={()=>void refresh()}><RefreshCw className="mr-2 size-4"/>刷新</Button></div>
  {(error||historyError)&&<div role="alert" className={box+" text-red-600 dark:text-red-400"}>{(error||historyError)?.message||"读取备份信息失败"}<Button className="ml-2" variant="outline" size="sm" onClick={()=>void refresh()}>重试</Button></div>}
  {!data&&!error&&<p role="status" className="flex items-center gap-2"><Loader2 className="size-4 animate-spin"/>正在读取备份设置…</p>}
  {data&&<>
   <div className="grid gap-3 sm:grid-cols-3">
    <div className={box}><div className="flex items-center gap-2 text-sm text-muted-foreground"><Clock className="size-4"/>{data.plan.mode==="realtime"?"下次备份检查":"下次备份时间"}</div><p className="mt-2 break-words font-semibold">{data.active?"当前备份完成后安排下一轮":data.plan.mode==="manual"?"手动备份":time(data.plan.next_at,data.time_zone)}</p></div>
    <div className={box}><div className="text-sm text-muted-foreground">最近一轮</div><div className="mt-2 flex flex-wrap items-center gap-2">{history?.items[0]?<>第 {history.items[0].id} 轮 <State state={history.items[0].state}/></>:"尚无备份记录"}</div></div>
    <div className={box}><div className="text-sm text-muted-foreground">备份目标</div><p className="mt-2 font-semibold">{data.plan.target_ids.length} 台已选择 / {data.targets.length} 台已添加</p></div>
   </div>
   {data.active&&<RunCard zone={data.time_zone} run={data.active} busy={busy} action={runAction}/>}
   <section className={box}>
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">备份服务器</h3><Button variant="outline" size="sm" onClick={()=>setDialog(null)}><Plus className="mr-1 size-4"/>添加目标</Button></div>
    <p className="mt-2 text-sm text-muted-foreground">可勾选多台机器。每台独立传输和校验，备份文件保留在对应目录中。</p>
    <div className="mt-4 grid gap-3 lg:grid-cols-2">
     {!data.targets.length&&<p className="py-4 text-sm text-muted-foreground">添加备份机器后，即可安排备份。</p>}
     {data.targets.map(target=><div key={target.id} className="min-w-0 rounded-lg border bg-background/40 p-3">
      <div className="flex items-start gap-3"><input type="checkbox" className="mt-1 size-4 shrink-0 accent-primary" aria-label={`选择备份目标 ${target.name}`} checked={plan.target_ids.includes(target.id)} onChange={e=>change("target_ids",e.target.checked?[...plan.target_ids,target.id]:plan.target_ids.filter(id=>id!==target.id))}/>
       <div className="min-w-0 flex-1"><div className="break-words font-medium">{target.name}</div><p className="mt-1 break-all text-xs text-muted-foreground">{target.host}:{target.port} · {target.user}</p><p className="mt-1 break-all text-xs text-muted-foreground">{target.directory}</p>{target.setup_state==="installing"&&<p className="mt-1 text-sm text-primary" role="status">正在安装接收端…</p>}{target.setup_error&&<p className="mt-1 break-words text-sm text-red-600 dark:text-red-400">{target.setup_error}</p>}{target.fingerprint==="SHA256:pending"&&target.setup_state!=="installing"&&<p className="mt-1 text-xs text-amber-600">尚未完成对接</p>}</div>
      </div>
      <div className="mt-2 flex justify-end gap-1"><Button variant="ghost" size="sm" disabled={!!data.active||busy||target.setup_state==="installing"} onClick={()=>setDialog(target)}>编辑</Button><Button variant="ghost" size="sm" disabled={!!data.active||busy||target.setup_state==="installing"} onClick={()=>{if(window.confirm(`删除“${target.name}”连接？服务器上的备份文件和账号会保留。`))void act(async()=>{await deleteBackupTarget(target.id);setPlan(p=>({...p,target_ids:p.target_ids.filter(id=>id!==target.id)}))},"目标已删除")}}>删除</Button></div>
     </div>)}
    </div>
   </section>
   <section className={box}>
    <h3 className="font-semibold">备份设置</h3>
    <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
     <div><Label htmlFor="backup-mode">备份方式</Label><select id="backup-mode" className={selectClass} value={plan.mode} onChange={e=>change("mode",e.target.value)}><option value="manual">手动备份</option><option value="interval">定时备份 · 按间隔</option><option value="daily">定时备份 · 每天</option><option value="realtime">实时备份 · 数据变化后</option></select></div>
     {(plan.mode==="interval"||plan.mode==="realtime")&&<div><Label htmlFor="backup-interval">{plan.mode==="realtime"?"最短备份间隔（分钟）":"备份间隔（分钟）"}</Label><Input id="backup-interval" type="number" min={1} max={43200} value={plan.interval_minutes} onChange={e=>change("interval_minutes",Number(e.target.value))}/></div>}
     {plan.mode==="daily"&&<div><Label htmlFor="backup-daily">每天备份时间（面板时区）</Label><Input id="backup-daily" type="time" value={plan.daily_time} onChange={e=>change("daily_time",e.target.value)}/></div>}
     <div className="col-span-full grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
      <div className="flex h-10 items-center gap-2 sm:col-span-2 lg:col-span-1"><input type="checkbox" id="backup-encrypt" className="size-4 shrink-0 accent-primary" checked={plan.encrypt} onChange={e=>change("encrypt",e.target.checked)}/><Label htmlFor="backup-encrypt" className="flex items-center gap-1.5 whitespace-nowrap"><ShieldCheck className="size-4 shrink-0"/>加密备份包</Label></div>
      {plan.encrypt&&<><div className="min-w-0"><Label htmlFor="backup-encryption-password">备份密码</Label><Input id="backup-encryption-password" type="password" autoComplete="new-password" value={password} onChange={e=>{setPassword(e.target.value);setDirty(true)}} placeholder={plan.has_password?"已保存，留空保持原密码":"至少 12 个字符"}/></div><div className="min-w-0"><Label htmlFor="backup-encryption-confirm">确认备份密码</Label><Input id="backup-encryption-confirm" type="password" autoComplete="new-password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)}/></div></>}
     </div>
    </div>
    {plan.mode==="realtime"&&<p className="mt-3 text-sm text-muted-foreground">有数据变化时自动备份，按最短间隔合并变化；上一轮完成后才会开始下一轮。</p>}
    {plan.encrypt&&<p className="mt-3 text-sm text-muted-foreground">恢复时需要对应的备份密码，请另行妥善保存。更换密码只影响之后的备份。</p>}
    {!plan.encrypt&&<p className="mt-3 text-sm text-muted-foreground">普通备份包包含面板密钥和配置，请仅保存在可信机器上。传输过程仍通过 SFTP 加密。</p>}
    {actionError&&<p role="alert" className="mt-3 break-words text-sm text-red-600 dark:text-red-400">{actionError}</p>}
    <div className="mt-4 flex flex-wrap items-center gap-2"><Button disabled={busy} onClick={()=>void act(persist,"备份设置已保存")}>{busy&&<Loader2 className="mr-2 size-4 animate-spin"/>}保存设置</Button><Button variant="outline" disabled={busy||!!data.active||!plan.target_ids.length} onClick={()=>void act(async()=>{if(dirty)await persist();await startBackup(plan.target_ids)},"备份已开始")}><Download className="mr-2 size-4"/>立即备份</Button>{dirty&&<span className="text-xs text-muted-foreground">有未保存的修改</span>}</div>
   </section>
  </>}
  <section className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">备份记录</h3><span className="text-xs text-muted-foreground">时区：{data?.time_zone||"Asia/Shanghai"}</span></div>
   {!history?.items.length&&!historyError&&<div className={box+" text-sm text-muted-foreground"}>尚无备份记录。</div>}
   {history?.items.filter(run=>run.id!==data?.active?.id).map(run=><RunCard zone={data?.time_zone} key={run.id} run={run} busy={busy||!!data?.active} action={runAction}/>)}
   {history&&history.total>0&&<div className="flex flex-wrap items-center justify-between gap-3 text-sm"><span className="text-muted-foreground">共 {history.total} 轮，每页 10 轮</span><div className="flex items-center gap-3"><Button size="sm" variant="outline" disabled={page<=1} onClick={()=>setPage(page-1)}>上一页</Button><span>{page} / {Math.max(1,Math.ceil(history.total/10))}</span><Button size="sm" variant="outline" disabled={page*10>=history.total} onClick={()=>setPage(page+1)}>下一页</Button></div></div>}
  </section>
  <details className={box+" group/backup-help"}><summary className="cursor-pointer rounded-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">单独对接与恢复说明<span className="ml-2 text-xs font-normal text-muted-foreground group-open/backup-help:hidden">点击展开</span><span className="ml-2 hidden text-xs font-normal text-muted-foreground group-open/backup-help:inline">点击收起</span></summary><div className="mt-3 space-y-2 text-sm">
   <details name="backup-help-sections" className="min-w-0 rounded-lg border bg-background/30"><summary className="cursor-pointer rounded-lg px-3 py-3 font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">备份机器对接</summary><div className="space-y-3 px-3 pb-3 text-muted-foreground">
   <p>外部备份机器：点击“添加目标”，选择“手动添加外部机器”，填写地址和备份位置。可以使用已有 SSH／SFTP 账号，也可以生成 DDnezha 备份接收端的专属安装命令，在目标机器执行后测试并保存。</p>
   <p>从服务器列表选择：填写备份端口和存放位置，点击“自动对接”。Agent 从 DDnezha 仓库安装接收端，之后由面板通过 SFTP 传输。目标需允许 Agent 执行命令，并允许面板连接指定备份端口；无需开放业务 SSH。</p>
   </div></details>
   <details name="backup-help-sections" className="min-w-0 rounded-lg border bg-background/30"><summary className="cursor-pointer rounded-lg px-3 py-3 font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">安装 age</summary><div className="space-y-3 px-3 pb-3 text-muted-foreground">
   <p>在准备解密备份的机器上，选择对应系统的命令执行一次。Linux 命令以 root 身份执行；已安装 age 可跳过。</p>
   <div className="grid min-w-0 gap-3 lg:grid-cols-2">
    {ageInstallCommands.map(item=><div key={item.system} className="min-w-0 space-y-1"><p>{item.system}</p><code className="block min-w-0 whitespace-pre-wrap break-words rounded border bg-background/60 p-3 text-foreground">{item.command}</code></div>)}
   </div>
   <p>其他系统或提示找不到软件包时，可查看 <a href="https://github.com/FiloSottile/age#installation" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">age 官方安装说明</a>。</p>
   </div></details>
   <details name="backup-help-sections" className="min-w-0 rounded-lg border bg-background/30"><summary className="cursor-pointer rounded-lg px-3 py-3 font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">解密与恢复</summary><div className="space-y-3 px-3 pb-3 text-muted-foreground">
   <p>每个备份包旁都有 .sha256 校验文件。恢复前先核对校验值，再解压到独立目录；包内 data 包含数据库、配置、密钥、上传文件和历史监控数据，manifest.json 列出各文件校验值。</p>
   <p>加密备份以 .tar.gz.age 结尾，需要恢复时先解密；未加密的 .tar.gz 文件可直接解压。</p>
   <p>在备份文件所在目录执行。下面的文件名只是示例：将“实际备份文件名.tar.gz.age”替换为你的备份文件名，也可以填写完整路径；-o 后的“解密后的备份.tar.gz”是输出文件名，可自行指定，请使用尚不存在的文件名。</p>
   <code className="block min-w-0 whitespace-pre-wrap break-words rounded border bg-background/60 p-3 text-foreground">age --decrypt -o "解密后的备份.tar.gz" "实际备份文件名.tar.gz.age"</code>
   <p>按提示输入生成这份备份时设置的密码。解密成功后，再解压输出的 .tar.gz 文件。</p>
   <p>正式恢复前停止面板并保留当前数据副本，再按原部署方式替换数据目录。使用自定义配置、数据库或历史数据路径时，将对应文件放回原位置。</p>   </div></details>
  </div></details>
  {dialog!==undefined&&<TargetDialog initial={dialog} onClose={()=>{setDialog(undefined);void mutate()}} onSaved={()=>{setDialog(undefined);void mutate()}}/>}
 </div>
}
