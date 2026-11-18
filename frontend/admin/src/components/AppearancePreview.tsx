import type { AppearanceConfig } from "@/lib/appearance-config"
import type { DashboardAppearance } from "@/lib/dashboard-appearance"
import { type CSSProperties, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { dashboardCSS } from "./dashboard-appearance"
import { Button } from "./ui/button"

// Separate document: draft CSS, media queries and backgrounds never affect the editor.
// No application providers, sessions, analytics, custom scripts or write requests run here.
const documentHTML =
    '<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"></head><body><div id="root"></div></body></html>'
const safeURL = (value: unknown) => {
    if (typeof value !== "string") return ""
    try {
        const u = new URL(value, location.origin)
        return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password ? u.href : ""
    } catch {
        return ""
    }
}
const previewCSS = `
*{box-sizing:border-box}html,body{margin:0;min-height:100%;font-family:system-ui,"Microsoft YaHei",sans-serif}body{color:var(--text);background:var(--base)}
.preview-page{min-height:760px;position:relative;isolation:isolate}.preview-wallpaper{position:absolute;inset:0;z-index:-1;background-position:center;background-size:cover;pointer-events:none}
header{padding:24px 32px;display:flex;align-items:center;justify-content:space-between;gap:20px;background:var(--surface);border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:12px}.brand img{height:32px;max-width:130px;object-fit:contain}h1,h2,h3,p{margin:0}h1{font-size:22px}small,.muted{color:var(--muted-text)}nav{display:flex;flex-wrap:wrap;gap:16px;padding:14px 32px;background:var(--surface)}
main{padding:28px 32px;max-width:1280px;margin:auto}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}.tile,.server,.sample{border:1px solid var(--line);background:var(--surface);border-radius:18px;padding:20px;backdrop-filter:blur(var(--blur,12px))}.tile strong{display:block;font-size:24px;margin-top:6px}.servers{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.server h3{font-size:16px;margin-bottom:16px;overflow-wrap:anywhere}.meters{display:flex;gap:14px;margin-bottom:16px}.meters>div{flex:1;min-width:0}.meters b{display:block;font-size:15px;margin:6px 0}.track{height:5px;border-radius:8px;background:var(--line)}.track span{display:block;height:100%;border-radius:8px;background:#10b981}.transfer{display:flex;justify-content:space-between;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid var(--line);font-size:13px}.badge{display:inline-block;margin:12px 5px 0 0;padding:3px 8px;border-radius:5px;background:#0891b222;font-size:12px}.sample{margin-top:18px}.samples{display:grid;grid-template-columns:1fr 1fr;gap:12px}.dot{color:#10b981;margin-right:6px}.dora header{background:#0ea5e9;color:#fff}.dora .server{border:2px solid #38bdf8}.friends{padding:12px;text-align:center;font-size:26px;letter-spacing:20px}footer{text-align:center;padding:24px;font-size:12px}.greeting{margin:0 0 20px}.footer-link{margin-top:8px}button,input{font:inherit}
@media(max-width:600px){header{padding:20px 16px;align-items:flex-start}header .actions{display:none}nav{padding:12px 16px;gap:12px;font-size:13px}main{padding:20px 14px}.stats{grid-template-columns:repeat(2,1fr)}.servers{grid-template-columns:1fr}.samples{grid-template-columns:1fr}.tile,.server,.sample{padding:16px}.meters{gap:8px}.brand{min-width:0}.brand img{max-width:70px}h1{font-size:18px}}
`
export default function AppearancePreview({
    scope,
    config,
    validation,
}: {
    scope: "user-dist" | "doraemon-dist" | "paper-dist" | "dashboard"
    config: AppearanceConfig | DashboardAppearance
    validation?: string
}) {
    const [open, setOpen] = useState(false),
        [device, setDevice] = useState<"desktop" | "mobile">(() =>
            window.matchMedia?.("(max-width: 640px)")?.matches ? "mobile" : "desktop",
        ),
        [mode, setMode] = useState<"light" | "dark">("light")
    return (
        <section className="rounded-lg border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                    <h2 className="font-semibold">外观预览</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                        示例页面，修改后即时预览，保存后正式生效。
                    </p>
                </div>
                <Button
                    type="button"
                    variant="outline"
                    aria-expanded={open}
                    onClick={() => setOpen((v) => !v)}
                >
                    {open ? "收起预览" : "展开预览"}
                </Button>
            </div>
            {open && (
                <div className="space-y-3 border-t p-3 sm:p-4">
                    <div className="flex flex-wrap gap-2">
                        {(["desktop", "mobile"] as const).map((v) => (
                            <Button
                                key={v}
                                type="button"
                                size="sm"
                                variant={device === v ? "default" : "outline"}
                                aria-pressed={device === v}
                                onClick={() => setDevice(v)}
                            >
                                {v === "desktop" ? "电脑" : "手机"}
                            </Button>
                        ))}
                        <span className="mx-1 border-l" />
                        {(["light", "dark"] as const).map((v) => (
                            <Button
                                key={v}
                                type="button"
                                size="sm"
                                variant={mode === v ? "default" : "outline"}
                                aria-pressed={mode === v}
                                onClick={() => setMode(v)}
                            >
                                {v === "light" ? "浅色" : "深色"}
                            </Button>
                        ))}
                    </div>
                    {validation ? (
                        <p role="status" className="text-sm text-amber-600">
                            请先修正设置中的无效内容，再查看预览。
                        </p>
                    ) : (
                        <PreviewFrame scope={scope} config={config} device={device} mode={mode} />
                    )}
                    <p className="text-xs text-muted-foreground">
                        {scope === "dashboard"
                            ? "展示标题、背景、字体与不同界面的透明度。"
                            : "展示页面布局、品牌、基础背景和数据样式。分时背景、联网内容及动画请在保存后的页面查看。"}
                    </p>
                </div>
            )}
        </section>
    )
}
function PreviewFrame({
    scope,
    config,
    device,
    mode,
}: {
    scope: string
    config: AppearanceConfig | DashboardAppearance
    device: "desktop" | "mobile"
    mode: "light" | "dark"
}) {
    const frame = useRef<HTMLIFrameElement>(null),
        wrap = useRef<HTMLDivElement>(null),
        [root, setRoot] = useState<HTMLElement | null>(null),
        [available, setAvailable] = useState(0)
    const width = device === "mobile" ? 390 : 1100,
        scale = Math.min(1, (available || width) / width),
        height = 760
    useEffect(() => {
        const el = wrap.current
        if (!el) return
        const observer = new ResizeObserver(() => setAvailable(el.clientWidth))
        observer.observe(el)
        setAvailable(el.clientWidth)
        return () => observer.disconnect()
    }, [])
    useEffect(() => {
        if (!root) return
        const html = root.ownerDocument.documentElement
        html.classList.toggle("dark", mode === "dark")
        if (scope === "dashboard") html.dataset.nzDashboard = "true"
        else delete html.dataset.nzDashboard
        const css = {
            "--text": mode === "dark" ? "#f4f4f5" : "#18181b",
            "--muted-text": mode === "dark" ? "#b4b4c0" : "#596273",
            "--base": mode === "dark" ? "#131820" : "#f1f5f9",
            "--surface": mode === "dark" ? "#242a35cc" : "#ffffffbf",
            "--line": mode === "dark" ? "#ffffff25" : "#33415522",
        }
        for (const [k, v] of Object.entries(css)) html.style.setProperty(k, v)
    }, [root, mode, scope])
    const f = config.features,
        on = (k: string) => config.enabled && f[k]?.enabled,
        admin = scope === "dashboard",
        dora = scope === "doraemon-dist", paper = scope === "paper-dist"
    const brand = f[admin ? "brand" : "branding"],
        background = f.background
    const media = on("background")
        ? admin
            ? background.image
            : (device === "mobile" ? background.mobileMedia : background.desktopMedia)?.find(
                  (m: { type: string }) => m.type === "image",
              )?.src
        : ""
    const url = safeURL(media),
        logo = on(admin ? "brand" : "branding") ? safeURL(brand?.logo) : ""
    const pageStyle: CSSProperties =
        !admin && url
            ? {
                  backgroundImage: "url(" + JSON.stringify(url) + ")",
                  opacity: 1 - Number(background?.[mode + "Opacity"] ?? background?.opacity ?? 0),
                  filter:
                      "blur(" +
                      Number(background?.[mode + "Blur"] ?? background?.blur ?? 0) +
                      "px)",
              }
            : {}
    const opacity = (key: string) =>
        on("appearance") ? f.appearance[(mode === "dark" ? "dark" : "light") + key] : 1
    const surface = (key: string) =>
        "rgb(" + (mode === "dark" ? "13 13 13" : "255 255 255") + " / " + opacity(key) + ")"
    return (
        <div
            ref={wrap}
            className="relative overflow-hidden rounded-lg border bg-muted/20"
            style={{ height: height * scale }}
        >
            <iframe
                ref={frame}
                title="外观示例预览"
                sandbox="allow-same-origin"
                referrerPolicy="no-referrer"
                srcDoc={documentHTML}
                onLoad={() =>
                    setRoot(frame.current?.contentDocument?.getElementById("root") ?? null)
                }
                className="absolute left-1/2 top-0 block border-0"
                style={{
                    width,
                    height,
                    transform: "translateX(-50%) scale(" + scale + ")",
                    transformOrigin: "top center",
                }}
            />
            {root &&
                createPortal(
                    <>
                        <style>{previewCSS}</style>
                        {paper && <style>{".preview-page.paper{background:"+(mode==="dark"?"#29241e":"#faf5e9")+";color:"+(mode==="dark"?"#e1d3bb":"#3d342c")+";border:10px double "+(mode==="dark"?"#514737":"#d9ceba")+";border-radius:3px}.paper header{border-bottom:3px double #b9a889}.paper h1{font-family:serif;letter-spacing:.1em}.paper article,.paper .card{border-radius:3px;box-shadow:1px 3px 0 #80634015;background:"+(mode==="dark"?"#302a23":"#fffaf0")+"}"}</style>}

                        {admin && <style>{dashboardCSS(config as DashboardAppearance)}</style>}
                        <div
                            className={
                                "preview-page " +
                                (admin ? "dashboard-page-frame" : dora ? "dora" : paper ? "paper" : "")
                            }
                            onClickCapture={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                            }}
                        >
                            {!admin && url && (
                                <div className="preview-wallpaper" style={pageStyle} />
                            )}
                            <header>
                                <div className="brand">
                                    {logo && (
                                        <img
                                            alt=""
                                            src={logo}
                                            style={admin ? { height: brand.logoHeight } : undefined}
                                        />
                                    )}
                                    <div>
                                        <h1>
                                            {admin && on("brand")
                                                ? brand.title
                                                : dora
                                                  ? "哆啦 A 梦 · 云监控"
                                                  : "DDnezha 云监控"}
                                        </h1>
                                        {!admin && on("branding") && (
                                            <small>{brand.description}</small>
                                        )}
                                    </div>
                                </div>
                                <small className="actions">
                                    {admin ? "返回前台　☀" : "服务状态　　☀"}
                                </small>
                            </header>
                            {admin ? (
                                <nav style={{ background: surface("MutedOpacity") }}>
                                    服务器　 服务　 任务　 通知　 分组
                                </nav>
                            ) : dora && on("friendsBanner") ? (
                                <div className="friends" aria-label="伙伴同框示例">
                                    🔔　🚪　🍞　🚁　⭐
                                </div>
                            ) : null}
                            <main className={admin ? "dashboard-page-surface" : ""}>
                                {on("greeting") && (
                                    <p className="greeting">
                                        {f.greeting.rules?.[0]?.messages?.[0] || "欢迎回来"}
                                    </p>
                                )}
                                <div className="stats">
                                    {[
                                        ["在线服务器", "3 / 3"],
                                        ["上传速率", "28.6 Mbps"],
                                        ["下载速率", "16.4 Mbps"],
                                        ["累计流量", "1.28 TiB"],
                                    ].map(([k, v]) => (
                                        <div
                                            className="tile bg-card"
                                            style={
                                                admin
                                                    ? { background: surface("CardOpacity") }
                                                    : undefined
                                            }
                                            key={k}
                                        >
                                            <small>{k}</small>
                                            <strong>{v}</strong>
                                        </div>
                                    ))}
                                </div>
                                <div className="servers">
                                    {[
                                        "香港 · 示例服务器",
                                        "日本 · 示例服务器",
                                        "美国 · 示例服务器",
                                    ].map((name, i) => (
                                        <div
                                            className="server bg-card"
                                            key={name}
                                            style={
                                                admin
                                                    ? { background: surface("CardOpacity") }
                                                    : undefined
                                            }
                                        >
                                            <h3
                                                style={
                                                    on("nameColor")
                                                        ? {
                                                              color: [
                                                                  "#16a34a",
                                                                  "#0891b2",
                                                                  "#a855f7",
                                                              ][i],
                                                          }
                                                        : undefined
                                                }
                                            >
                                                <span className="dot">●</span>
                                                {dora && on("cardGadgets") ? "🚪 " : ""}
                                                {name}
                                            </h3>
                                            <div className="meters">
                                                {["CPU", "内存", "存储"].map((v, j) => (
                                                    <div key={v}>
                                                        <small>{v}</small>
                                                        <b>{[24, 48, 36][j]}%</b>
                                                        <div className="track">
                                                            <span
                                                                style={{
                                                                    width: [24, 48, 36][j] + "%",
                                                                }}
                                                            />
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                            <div className="transfer">
                                                <span
                                                    style={
                                                        on("speedColor") ||
                                                        (on("speed") && f.speed.color)
                                                            ? { color: "#e15554" }
                                                            : undefined
                                                    }
                                                >
                                                    上传{" "}
                                                    {on("speed") && !f.speed.bits
                                                        ? "3.58 MB/s"
                                                        : "28.6 Mbps"}
                                                </span>
                                                <span
                                                    style={
                                                        on("speedColor") ||
                                                        (on("speed") && f.speed.color)
                                                            ? { color: "#3b82f6" }
                                                            : undefined
                                                    }
                                                >
                                                    下载 16.4 Mbps
                                                </span>
                                            </div>
                                            {on("traffic") && (
                                                <>
                                                    <p
                                                        style={{
                                                            fontSize: 12,
                                                            margin: "12px 0 6px",
                                                        }}
                                                    >
                                                        本月流量 420 GB / 1000 GB
                                                    </p>
                                                    <div className="track">
                                                        <span style={{ width: "42%" }} />
                                                    </div>
                                                </>
                                            )}
                                            <span className="badge">IPv4</span>
                                            <span className="badge">在线</span>
                                        </div>
                                    ))}
                                </div>
                                {admin && (
                                    <div className="samples">
                                        <div
                                            className="sample"
                                            style={{ background: surface("PopoverOpacity") }}
                                        >
                                            <h3>弹窗与菜单</h3>
                                            <p className="muted" style={{ marginTop: 10 }}>
                                                这里预览弹窗背景和文字的对比。
                                            </p>
                                        </div>
                                        <div
                                            className="sample"
                                            style={{ background: surface("MutedOpacity") }}
                                        >
                                            <h3>导航与次要区域</h3>
                                            <p className="muted" style={{ marginTop: 10 }}>
                                                这里预览导航背景透明度。
                                            </p>
                                        </div>
                                    </div>
                                )}
                                {!admin && on("sponsor") && (
                                    <p className="sample">
                                        {f.sponsor.startText} {f.sponsor.sponsors?.[0]?.name}{" "}
                                        {f.sponsor.endText}
                                    </p>
                                )}
                            </main>
                            <footer>
                                {on("footer") ? f.footer.text : "DDnezha 云监控"}
                                {on("footer") && (
                                    <p className="footer-link">{f.footer.poweredText}</p>
                                )}
                            </footer>
                        </div>
                    </>,
                    root,
                )}
        </div>
    )
}
