import { useEffect, useRef } from "react"
import { InstallState } from "@/api/terminal-sessions"

export function TerminalInstallLog({ state, onClose }: { state: InstallState; onClose: () => void }) {
    const output = useRef<HTMLPreElement>(null)
    const following = useRef(true)
    useEffect(() => {
        if (following.current && output.current) output.current.scrollTop = output.current.scrollHeight
    }, [state.log, state.message])
    return <section className="terminal-install-console" aria-label="tmux 安装日志" onKeyDown={e => e.stopPropagation()}>
        <header><strong>安装 tmux <span>{state.state === "running" ? "进行中" : state.state === "done" ? "已完成" : "未完成"}</span></strong>
            <button type="button" onClick={onClose}>返回终端</button></header>
        <pre ref={output} tabIndex={0} aria-label="实时安装输出" onScroll={() => {
            const el = output.current
            if (el) following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}>{state.log || (state.state === "running" ? "正在等待节点输出…\n" : "")}</pre>
        <footer role="status" data-state={state.state}>{state.message}</footer>
    </section>
}
