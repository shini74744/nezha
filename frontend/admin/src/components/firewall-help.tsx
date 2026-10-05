import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { CircleHelp } from "lucide-react"
import { useEffect, useRef, useState } from "react"

export const firewallHelp = {
    unknown: {
        title: "认证防火墙说明",
        text: "记录已有/未登记 UUID 认证失败、UUID 缺失或格式不合法、已删除节点重连和疑似 UUID 冲突。新 UUID 携带有效密钥正常注册，不计入异常。冲突表示同一 UUID 的不同连接重叠上报，可能来自重复安装或短时重连，请核查；不会自动封禁正常节点。",
    },
    deleted: {
        title: "已删除服务器说明",
        text: "后台删除后立即保留在这里，不要求再次上报。UUID 默认持续拉黑，管理员可手动放行；如再次连接，也会出现在“认证防火墙”。原 ID 只作历史标识，可能被其他节点重新使用。",
    },
}

export function FirewallHelp({ tab }: { tab: keyof typeof firewallHelp }) {
    const [open, setOpen] = useState(false)
    const [pinned, setPinned] = useState(false)
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const clear = () => clearTimeout(timer.current)
    useEffect(() => clear, [])
    const closeLater = () => {
        clear()
        if (!pinned) timer.current = setTimeout(() => setOpen(false), 150)
    }
    const help = firewallHelp[tab]
    return (
        <Popover open={open} onOpenChange={value => {
            clear()
            setOpen(value)
            if (!value) setPinned(false)
        }}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    aria-label={help.title}
                    className="flex h-11 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onPointerEnter={event => {
                        if (event.pointerType !== "mouse") return
                        clear()
                        setOpen(true)
                    }}
                    onPointerLeave={event => { if (event.pointerType === "mouse") closeLater() }}
                    onClick={event => {
                        // A click pins hover help on desktop and toggles it on touch.
                        event.preventDefault()
                        clear()
                        setOpen(!pinned)
                        setPinned(!pinned)
                    }}
                >
                    <CircleHelp className="size-4" aria-hidden="true" />
                </button>
            </PopoverTrigger>
            <PopoverContent
                align="end"
                collisionPadding={12}
                aria-label={help.title}
                className="w-80 max-w-[calc(100vw-24px)] text-sm leading-6"
                onOpenAutoFocus={event => event.preventDefault()}
                onPointerEnter={clear}
                onPointerLeave={closeLater}
            >
                <p className="mb-1 font-medium">{help.title}</p>
                <p className="text-muted-foreground">{help.text}</p>
            </PopoverContent>
        </Popover>
    )
}
