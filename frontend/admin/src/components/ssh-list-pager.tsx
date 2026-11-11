import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight } from "lucide-react"
export function SSHListPager({label,total,page,pageSize,busy,onPage,onSize}:{label:string;total:number;page:number;pageSize:number;busy?:boolean;onPage:(page:number)=>void;onSize:(size:number)=>void}){
 const last=Math.max(1,Math.ceil(total/pageSize))
 return <nav aria-label={label+"分页"} className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-xs text-muted-foreground">
  <div className="flex flex-wrap items-center gap-2"><span>共 {total} 条</span><select aria-label={label+"每页条数"} value={pageSize} disabled={busy} onChange={e=>onSize(Number(e.target.value))} className="h-8 rounded-md border bg-background px-2 text-foreground">{[10,20,50,100].map(n=><option key={n} value={n}>每页 {n} 条</option>)}</select></div>
  <div className="ml-auto flex items-center gap-2"><Button aria-label={label+"上一页"} variant="outline" size="sm" className="h-8 px-2" disabled={busy||page<=1} onClick={()=>onPage(page-1)}><ChevronLeft className="h-4 w-4"/></Button><span className="tabular-nums">{page} / {last}</span><Button aria-label={label+"下一页"} variant="outline" size="sm" className="h-8 px-2" disabled={busy||page>=last} onClick={()=>onPage(page+1)}><ChevronRight className="h-4 w-4"/></Button></div>
 </nav>
}
