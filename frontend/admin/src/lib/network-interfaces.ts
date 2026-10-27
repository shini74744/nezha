import { z } from "zod"

const interfaceSchema = z.object({
    name: z.string().min(1),
    kind: z.string().default("unknown"),
    state: z.string().default("unknown"),
    speed_mbps: z.number().nonnegative().optional(),
    parent: z.string().optional(),
    master: z.string().optional(),
    default_monitored: z.boolean(),
    monitored: z.boolean(),
})
const inventorySchema = z.object({
    available: z.boolean(),
    interfaces: z.array(interfaceSchema),
})
export type NetworkInterface = z.infer<typeof interfaceSchema>
export type NetworkInventory = z.infer<typeof inventorySchema>
export type NICSelection = Record<string, boolean> | null | undefined

export function parseNetworkInventory(value: unknown): NetworkInventory | undefined {
    const result = inventorySchema.safeParse(value)
    return result.success ? result.data : undefined
}
export function isAutomaticSelection(value: NICSelection) {
    return !value || Object.keys(value).length === 0
}
export function interfaceRows(inventory: NetworkInventory | undefined, value: NICSelection) {
    const rows = new Map<string, NetworkInterface & { missing?: boolean }>()
    for (const row of inventory?.interfaces ?? []) rows.set(row.name, row)
    for (const name of Object.keys(value ?? {})) {
        if (!rows.has(name))
            rows.set(name, {
                name,
                kind: "unknown",
                state: "unknown",
                missing: true,
                default_monitored: false,
                monitored: value?.[name] === true,
            })
    }
    return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name))
}
export function interfaceSelected(row: NetworkInterface, value: NICSelection) {
    return isAutomaticSelection(value) ? row.default_monitored : value?.[row.name] === true
}
// ApplyConfig merges maps on the Agent. Send explicit false entries for every
// known/configured interface, so deselection cannot leave an old true behind.
// An all-false map means zero selected; {} would silently restore defaults.
export function toggleInterface(
    rows: NetworkInterface[],
    value: NICSelection,
    name: string,
    checked: boolean,
): Record<string, boolean> {
    return Object.fromEntries([
        ...rows.map((row) => [row.name, interfaceSelected(row, value)] as const),
        [name, checked],
    ])
}
export function hasOverlappingSelection(rows: NetworkInterface[], value: NICSelection) {
    const selected = new Set(
        rows.filter((row) => interfaceSelected(row, value)).map((row) => row.name),
    )
    return (
        rows.some(
            (row) =>
                selected.has(row.name) &&
                ((row.parent && selected.has(row.parent)) ||
                    (row.master && selected.has(row.master))),
        ) ||
        (rows.some((row) => row.kind === "ppp" && selected.has(row.name)) &&
            rows.some(
                (row) =>
                    ["physical", "bridge", "vlan"].includes(row.kind) && selected.has(row.name),
            ))
    )
}
