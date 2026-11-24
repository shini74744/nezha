export const builtinFontIds = ["douyin", "harmony", "oppo", "misans", "bytedance", "noto", "lxgw", "system"] as const;
export type FontItem = { id: string; name: string; family: string; source: string; url: string; format: string; builtin: string };
type Feature = { enabled: boolean; [key: string]: any };
export function upgradeFont(feature: Feature, raw?: Partial<Feature>): Feature {
    if (raw && raw.activeId === undefined) {
        const old = raw.selection;
        return { ...feature, activeId: typeof old === "number" && Number.isInteger(old) && old >= 0 && old < 8 ? builtinFontIds[old] : "random" };
    }
    return feature;
}
const hex = /^#[0-9a-f]{6}$/i;
export function validateAppearanceOptions(features: Record<string, Feature>) {
    const f = features.font;
    if (f) {
        if (!Array.isArray(f.items) || f.items.length < 1 || f.items.length > 32) throw Error("字体须保留 1–32 项");
        const ids = new Set<string>();
        for (const item of f.items as FontItem[]) {
            if (!/^[a-zA-Z0-9_-]{1,64}$/.test(item.id) || item.id === "random" || ids.has(item.id)) throw Error("字体标识无效或重复");
            ids.add(item.id);
            if (!item.name.trim() || item.name.length > 80) throw Error("请填写字体名称（最多 80 字）");
            if (!item.family.trim() || item.family.length > 128) throw Error("请填写字体名称族（最多 128 字）");
            if (!["builtin", "file", "local"].includes(item.source)) throw Error("字体来源无效");
            if (!["woff2", "woff", "truetype", "opentype"].includes(item.format)) throw Error("字体格式无效");
            if (item.builtin && !(builtinFontIds as readonly string[]).includes(item.builtin)) throw Error("内置字体无效");
            if (item.source === "builtin" && !item.builtin) throw Error("请选择内置字体");
            if (item.source === "file" && !item.url.trim()) throw Error("请填写字体文件地址");
            if (item.url) { const u = new URL(item.url); if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) throw Error("字体地址须为 HTTP/HTTPS，且不能包含账号密码"); }
            if (/[\x00-\x1f]/.test(item.family)) throw Error("字体名称族不能包含控制字符");
        }
        if (f.activeId !== "random" && !ids.has(f.activeId)) throw Error("使用的字体已不存在，请重新选择");
    }
    if (features.heart && !hex.test(features.heart.fixedColor)) throw Error("爱心颜色须为六位颜色值，例如 #e85d8a");
    if (features.stars && (!Array.isArray(features.stars.palette) || features.stars.palette.length < 1 || features.stars.palette.length > 8 || features.stars.palette.some((v: unknown) => typeof v !== "string" || !hex.test(v)))) throw Error("星星须设置 1–8 种有效颜色");
    if (features.links) for (const key of ["textColor", "hoverColor", "loginColor"]) if (features.links[key] !== "" && !hex.test(features.links[key])) throw Error("链接颜色须为六位颜色值，留空则跟随主题");
    for (const key of ["heart", "stars", "sakura", "links"]) {
        const f = features[key]; if (!f) continue;
        for (const name of ["size", "duration", "interval", "distance", "spread", "fontSize", "gap", "hoverLift"]) if (typeof f[name] === "number" && !Number.isInteger(f[name])) throw Error("大小、时间、距离和间距须为整数");
    }
}
const quoteCSS = (value: string) => '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/</g, "\\3c ").replace(/>/g, "\\3e ").replace(/[\n\r\f]/g, " ") + '"';
export function chooseFont(feature: Feature, seed: number): FontItem | undefined {
    const items = feature.items as FontItem[];
    return feature.activeId === "random" ? items[Math.min(items.length - 1, Math.floor(seed * items.length))] : items.find(item => item.id === feature.activeId);
}
export function fontCSS(item: FontItem | undefined, builtins: string[]): string {
    if (!item) return "";
    if (item.source === "builtin") return builtins[builtinFontIds.indexOf(item.builtin as typeof builtinFontIds[number])] || "";
    const family = item.source === "file" ? "NZCustom-" + item.id : item.family;
    const face = item.source === "file" ? "@font-face{font-family:" + quoteCSS(family) + ";src:url(" + quoteCSS(item.url) + ") format(" + quoteCSS(item.format) + ");font-display:swap;}" : "";
    return face + "body,body *{font-family:" + quoteCSS(family) + ",system-ui,sans-serif!important}";
}
