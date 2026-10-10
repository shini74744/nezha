import { FetcherMethod, fetcher } from "@/api/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { isStoredConnectivityIcon } from "@/lib/connectivity-icons"
import { useEffect, useRef, useState } from "react"

type Value = { icon: string; icon_source?: string }
export default function ConnectivityIconPicker({
    value,
    options,
    onChange,
    onBlockedChange,
}: {
    value: Value
    options: { id: string; name: string }[]
    onChange: (value: Value) => void
    onBlockedChange: (blocked: boolean) => void
}) {
    const [custom, setCustom] = useState(isStoredConnectivityIcon(value.icon)),
        [address, setAddress] = useState(value.icon_source || "")
    const [busy, setBusy] = useState(false),
        [error, setError] = useState("")
    const sequence = useRef({ value: 0 }),
        change = useRef(onChange),
        blockedChange = useRef(onBlockedChange)
    change.current = onChange
    blockedChange.current = onBlockedChange
    const pending =
        busy ||
        (custom &&
            (!isStoredConnectivityIcon(value.icon) || address.trim() !== (value.icon_source || "")))
    useEffect(() => {
        blockedChange.current(pending)
    }, [pending])
    useEffect(() => {
        const token = sequence.current
        return () => {
            token.value++
            blockedChange.current(false)
        }
    }, [])
    const importIcon = async () => {
        const source = address.trim()
        try {
            const url = new URL(source)
            if (
                source.length > 2048 ||
                url.protocol !== "https:" ||
                url.username ||
                url.password ||
                url.hash ||
                (url.port && url.port !== "443")
            )
                throw Error()
        } catch {
            setError("请输入完整 HTTPS 图片地址（不含账号密码或片段）")
            return
        }
        const request = ++sequence.current.value
        setBusy(true)
        setError("")
        try {
            const fetched = await fetcher<{ image: string }>(
                FetcherMethod.POST,
                "/api/v1/logo/fetch",
                { url: source, mode: "image" },
            )
            if (request !== sequence.current.value) return
            const stored = await fetcher<{ logo: string }>(
                FetcherMethod.POST,
                "/api/v1/logo/store",
                { logo: fetched.image },
            )
            if (request !== sequence.current.value) return
            if (!isStoredConnectivityIcon(stored.logo)) throw Error("图标保存结果无效")
            change.current({ icon: stored.logo, icon_source: source })
            setAddress(source)
        } catch (e) {
            if (request === sequence.current.value) setError(String(e) + "，原图标未更改。")
        } finally {
            if (request === sequence.current.value) setBusy(false)
        }
    }
    return (
        <div className="contents" data-connectivity-icon-picker>
            <label className="block space-y-1 text-sm">
                <span>图标</span>
                <select
                    aria-label="图标"
                    disabled={busy}
                    className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"
                    value={custom ? "custom" : value.icon}
                    onChange={(e) => {
                        setError("")
                        if (e.target.value === "custom") {
                            setCustom(true)
                        } else {
                            setCustom(false)
                            setAddress("")
                            change.current({ icon: e.target.value, icon_source: "" })
                        }
                    }}
                >
                    <option value="">默认地球图标</option>
                    <option value="custom">自定义图标地址</option>
                    {options.map((row) => (
                        <option key={row.id} value={row.id}>
                            {row.name}
                        </option>
                    ))}
                </select>
            </label>
            {custom && (
                <div className="space-y-2 rounded-md border p-3 sm:col-span-2">
                    <label className="block space-y-1 text-sm">
                        <span>图标地址</span>
                        <Input
                            aria-label="图标地址"
                            type="url"
                            maxLength={2048}
                            placeholder="https://example.com/icon.png"
                            disabled={busy}
                            value={address}
                            onChange={(e) => setAddress(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    e.preventDefault()
                                    if (!busy) void importIcon()
                                }
                            }}
                        />
                    </label>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={busy || !address.trim()}
                        onClick={() => void importIcon()}
                    >
                        {busy ? "正在导入…" : "使用图标地址"}
                    </Button>
                    <p className="text-xs text-muted-foreground">
                        导入 PNG/JPEG/WebP/GIF/ICO 或安全 SVG，最大 2
                        MiB。请勿使用含密钥或私密信息的链接。
                    </p>
                    {!pending && (
                        <p role="status" className="text-xs text-muted-foreground">
                            图标已导入，保存到草稿后仍需点击“保存配置”。
                        </p>
                    )}
                    {pending && !busy && !error && (
                        <p className="text-xs text-muted-foreground">
                            请先点击“使用图标地址”完成导入。
                        </p>
                    )}
                </div>
            )}
            {error && (
                <p role="alert" className="text-xs text-destructive sm:col-span-2">
                    {error}
                </p>
            )}
        </div>
    )
}
