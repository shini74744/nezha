import { acknowledgeNICChange, getNICChangeReminders } from "@/api/server"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react"
import type { ReactNode } from "react"
import useSWR from "swr"

type Notices = Record<string, string>
const NoticeContext = createContext<{
    notices: Notices
    markRead: (sid: number, eventID: string) => Promise<void>
}>({ notices: {}, markRead: async () => {} })

export const useNICChangeReminder = () => useContext(NoticeContext)

// Keep polling outside the table so refreshes do not remount open dialogs.
export function NICReminderProvider({ children }: { children: ReactNode }) {
    const { data, mutate } = useSWR("/api/v1/server/nic-change-reminders", getNICChangeReminders, {
        refreshInterval: 10000,
    })
    const markRead = useCallback(
        async (sid: number, eventID: string) => {
            await acknowledgeNICChange(sid, eventID)
            await mutate(
                (current) => {
                    if (current?.[sid] !== eventID) return current
                    const next = { ...current }
                    delete next[sid]
                    return next
                },
                { revalidate: true },
            )
        },
        [mutate],
    )
    const value = useMemo(() => ({ notices: data ?? {}, markRead }), [data, markRead])
    return <NoticeContext.Provider value={value}>{children}</NoticeContext.Provider>
}

export function NICChangeReminder({ sid, eventID }: { sid: number; eventID: string }) {
    const { markRead } = useNICChangeReminder()
    const element = useRef<HTMLParagraphElement>(null)
    useEffect(() => {
        const node = element.current
        if (!node) return
        let active = true
        let visible = false
        let busy = false
        let done = false
        let retry: ReturnType<typeof setTimeout> | undefined
        const acknowledge = async () => {
            if (!active || !visible || busy || done) return
            busy = true
            try {
                await markRead(sid, eventID)
                done = true
            } catch {
                if (active && visible) retry = setTimeout(acknowledge, 5000)
            } finally {
                busy = false
            }
        }
        const observer = new IntersectionObserver(
            (entries) => {
                visible = entries.some(
                    (entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5,
                )
                if (visible) void acknowledge()
                else if (retry) clearTimeout(retry)
            },
            { threshold: 0.5 },
        )
        observer.observe(node)
        return () => {
            active = false
            observer.disconnect()
            if (retry) clearTimeout(retry)
        }
    }, [sid, eventID, markRead])
    return (
        <p
            ref={element}
            role="status"
            className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm leading-relaxed text-foreground"
        >
            原来选择的网口已变化，已恢复默认统计。
        </p>
    )
}
