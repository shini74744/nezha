import { useCallback, useEffect, useRef, useState } from "react"
import { fetcher, FetcherMethod } from "@/api/api"

type Snapshot<T> = { scope: string; key: string; dataKey?: string; data?: T; error?: Error; pending: boolean }
type Cached<T> = { data: T; at: number }

// Node-local reads can be slow. Cancel superseded queries; a late reply must
// never replace the last selection. A small, short-lived browser cache keeps
// revisited pages readable while their current contents are revalidated.
export function useSSHRead<T>(key: string | null, scope: string) {
 const [snapshot, setSnapshot] = useState<Snapshot<T>>({ scope: "", key: "", pending: false })
 const cache = useRef(new Map<string, Cached<T>>())
 const owner = useRef(scope)
 const refreshRef = useRef<() => Promise<void>>(async () => {})
 const refresh = useCallback(() => refreshRef.current(), [])

 useEffect(() => {
  if (owner.current !== scope) {
   cache.current.clear()
   owner.current = scope
  }
  if (!key) {
   refreshRef.current = async () => {}
   return
  }
  let disposed = false
  let sequence = 0
  let controller: AbortController | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const cached = cache.current.get(key)
  const usable = cached && Date.now() - cached.at < 30000 ? cached : undefined
  setSnapshot(old => ({
   scope, key, pending: true,
   data: usable?.data ?? (old.scope === scope ? old.data : undefined),
   dataKey: usable ? key : old.scope === scope ? old.dataKey : undefined,
  }))
  const read = async () => {
   if (disposed) return
   clearTimeout(timer)
   controller?.abort()
   controller = new AbortController()
   const current = ++sequence
   setSnapshot(old => ({ ...old, pending: true, error: undefined }))
   try {
    const data = await fetcher<T>(FetcherMethod.GET, key, undefined, controller.signal)
    if (disposed || current !== sequence) return
    cache.current.delete(key)
    cache.current.set(key, { data, at: Date.now() })
    if (cache.current.size > 12) cache.current.delete(cache.current.keys().next().value!)
    setSnapshot({ scope, key, dataKey: key, data, pending: false })
   } catch (error) {
    if (disposed || current !== sequence || controller.signal.aborted) return
    setSnapshot(old => ({ ...old, pending: false, error: error instanceof Error ? error : new Error("读取失败，请重试") }))
   } finally {
    if (!disposed && current === sequence) {
     timer = setTimeout(() => {
      if (document.visibilityState !== "hidden") void read()
      else scheduleVisibleCheck()
     }, 10000)
    }
   }
  }
  const scheduleVisibleCheck = () => {
   timer = setTimeout(() => {
    if (document.visibilityState !== "hidden") void read()
    else scheduleVisibleCheck()
   }, 10000)
  }
  refreshRef.current = read
  void read()
  return () => {
   disposed = true
   clearTimeout(timer)
   controller?.abort()
   refreshRef.current = async () => {}
  }
 }, [key, scope])

 const visible = snapshot.scope === scope && !!key
 const current = visible && snapshot.key === key
 return {
  data: visible ? snapshot.data : undefined,
  error: current ? snapshot.error : undefined,
  loading: !!key && (!current || snapshot.pending),
  current: current && snapshot.dataKey === key,
  refresh,
 }
}
