import fs from "node:fs"
const manifest = JSON.parse(fs.readFileSync(
    new URL("../../src/lib/appearance-manifest.json", import.meta.url), "utf8",
)) as { key: string; defaults: Record<string, any> }[]
export function defaults() {
    return {
        version: 1, enabled: false,
        features: Object.fromEntries(manifest.map(item => [item.key, structuredClone(item.defaults)])),
    }
}
