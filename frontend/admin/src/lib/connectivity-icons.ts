// Same packaged brands as the public cards; never load a remote favicon.
const assets = {
    ...import.meta.glob<string>("../../../user/src/assets/connectivity/*.{ico,png,webp}", {
        eager: true,
        query: "?url",
        import: "default",
    }),
    ...import.meta.glob<string>("../../../user/src/assets/connectivity/*.svg", {
        eager: true,
        query: "?url&no-inline",
        import: "default",
    }),
}
export const connectivityIcons: Record<string, string> = Object.fromEntries(
    Object.entries(assets).map(([path, url]) => [
        path.slice(path.lastIndexOf("/") + 1).replace(/\.(ico|png|webp|svg)$/, ""),
        url,
    ]),
)

export function isStoredConnectivityIcon(value: string): boolean {
    return /^\/api\/v1\/logo\/assets\/[a-f0-9]{64}\.(png|jpg|webp|gif|ico|svg)$/.test(value)
}
export function resolveConnectivityIcon(value: string): string | undefined {
    return connectivityIcons[value] || (isStoredConnectivityIcon(value) ? value : undefined)
}
