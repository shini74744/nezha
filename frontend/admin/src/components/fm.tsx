import { createTerminalSocket, type TerminalSocket } from "@/lib/terminal-transport"
import { createFM } from "@/api/fm"
import { useMediaQuery } from "@/hooks/useMediaQuery"
import { copyToClipboard, createFMWorker, fm, formatPath } from "@/lib/utils"
import { FMEntry, FMOpcode, FMWorkerData, FMWorkerOpcode, ModelCreateFMResponse } from "@/types"
import * as AlertDialog from "@radix-ui/react-alert-dialog"
import * as Dialog from "@radix-ui/react-dialog"
import {
    ArrowUp,
    Check,
    Copy,
    Download,
    File as FileIcon,
    Folder,
    LoaderCircle,
    Maximize2,
    Minimize2,
    RefreshCw,
    Upload,
    X,
} from "lucide-react"
import { CSSProperties, JSX, useCallback, useEffect, useRef, useState } from "react"
import { Virtuoso } from "react-virtuoso"

import "./fm.css"
import { IconButton } from "./xui/icon-button"

type Transfer = {
    kind: "upload" | "download"
    name: string
    path: string
    status: "running" | "done" | "error" | "cancelled"
    received: number
    total: number
    started: number
    message: string
}
type UploadChoice = { file: File; path: string }
interface FMProps {
    wsUrl: string
    onReconnect?: () => void
    reconnecting?: boolean
    onBusyChange?: (busy: boolean) => void
}
const filePath = (path: string, name: string) => formatPath(path + "/" + name)
const parentPath = (path: string) => {
    // Only normalize Windows drive paths; a backslash may be a real Unix filename.
    const normalized = /^[a-z]:[\\/]/i.test(path) ? path.replace(/\\/g, "/") : path
    const parent = normalized.replace(/\/+$/, "").replace(/\/[^/]*$/, "") || "/"
    return /^[a-z]:$/i.test(parent) ? parent + "/" : parent
}
const readableError = (error: unknown) =>
    (error instanceof Error ? error.message : String(error || "操作失败，请重试")).slice(0, 500)
const bytes = (n: number) => {
    const units = ["B", "KiB", "MiB", "GiB"]
    let i = 0
    while (n >= 1024 && i < units.length - 1) {
        n /= 1024
        i++
    }
    return (i ? n.toFixed(1) : n.toFixed(0)) + " " + units[i]
}

export function FMComponent({
    wsUrl,
    onReconnect,
    reconnecting,
    onBusyChange,
    ...props
}: FMProps & JSX.IntrinsicElements["div"]) {
    const [connection, setConnection] = useState<"connecting" | "connected" | "disconnected">(
        "connecting",
    )
    const [entries, setEntries] = useState<FMEntry[]>([])
    const [currentPath, setPath] = useState("")
    const [pathInput, setPathInput] = useState("")
    const [listing, setListing] = useState(false)
    const [error, setError] = useState("")
    const [notice, setNotice] = useState("")
    const [transfer, setTransferState] = useState<Transfer | null>(null)
    const [uploadChoice, setUploadChoice] = useState<UploadChoice | null>(null)
    const transferRef = useRef<Transfer | null>(null)
    const wsRef = useRef<TerminalSocket | null>(null)
    const pathRef = useRef("")
    const listingRef = useRef(false)
    const workerRef = useRef<Worker | null>(null)
    const workers = useRef(new Set<Worker>())
    const uploadRef = useRef<UploadChoice | null>(null)
    const generation = useRef(0)
    const receivedHeader = useRef(false)
    const lastActivity = useRef(Date.now())
    const failureMessage = useRef("")
    const fileInput = useRef<HTMLInputElement>(null)
    const busy = transfer?.status === "running"
    const connected = connection === "connected" && !reconnecting
    const updateTransfer = useCallback((next: Transfer | null) => {
        transferRef.current = next
        setTransferState(next)
    }, [])
    useEffect(() => {
        onBusyChange?.(!!busy)
    }, [busy, onBusyChange])
    const disposeWorker = useCallback((worker: Worker | null) => {
        if (!worker) return
        worker.onmessage = null
        worker.onerror = null
        worker.postMessage({ operation: 3 })
        // Give the worker time to close its own temporary file; never clear other origin files.
        setTimeout(() => {
            worker.terminate()
            workers.current.delete(worker)
        }, 2000)
        if (workerRef.current === worker) workerRef.current = null
    }, [])
    const fail = useCallback(
        (message: string) => {
            generation.current++
            failureMessage.current = message
            setConnection("disconnected")
            setError(message)
            setListing(false)
            listingRef.current = false
            const current = transferRef.current
            if (current?.status === "running")
                updateTransfer({ ...current, status: "error", message })
            disposeWorker(workerRef.current)
        },
        [disposeWorker, updateTransfer],
    )
    const sendList = useCallback((path: string) => {
        const ws = wsRef.current
        if (
            !ws ||
            ws.readyState !== WebSocket.OPEN ||
            transferRef.current?.status === "running" ||
            listingRef.current
        )
            return
        listingRef.current = true
        setListing(true)
        setError("")
        setNotice("")
        lastActivity.current = Date.now()
        const encoded = new TextEncoder().encode(path)
        const message = new Uint8Array(1 + encoded.length)
        message[0] = FMOpcode.List
        message.set(encoded, 1)
        ws.send(message)
    }, [])
    useEffect(() => {
        let active = true
        const url = new URL(wsUrl, window.location.origin)
        url.protocol = url.protocol.replace("http", "ws")
        const ws = createTerminalSocket(url)
        ws.binaryType = "arraybuffer"
        wsRef.current = ws
        setConnection("connecting")
        setError("")
        failureMessage.current = ""
        setListing(false)
        listingRef.current = false
        lastActivity.current = Date.now()
        ws.onopen = () => {
            if (active) {
                setConnection("connected")
                sendList(pathRef.current)
            }
        }
        ws.onclose = () => {
            if (!active) return
            setConnection("disconnected")
            fail(
                failureMessage.current ||
                    (transferRef.current?.status === "cancelled"
                        ? "传输已取消，重新连接后可继续浏览。"
                        : "文件连接已断开，请重新连接。"),
            )
        }
        ws.onerror = () => {
            if (active) {
                fail("无法连接文件管理，请检查节点状态后重试。")
                ws.close()
            }
        }
        ws.onmessage = async (event) => {
            if (!active) return
            lastActivity.current = Date.now()
            try {
                const buffer = event.data as ArrayBuffer
                const marker = new TextDecoder().decode(buffer.slice(0, 4))
                if (
                    receivedHeader.current &&
                    transferRef.current?.kind === "download" &&
                    transferRef.current.status === "running"
                ) {
                    workerRef.current?.postMessage(
                        { operation: 2, arrayBuffer: buffer, fileName: transferRef.current.name },
                        [buffer],
                    )
                } else if (marker === "NERR") {
                    throw new Error(new TextDecoder().decode(buffer.slice(4)) || "节点返回错误")
                } else if (marker === "NZFN") {
                    const result = await fm.parseFMList(buffer)
                    if (!active) return
                    pathRef.current = result.path
                    setPath(result.path)
                    setPathInput(formatPath(result.path))
                    setEntries(
                        result.fmList.sort(
                            (a, b) => b.type - a.type || a.name.localeCompare(b.name),
                        ),
                    )
                    listingRef.current = false
                    setListing(false)
                } else if (
                    marker === "NZTD" &&
                    transferRef.current?.kind === "download" &&
                    transferRef.current.status === "running"
                ) {
                    receivedHeader.current = true
                    workerRef.current?.postMessage(
                        { operation: 1, arrayBuffer: buffer, fileName: transferRef.current.name },
                        [buffer],
                    )
                } else if (
                    marker === "NZUP" &&
                    transferRef.current?.kind === "upload" &&
                    transferRef.current.status === "running"
                ) {
                    const current = transferRef.current
                    updateTransfer({
                        ...current,
                        status: "done",
                        received: current.total,
                        message: "上传完成",
                    })
                    sendList(pathRef.current)
                } else throw new Error("收到无法识别的文件响应，请重新连接")
            } catch (failure) {
                fail(readableError(failure))
                // A failed transfer must not leave binary payloads in the browsing stream.
                ws.close()
            }
        }
        const timer = setInterval(() => {
            if (!active) return
            const waiting =
                ws.readyState === WebSocket.CONNECTING ||
                listingRef.current ||
                transferRef.current?.status === "running"
            if (
                waiting &&
                Date.now() - lastActivity.current >
                    (ws.readyState === WebSocket.CONNECTING ? 15000 : 45000)
            ) {
                fail("等待节点响应超时，请重新连接后重试。")
                ws.close()
            }
        }, 1000)
        return () => {
            active = false
            generation.current++
            clearInterval(timer)
            ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null
            ws.close()
            if (wsRef.current === ws) wsRef.current = null
            disposeWorker(workerRef.current)
            receivedHeader.current = false
        }
    }, [wsUrl, sendList, fail, disposeWorker, updateTransfer])
    useEffect(
        () => () => {
            for (const worker of workers.current) disposeWorker(worker)
        },
        [disposeWorker],
    )

    function startDownload(name: string, path = pathRef.current) {
        const ws = wsRef.current
        if (
            !ws ||
            ws.readyState !== WebSocket.OPEN ||
            transferRef.current?.status === "running" ||
            listingRef.current
        )
            return
        disposeWorker(workerRef.current)
        receivedHeader.current = false
        setError("")
        setNotice("")
        updateTransfer({
            kind: "download",
            name,
            path,
            status: "running",
            received: 0,
            total: 0,
            started: Date.now(),
            message: "正在准备下载…",
        })
        lastActivity.current = Date.now()
        const worker = createFMWorker()
        workerRef.current = worker
        workers.current.add(worker)
        worker.onerror = () => {
            fail("浏览器无法准备下载，请重试或检查可用空间。")
            ws.close()
        }
        worker.onmessage = (event: MessageEvent<FMWorkerData>) => {
            if (workerRef.current !== worker || transferRef.current?.status !== "running") return
            const data = event.data,
                current = transferRef.current
            if (data.type === FMWorkerOpcode.Error) {
                fail(data.error || "下载失败，请重试")
                ws.close()
            }
            if (data.type === FMWorkerOpcode.Progress) {
                lastActivity.current = Date.now()
                updateTransfer({
                    ...current,
                    received: data.received ?? 0,
                    total: data.total ?? 0,
                    message: "正在下载…",
                })
            }
            if (data.type === FMWorkerOpcode.Result && data.blob) {
                receivedHeader.current = false
                workerRef.current = null
                const href = URL.createObjectURL(data.blob),
                    anchor = document.createElement("a")
                anchor.href = href
                anchor.download = current.name
                document.body.appendChild(anchor)
                anchor.click()
                anchor.remove()
                setTimeout(() => {
                    URL.revokeObjectURL(href)
                    disposeWorker(worker)
                }, 60000)
                updateTransfer({
                    ...current,
                    received: data.blob.size,
                    total: data.blob.size,
                    status: "done",
                    message: "下载已交给浏览器保存",
                })
            }
        }
        const encoded = new TextEncoder().encode(filePath(path, name)),
            message = new Uint8Array(1 + encoded.length)
        message[0] = FMOpcode.Download
        message.set(encoded, 1)
        ws.send(message)
    }
    async function startUpload(choice: UploadChoice) {
        setUploadChoice(null)
        const ws = wsRef.current
        if (
            !ws ||
            ws.readyState !== WebSocket.OPEN ||
            transferRef.current?.status === "running" ||
            listingRef.current
        )
            return
        uploadRef.current = choice
        setError("")
        setNotice("")
        const currentGeneration = ++generation.current
        const current = {
            kind: "upload" as const,
            name: choice.file.name,
            path: choice.path,
            status: "running" as const,
            received: 0,
            total: choice.file.size,
            started: Date.now(),
            message: "正在上传…",
        }
        updateTransfer(current)
        lastActivity.current = Date.now()
        const stillActive = () =>
            generation.current === currentGeneration &&
            wsRef.current === ws &&
            ws.readyState === WebSocket.OPEN &&
            transferRef.current?.status === "running"
        try {
            ws.send(fm.buildUploadHeader(choice))
            let offset = 0
            while (offset < choice.file.size && stillActive()) {
                while (ws.bufferedAmount > 4 * 1024 * 1024 && stillActive())
                    await new Promise((resolve) => setTimeout(resolve, 40))
                if (!stillActive()) return
                const data = await choice.file.slice(offset, offset + 1024 * 1024).arrayBuffer()
                if (!stillActive()) return
                ws.send(data)
                offset += data.byteLength
                lastActivity.current = Date.now()
                updateTransfer({
                    ...current,
                    received: offset,
                    message: offset === current.total ? "已发送，等待节点确认…" : "正在上传…",
                })
            }
        } catch (failure) {
            if (generation.current === currentGeneration) {
                fail(readableError(failure))
                ws.close()
            }
        }
    }
    function cancelTransfer() {
        const current = transferRef.current
        if (!current || current.status !== "running") return
        generation.current++
        updateTransfer({
            ...current,
            status: "cancelled",
            message:
                current.kind === "upload" ? "已取消。目标目录可能保留未完成文件。" : "下载已取消",
        })
        setConnection("disconnected")
        disposeWorker(workerRef.current)
        wsRef.current?.close()
    }
    function retryTransfer() {
        const current = transferRef.current
        if (!current || !connected) return
        if (current.kind === "upload" && uploadRef.current) setUploadChoice(uploadRef.current)
        else if (current.kind === "download") startDownload(current.name, current.path)
    }
    const progress = transfer?.total
        ? Math.min(
              transfer.status === "done" ? 100 : 99,
              Math.floor((transfer.received * 100) / transfer.total),
          )
        : 0
    return (
        <div {...props} className={"fm-browser " + (props.className || "")}>
            <div className="fm-toolbar" role="toolbar" aria-label="文件操作">
                <button
                    onClick={() => sendList(parentPath(currentPath))}
                    disabled={!connected || busy || listing || !currentPath || currentPath === "/"}
                >
                    <ArrowUp size={16} />
                    上级
                </button>
                <button
                    onClick={() => sendList(pathRef.current)}
                    disabled={!connected || busy || listing}
                >
                    <RefreshCw size={16} className={listing ? "animate-spin" : ""} />
                    刷新
                </button>
                <button
                    onClick={() =>
                        void copyToClipboard(formatPath(currentPath))
                            .then(() => setNotice("路径已复制"))
                            .catch((failure) => setError(readableError(failure)))
                    }
                    disabled={!currentPath}
                >
                    <Copy size={16} />
                    复制路径
                </button>
                <button
                    className="fm-upload-button"
                    onClick={() => fileInput.current?.click()}
                    disabled={!connected || busy || listing}
                >
                    <Upload size={16} />
                    上传
                </button>
                <input
                    type="file"
                    ref={fileInput}
                    hidden
                    onChange={(event) => {
                        const file = event.target.files?.[0]
                        event.target.value = ""
                        if (file) setUploadChoice({ file, path: pathRef.current })
                    }}
                />
            </div>
            <form
                className="fm-path"
                onSubmit={(event) => {
                    event.preventDefault()
                    sendList(pathInput.trim())
                }}
            >
                <label className="sr-only" htmlFor="fm-path-input">
                    目录路径
                </label>
                <input
                    id="fm-path-input"
                    value={pathInput}
                    onChange={(event) => setPathInput(event.target.value)}
                    placeholder="输入目录路径"
                    disabled={busy || !connected}
                />
                <button type="submit" disabled={!connected || busy || listing || !pathInput.trim()}>
                    前往
                </button>
            </form>
            {(connection !== "connected" || reconnecting) && (
                <div className="fm-status" role="status">
                    {connection === "connecting" || reconnecting ? (
                        <>
                            <LoaderCircle className="animate-spin" size={16} />
                            正在连接文件管理…
                        </>
                    ) : (
                        <>
                            文件连接已断开{" "}
                            <button onClick={onReconnect} disabled={!onReconnect}>
                                重新连接
                            </button>
                        </>
                    )}
                </div>
            )}
            {error && (
                <p className="fm-error" role="alert">
                    {error}
                </p>
            )}
            {notice && (
                <p className="fm-notice" role="status">
                    {notice}
                </p>
            )}
            <div className="fm-list-summary">
                <span title={formatPath(currentPath)}>{formatPath(currentPath) || "目录"}</span>
                <span>{listing ? "读取中…" : entries.length + " 项"}</span>
            </div>
            <div
                className="fm-files"
                aria-label="文件列表"
                aria-busy={listing || connection === "connecting"}
            >
                {entries.length ? (
                    <Virtuoso
                        data={entries}
                        style={{ height: "100%" }}
                        itemContent={(_, entry) => (
                            <div className="fm-row">
                                {entry.type === 1 ? (
                                    <button
                                        className="fm-name"
                                        onClick={() => sendList(filePath(currentPath, entry.name))}
                                        disabled={!connected || busy || listing}
                                        title={entry.name}
                                        aria-label={"打开目录 " + entry.name}
                                    >
                                        <Folder size={20} />
                                        <span>{entry.name}</span>
                                    </button>
                                ) : (
                                    <div className="fm-name" title={entry.name}>
                                        <FileIcon size={20} />
                                        <span>{entry.name}</span>
                                    </div>
                                )}
                                {entry.type === 0 && (
                                    <button
                                        className="fm-download"
                                        disabled={!connected || busy || listing}
                                        onClick={() => startDownload(entry.name)}
                                        aria-label={"下载 " + entry.name}
                                    >
                                        <Download size={16} />
                                        <span>下载</span>
                                    </button>
                                )}
                            </div>
                        )}
                    />
                ) : (
                    <div className="fm-empty">
                        {listing || connection === "connecting"
                            ? "正在读取目录…"
                            : connection === "disconnected"
                              ? "重新连接后查看文件"
                              : "此目录为空"}
                    </div>
                )}
            </div>
            {transfer && (
                <section className="fm-transfer" aria-label="文件传输" data-state={transfer.status}>
                    <div>
                        <strong>
                            {transfer.kind === "upload" ? "上传" : "下载"}：{transfer.name}
                        </strong>
                        {busy && <button onClick={cancelTransfer}>取消传输</button>}
                    </div>
                    <p role="status">{transfer.message}</p>
                    <progress value={progress} max={100} aria-label="传输进度" />
                    <div className="fm-transfer-stats">
                        <span>
                            {bytes(transfer.received)} /{" "}
                            {transfer.total ? bytes(transfer.total) : "待确认"}
                        </span>
                        <span>
                            {transfer.status === "done" ? (
                                <Check size={16} />
                            ) : (
                                bytes(
                                    transfer.received /
                                        Math.max(1, (Date.now() - transfer.started) / 1000),
                                ) + "/s"
                            )}
                        </span>
                    </div>
                    {busy && transfer.kind === "upload" && (
                        <small>取消后可能保留未完成文件。</small>
                    )}
                    {(transfer.status === "error" || transfer.status === "cancelled") && (
                        <button disabled={!connected || listing} onClick={retryTransfer}>
                            重试{!connected ? "（请先重新连接）" : ""}
                        </button>
                    )}
                </section>
            )}
            <AlertDialog.Root
                open={!!uploadChoice}
                onOpenChange={(open) => {
                    if (!open) setUploadChoice(null)
                }}
            >
                <AlertDialog.Portal
                    container={document.fullscreenElement as HTMLElement | undefined}
                >
                    <AlertDialog.Overlay className="fm-confirm-overlay" />
                    <AlertDialog.Content className="fm-confirm">
                        <AlertDialog.Title>确认上传文件？</AlertDialog.Title>
                        <AlertDialog.Description>
                            上传到{" "}
                            {uploadChoice && filePath(uploadChoice.path, uploadChoice.file.name)}
                            。如果已存在同名文件，将覆盖原文件；中断上传可能留下不完整文件。
                        </AlertDialog.Description>
                        <div>
                            <AlertDialog.Cancel>取消</AlertDialog.Cancel>
                            <AlertDialog.Action
                                onClick={() => {
                                    if (uploadChoice) void startUpload(uploadChoice)
                                }}
                            >
                                确认上传
                            </AlertDialog.Action>
                        </div>
                    </AlertDialog.Content>
                </AlertDialog.Portal>
            </AlertDialog.Root>
        </div>
    )
}

export function FMCard({ id }: { id?: string }) {
    const [open, setOpen] = useState(false)
    const [session, setSession] = useState<ModelCreateFMResponse | null>(null)
    const [connecting, setConnecting] = useState(false)
    const [error, setError] = useState("")
    const [wide, setWide] = useState(false)
    const [busy, setBusy] = useState(false)
    const [closeConfirm, setCloseConfirm] = useState(false)
    const sequence = useRef(0)
    const pending = useRef(false)
    const desktop = useMediaQuery("(min-width: 640px)")
    const connect = async () => {
        if (!id || pending.current) return
        const request = ++sequence.current
        pending.current = true
        setConnecting(true)
        setError("")
        const timer = setTimeout(() => {
            if (sequence.current === request) {
                sequence.current++
                pending.current = false
                setConnecting(false)
                setError("连接超时，请重试。")
            }
        }, 15000)
        try {
            const result = await createFM(id)
            if (sequence.current === request) setSession(result)
        } catch (failure) {
            if (sequence.current === request) setError(readableError(failure))
        } finally {
            clearTimeout(timer)
            if (sequence.current === request) {
                pending.current = false
                setConnecting(false)
            }
        }
    }
    const close = () => {
        sequence.current++
        pending.current = false
        setOpen(false)
        setSession(null)
        setBusy(false)
        setCloseConfirm(false)
    }
    const changeOpen = (next: boolean) => {
        if (next) {
            setOpen(true)
            void connect()
        } else if (busy) setCloseConfirm(true)
        else close()
    }
    useEffect(
        () => () => {
            sequence.current++
        },
        [],
    )
    return (
        <Dialog.Root open={open} onOpenChange={changeOpen} modal={!desktop}>
            <Dialog.Trigger asChild>
                <IconButton icon="folder-closed" aria-label="文件管理" title="文件管理" />
            </Dialog.Trigger>
            <Dialog.Portal container={document.fullscreenElement as HTMLElement | undefined}>
                {!desktop && <Dialog.Overlay className="fm-overlay" />}
                <Dialog.Content
                    className="fm-panel"
                    style={{ "--fm-width": wide ? "900px" : "560px" } as CSSProperties}
                    onInteractOutside={(event) => {
                        if (desktop) event.preventDefault()
                    }}
                >
                    <header className="fm-header">
                        <div>
                            <Dialog.Title>文件管理</Dialog.Title>
                            <Dialog.Description>服务器 {id}</Dialog.Description>
                        </div>
                        {desktop && (
                            <button
                                onClick={() => setWide((value) => !value)}
                                aria-label={wide ? "收窄文件面板" : "展开文件面板"}
                                title={wide ? "收窄" : "展开"}
                            >
                                {wide ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                            </button>
                        )}
                        <Dialog.Close asChild>
                            <button aria-label="关闭文件管理" title="关闭">
                                <X size={20} />
                            </button>
                        </Dialog.Close>
                    </header>
                    {session?.session_id ? (
                        <FMComponent
                            wsUrl={`/api/v1/ws/file/${session.session_id}`}
                            onReconnect={connect}
                            reconnecting={connecting}
                            onBusyChange={setBusy}
                        />
                    ) : (
                        <div className="fm-connect" role={error ? "alert" : "status"}>
                            {connecting ? (
                                <>
                                    <LoaderCircle size={24} className="animate-spin" />
                                    <p>正在连接文件管理…</p>
                                </>
                            ) : (
                                <>
                                    <p>{error || "尚未连接"}</p>
                                    <button onClick={() => void connect()}>重新连接</button>
                                </>
                            )}
                        </div>
                    )}
                    {session && error && (
                        <p className="fm-error" role="alert">
                            {error}
                        </p>
                    )}
                    <AlertDialog.Root open={closeConfirm} onOpenChange={setCloseConfirm}>
                        <AlertDialog.Portal
                            container={document.fullscreenElement as HTMLElement | undefined}
                        >
                            <AlertDialog.Overlay className="fm-confirm-overlay" />
                            <AlertDialog.Content className="fm-confirm">
                                <AlertDialog.Title>停止传输并关闭？</AlertDialog.Title>
                                <AlertDialog.Description>
                                    本次文件传输将停止，SSH 终端不受影响。上传可能保留未完成文件。
                                </AlertDialog.Description>
                                <div>
                                    <AlertDialog.Cancel>继续传输</AlertDialog.Cancel>
                                    <AlertDialog.Action onClick={close}>
                                        停止并关闭
                                    </AlertDialog.Action>
                                </div>
                            </AlertDialog.Content>
                        </AlertDialog.Portal>
                    </AlertDialog.Root>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    )
}
