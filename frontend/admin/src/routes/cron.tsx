import { swrFetcher } from "@/api/api"
import { deleteCron, runCron } from "@/api/cron"
import { CronCard } from "@/components/cron"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useNotification } from "@/hooks/useNotfication"
import { useServer } from "@/hooks/useServer"
import { coverageSummary, cronLastResult, scheduleSummary } from "@/lib/cron-editor"
import type { ModelCron } from "@/types"
import { CalendarClock, Play, Search, Trash2, Zap } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import useSWR from "swr"

export default function CronPage() {
    const { data, mutate, error, isLoading } = useSWR<ModelCron[]>("/api/v1/cron", swrFetcher)
    const { servers } = useServer()
    const { notifierGroup } = useNotification()
    const [query, setQuery] = useState("")
    const [filter, setFilter] = useState("all")
    const [selected, setSelected] = useState<number[]>([])
    const [confirm, setConfirm] = useState<{ type: "run" | "delete"; rows: ModelCron[] }>()
    const [busy, setBusy] = useState(false)
    const pending = useRef(false)
    const [actionError, setActionError] = useState("")
    const rows = data ?? []
    const visible = rows.filter(
        (row) =>
            (filter === "all" || String(row.task_type) === filter) &&
            (row.name + " #" + row.id).toLowerCase().includes(query.toLowerCase()),
    )
    useEffect(() => {
        if (data) setSelected((old) => old.filter((id) => data.some((row) => row.id === id)))
    }, [data])
    const ask = (type: "run" | "delete", rows: ModelCron[]) => {
        setActionError("")
        setConfirm({ type, rows })
    }
    const serverNames = (task: ModelCron) =>
        (task.servers ?? [])
            .map((id) => (servers?.find((s) => s.id === id)?.name ?? "服务器") + " #" + id)
            .join("、")
    async function act() {
        if (!confirm || pending.current) return
        pending.current = true
        setBusy(true)
        setActionError("")
        try {
            if (confirm.type === "run") await runCron(confirm.rows[0].id)
            else await deleteCron(confirm.rows.map((row) => row.id))
            toast.success(confirm.type === "run" ? "已发送执行请求，请稍后查看结果" : "任务已删除")
            setConfirm(undefined)
            void mutate().catch(() => toast.error("操作成功，但列表刷新失败，请刷新页面。"))
        } catch (e) {
            setActionError(e instanceof Error ? e.message : "操作失败，请重试。")
        } finally {
            pending.current = false
            setBusy(false)
        }
    }
    return (
        <main className="cron-page">
            <div className="cron-page-heading">
                <div>
                    <h1>任务</h1>
                    <p>可视化安排执行时间，统一管理服务器自动化任务。</p>
                </div>
                <CronCard mutate={mutate} />
            </div>
            <div className="cron-toolbar">
                <label className="cron-search">
                    <Search size={16} aria-hidden />
                    <Input
                        aria-label="搜索任务"
                        placeholder="搜索任务名称或 ID"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                    />
                </label>
                <select
                    aria-label="筛选任务类型"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                >
                    <option value="all">全部类型 · {rows.length}</option>
                    <option value="0">
                        定时执行 · {rows.filter((row) => row.task_type === 0).length}
                    </option>
                    <option value="1">
                        事件触发 · {rows.filter((row) => row.task_type === 1).length}
                    </option>
                </select>
                <Button variant="outline" onClick={() => void mutate()} disabled={isLoading}>
                    刷新
                </Button>
            </div>
            {error ? (
                <div className="cron-empty" role="alert">
                    <h2>任务加载失败</h2>
                    <p>请检查连接后重试，已有任务不会被修改。</p>
                    <Button onClick={() => void mutate()}>重新加载</Button>
                </div>
            ) : isLoading ? (
                <div className="cron-empty" role="status">
                    正在加载任务…
                </div>
            ) : !rows.length ? (
                <div className="cron-empty">
                    <CalendarClock size={34} aria-hidden />
                    <h2>还没有任务</h2>
                    <p>
                        点击右上角“新建任务”，选择时间、命令和执行服务器。
                        <br />
                        常用周期无需手写 Cron。
                    </p>
                </div>
            ) : (
                <>
                    <div className="cron-selection-bar">
                        <label className="cron-check">
                            <input
                                type="checkbox"
                                aria-label="选择当前筛选的任务"
                                checked={
                                    visible.length > 0 &&
                                    visible.every((row) => selected.includes(row.id))
                                }
                                disabled={!visible.length}
                                onChange={(e) =>
                                    setSelected(
                                        e.target.checked
                                            ? [
                                                  ...new Set([
                                                      ...selected,
                                                      ...visible.map((row) => row.id),
                                                  ]),
                                              ]
                                            : selected.filter(
                                                  (id) => !visible.some((row) => row.id === id),
                                              ),
                                    )
                                }
                            />
                            选择当前筛选
                        </label>
                        <span>已选 {selected.length} 项</span>
                        {selected.length > 0 && (
                            <>
                                <button type="button" onClick={() => setSelected([])}>
                                    清空选择
                                </button>
                                <Button
                                    variant="destructive"
                                    onClick={() =>
                                        ask(
                                            "delete",
                                            rows.filter((row) => selected.includes(row.id)),
                                        )
                                    }
                                >
                                    <Trash2 size={14} aria-hidden />
                                    删除所选
                                </Button>
                            </>
                        )}
                    </div>
                    {!visible.length && (
                        <div className="cron-empty">没有匹配的任务，试试其他名称或类型。</div>
                    )}
                    <div className="cron-grid">
                        {visible.map((task) => (
                            <article key={task.id} className="cron-task-card bg-card">
                                <div className="cron-task-heading">
                                    <input
                                        type="checkbox"
                                        aria-label={"选择任务 " + task.name}
                                        checked={selected.includes(task.id)}
                                        onChange={(e) =>
                                            setSelected(
                                                e.target.checked
                                                    ? [...selected, task.id]
                                                    : selected.filter((id) => id !== task.id),
                                            )
                                        }
                                    />
                                    <div>
                                        <h2>{task.name}</h2>
                                        <small>
                                            #{task.id} ·{" "}
                                            {task.task_type === 0
                                                ? "定时执行"
                                                : task.task_type === 1
                                                  ? "事件触发"
                                                  : "未知类型"}
                                        </small>
                                    </div>
                                    <span
                                        className={
                                            "cron-status " +
                                            (cronLastResult(task) === "最近失败" ? "is-failed" : "")
                                        }
                                    >
                                        {cronLastResult(task)}
                                    </span>
                                </div>
                                <p className="cron-task-schedule">
                                    {task.task_type === 0 ? (
                                        <CalendarClock size={17} aria-hidden />
                                    ) : (
                                        <Zap size={17} aria-hidden />
                                    )}
                                    {task.task_type === 0
                                        ? scheduleSummary(task.scheduler)
                                        : "由告警等事件调用"}
                                </p>
                                {task.task_type === 0 && (
                                    <code className="cron-expression">{task.scheduler}</code>
                                )}
                                <pre className="cron-task-command" title={task.command}>
                                    {task.command || "未设置命令"}
                                </pre>
                                <dl>
                                    <div>
                                        <dt>执行范围</dt>
                                        <dd>
                                            {coverageSummary(task.cover, task.servers?.length ?? 0)}
                                        </dd>
                                    </div>
                                    {task.cover !== 2 && !!task.servers?.length && (
                                        <div>
                                            <dt>{task.cover === 1 ? "排除" : "服务器"}</dt>
                                            <dd className="cron-clamp" title={serverNames(task)}>
                                                {serverNames(task)}
                                            </dd>
                                        </div>
                                    )}
                                    <div>
                                        <dt>通知</dt>
                                        <dd>
                                            {task.notification_group_id
                                                ? (notifierGroup?.find(
                                                      (g) =>
                                                          g.group.id === task.notification_group_id,
                                                  )?.group.name ??
                                                      "通知组 #" + task.notification_group_id) +
                                                  (task.push_successful
                                                      ? " · 成功及失败"
                                                      : " · 仅失败")
                                                : "不发送通知"}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt>最近执行</dt>
                                        <dd>
                                            {cronLastResult(task) === "尚未执行"
                                                ? "—"
                                                : task.last_executed_at.replace("T", " ")}
                                        </dd>
                                    </div>
                                </dl>
                                <div className="cron-task-actions">
                                    <Button
                                        variant="outline"
                                        disabled={task.cover === 2}
                                        title={
                                            task.cover === 2 ? "仅由关联事件触发" : "确认后执行一次"
                                        }
                                        onClick={() => ask("run", [task])}
                                    >
                                        <Play size={14} aria-hidden />
                                        执行一次
                                    </Button>
                                    <CronCard data={task} mutate={mutate} />
                                    <Button
                                        variant="ghost"
                                        aria-label={"删除任务 " + task.name}
                                        onClick={() => ask("delete", [task])}
                                    >
                                        <Trash2 size={15} aria-hidden />
                                    </Button>
                                </div>
                            </article>
                        ))}
                    </div>
                </>
            )}
            <Dialog
                open={!!confirm}
                onOpenChange={(open) => {
                    if (!open && !busy) setConfirm(undefined)
                }}
            >
                <DialogContent
                    className="cron-confirm"
                    onEscapeKeyDown={(e) => {
                        if (busy) e.preventDefault()
                    }}
                    onPointerDownOutside={(e) => {
                        if (busy) e.preventDefault()
                    }}
                >
                    <DialogHeader>
                        <DialogTitle>
                            {confirm?.type === "run" ? "确认执行任务？" : "确认删除任务？"}
                        </DialogTitle>
                        <DialogDescription>
                            {confirm?.type === "run"
                                ? "会立即向以下范围发送命令。这不是预览，请确认影响。"
                                : "删除后停止后续调度，无法撤销；已开始的命令不会因此停止。"}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="cron-confirm-body">
                        {confirm?.rows.map((task) => (
                            <div key={task.id}>
                                <strong>
                                    {task.name} · #{task.id}
                                </strong>
                                <p>{coverageSummary(task.cover, task.servers?.length ?? 0)}</p>
                                {task.cover !== 2 && !!task.servers?.length && (
                                    <p>{serverNames(task)}</p>
                                )}
                                {confirm.type === "run" && <pre>{task.command}</pre>}
                            </div>
                        ))}
                    </div>
                    {actionError && (
                        <p role="alert" className="cron-error">
                            {actionError}
                        </p>
                    )}
                    <div className="cron-confirm-actions">
                        <Button
                            variant="outline"
                            disabled={busy}
                            onClick={() => setConfirm(undefined)}
                        >
                            取消
                        </Button>
                        <Button
                            variant={confirm?.type === "delete" ? "destructive" : "default"}
                            disabled={busy}
                            onClick={() => void act()}
                        >
                            {busy
                                ? "处理中…"
                                : confirm?.type === "run"
                                  ? "确认执行一次"
                                  : "确认删除"}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </main>
    )
}
