import { useEffect, useRef, useState } from "react"
import { FetcherMethod, fetcher } from "@/api/api"
import { Button } from "@/components/ui/button"
import { ArrowUp, ArrowDown } from "lucide-react"
import { toast } from "sonner"

type State = { order: string[]; revision: string }
const names: Record<string, string> = { connectivity: "连通性", bgp: "BGP", "return-route": "回程", streaming: "流媒体" }
const endpoint = "/api/v1/setting/detection-priority"
export default function DetectionPrioritySettings() {
    const [saved, setSaved] = useState<State>()
    const [order, setOrder] = useState<string[]>([])
    const [busy, setBusy] = useState(false), [error, setError] = useState("")
    const sequence = useRef(0)
    const dirty = !!saved && JSON.stringify(saved.order) !== JSON.stringify(order)
    const adopt = (state: State) => {
        if (!Array.isArray(state?.order) || state.order.length !== 4 || new Set(state.order).size !== 4 || state.order.some(kind => !Object.prototype.hasOwnProperty.call(names, kind)) || typeof state.revision !== "string") throw new Error("优先级响应无效")
        setSaved(state); setOrder(state.order)
    }
    const load = async () => {
        const id = ++sequence.current
        setBusy(true); setError("")
        try { const state = await fetcher<State>(FetcherMethod.GET, endpoint); if (id === sequence.current) adopt(state) }
        catch (e) { if (id === sequence.current) setError("读取失败：" + String(e)) }
        finally { if (id === sequence.current) setBusy(false) }
    }
    useEffect(() => { void load(); return () => { sequence.current++ } }, [])
    useEffect(() => {
        if (!dirty) return
        const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = "" }
        window.addEventListener("beforeunload", warn)
        return () => window.removeEventListener("beforeunload", warn)
    }, [dirty])
    const move = (index: number, offset: number) => setOrder(current => {
        const next = [...current], target = index + offset
        if (target >= 0 && target < next.length) [next[index], next[target]] = [next[target], next[index]]
        return next
    })
    const save = async () => {
        if (!saved || busy || !dirty) return
        const id = ++sequence.current; setBusy(true); setError("")
        try {
            const state = await fetcher<State>(FetcherMethod.PUT, endpoint, { revision: saved.revision, order })
            if (id === sequence.current) { adopt(state); toast.success("任务优先级已保存，下一次调度生效") }
        } catch (e) { if (id === sequence.current) setError("保存失败：" + String(e)) }
        finally { if (id === sequence.current) setBusy(false) }
    }
    return <details className="rounded-xl border bg-card/50 p-4" data-detection-priority>
        <summary className="cursor-pointer text-sm font-semibold">自动检测优先级{dirty ? " · 未保存" : ""}</summary>
        <p className="mt-3 text-xs leading-6 text-muted-foreground">按编号由小到大优先执行。同一节点的到期自动任务依次进行，前一项结束后再启动下一项；不同节点保留有限并发。调整不会打断正在运行的任务，也不改变原检测周期。流媒体仍沿用连通性的自动周期。手动检测不受此排序限制。</p>
        {error && <p role="alert" className="my-3 text-sm text-destructive">{error}</p>}
        <ol className="my-3 grid gap-2 sm:grid-cols-2">
            {order.map((kind, index) => <li key={kind} className="flex min-w-0 items-center gap-2 rounded-lg border p-2">
                <span className="w-5 shrink-0 text-center text-xs text-muted-foreground">{index + 1}</span>
                <span className="min-w-0 flex-1 text-sm">{names[kind]}</span>
                <Button variant="ghost" size="icon" className="size-9 shrink-0" aria-label={names[kind] + "提高优先级"} disabled={busy || index === 0} onClick={() => move(index, -1)}><ArrowUp className="size-4" /></Button>
                <Button variant="ghost" size="icon" className="size-9 shrink-0" aria-label={names[kind] + "降低优先级"} disabled={busy || index === order.length - 1} onClick={() => move(index, 1)}><ArrowDown className="size-4" /></Button>
            </li>)}
        </ol>
        <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy} onClick={() => { if (!dirty || window.confirm("放弃未保存的优先级修改？")) void load() }}>重新加载优先级</Button>
            <Button disabled={!dirty || busy} onClick={() => void save()}>{busy ? "处理中…" : "保存优先级"}</Button>
        </div>
    </details>
}
