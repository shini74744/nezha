import { parse } from "acorn"
import { parseFragment } from "parse5"

export type Config = Record<string, any>
export type ScriptFeature = { id: string; src: string; enabled: boolean; original: string; start: number; end: number }
export type AppearanceDocument = { source: string; scripts: ScriptFeature[]; config?: Config; configRange?: [number, number]; configError?: string }
const marker = "nezha-appearance-disabled:"
const encode = (text: string) => btoa(Array.from(new TextEncoder().encode(text), b => String.fromCharCode(b)).join(""))
const decode = (text: string) => new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(text), c => c.charCodeAt(0)))

function literal(node: any): any {
    if (node.type === "Literal" && !node.regex && !node.bigint) return node.value
    if (node.type === "UnaryExpression" && ["-", "+"].includes(node.operator) && typeof node.argument.value === "number") {
        return node.operator === "-" ? -node.argument.value : node.argument.value
    }
    if (node.type === "ArrayExpression") return node.elements.map(literal)
    if (node.type === "ObjectExpression") {
        const result: Config = {}
        for (const p of node.properties) {
            if (p.type !== "Property" || p.computed || p.method || p.kind !== "init" || p.shorthand) throw new Error("配置包含动态表达式")
            const key = p.key.name ?? p.key.value
            if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("不支持的配置字段")
            if (Object.prototype.hasOwnProperty.call(result, key)) throw new Error("配置包含重复字段：" + key)
            result[key] = literal(p.value)
        }
        return result
    }
    throw new Error("配置不是静态数据；已保留原代码，请先在系统设置中检查")
}

export function readAppearance(source: string, configName = "NZ_FRONTEND_CONFIG"): AppearanceDocument {
    const result: AppearanceDocument = { source, scripts: [] }
    const root: any = parseFragment(source, { sourceCodeLocationInfo: true })
    const add = (node: any, start: number, end: number, original: string, enabled: boolean) => {
        const src = node.attrs?.find((a: any) => a.name === "src")?.value
        if (src) result.scripts.push({ id: String(start), src, start, end, original, enabled })
    }
    function visit(node: any) {
        const loc = node.sourceCodeLocation
        if (node.nodeName === "#comment" && node.data.trim().startsWith(marker)) {
            try {
                const original = decode(node.data.trim().slice(marker.length))
                const fragment: any = parseFragment(original)
                const script = fragment.childNodes[0]
                if (fragment.childNodes.length !== 1 || script?.tagName !== "script") throw new Error()
                add(script, loc.startOffset, loc.endOffset, original, false)
            } catch { throw new Error("停用脚本的备份标记损坏，请先检查原始代码") }
        } else if (node.tagName === "script" && loc) {
            if (node.attrs.some((a: any) => a.name === "src")) {
                add(node, loc.startOffset, loc.endOffset, source.slice(loc.startOffset, loc.endOffset), true)
            } else {
                const text = source.slice(loc.startTag.endOffset, loc.endTag?.startOffset ?? loc.endOffset)
                if (!text.includes(configName)) return
                try {
                    const ast: any = parse(text, { ecmaVersion: "latest" })
                    for (const statement of ast.body) {
                        const e = statement.expression
                        if (e?.type !== "AssignmentExpression" || e.operator !== "=" ||
                            e.left?.type !== "MemberExpression" || e.left.object?.name !== "window" ||
                            (e.left.computed ? e.left.property.value : e.left.property.name) !== configName) continue
                        if (result.configRange) throw new Error("存在多份 "+configName+"，不能自动覆盖")
                        result.config = literal(e.right)
                        if (!result.config || Array.isArray(result.config) || typeof result.config !== "object") throw new Error("配置必须是对象")
                        result.configRange = [loc.startTag.endOffset + e.right.start, loc.startTag.endOffset + e.right.end]
                    }
                } catch (error) { result.configError = String(error) }
            }
        } else if (node.tagName !== "template") {
            for (const child of node.childNodes || []) visit(child)
        }
    }
    visit(root)
    return result
}

export function writeAppearance(doc: AppearanceDocument, config: Config | undefined, states: Record<string, boolean>): string {
    const edits: { start: number; end: number; text: string }[] = []
    for (const script of doc.scripts) {
        const enabled = states[script.id] ?? script.enabled
        if (enabled !== script.enabled) edits.push({ start: script.start, end: script.end,
            text: enabled ? script.original : "<!-- " + marker + encode(script.original) + " -->" })
    }
    if (JSON.stringify(config) !== JSON.stringify(doc.config)) {
        if (!doc.configRange || doc.configError || !config) throw new Error("无法安全更新配置，原始代码未修改")
        validateConfig(config)
        // Escape HTML-significant characters so a text field cannot close the script.
        const json = JSON.stringify(config, null, 2).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026")
        edits.push({ start: doc.configRange[0], end: doc.configRange[1], text: json })
    }
    let source = doc.source
    for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end)
    return source
}

export function validateConfig(config: Config) {
    const url = (value: any, label: string) => {
        try { if (!["https:", "http:"].includes(new URL(String(value)).protocol)) throw new Error() }
        catch { throw new Error(label + "必须是有效的 HTTP/HTTPS 地址") }
    }
    for (const item of config.sponsor?.sponsors || []) { url(item.url, "赞助链接"); url(item.logo, "赞助 Logo") }
    const seen = new Set<string>()
    for (const item of config.extraScripts || []) {
        if (!item.enabled) continue
        url(item.src, "扩展脚本")
        if (seen.has(item.src)) throw new Error("扩展脚本地址重复")
        seen.add(item.src)
    }
    for (const field of ["shrinkDuration", "stayDuration", "fadeDuration", "mobileBottomThreshold"]) {
        const value = config.sponsor?.[field]
        if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) throw new Error(field + "必须是非负数")
    }
    if (config.sponsor?.desktopTop && !/^-?\d+(\.\d+)?(px|rem|em|vh|vw|%)$/.test(config.sponsor.desktopTop)) throw new Error("赞助条顶部位置需带单位，例如 310px")
    if (config.video?.enabled) {
        for (const key of ["videoSelector", "toggleSelector"]) {
            try { if (!config.video[key]) throw new Error(); document.querySelector(config.video[key]) }
            catch { throw new Error("视频选择器格式无效") }
        }
    }
    if (config.analytics?.enabled && !/^G-[A-Z0-9]+$/.test(config.analytics.measurementId || "")) throw new Error("统计 ID 格式应为 G- 开头")
}
