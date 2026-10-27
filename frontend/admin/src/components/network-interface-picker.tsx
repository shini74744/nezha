import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
    NICSelection,
    NetworkInventory,
    hasOverlappingSelection,
    interfaceRows,
    interfaceSelected,
    isAutomaticSelection,
    toggleInterface,
} from "@/lib/network-interfaces"
import { useId, useState } from "react"

const kinds: Record<string, string> = {
    physical: "物理网口",
    virtual: "虚拟网卡",
    veth: "虚拟网卡（veth）",
    macvlan: "MACVLAN",
    macvtap: "MACVTAP",
    ipvlan: "IPVLAN",
    ipvtap: "IPVTAP",
    wireguard: "WireGuard",
    dummy: "虚拟网卡（Dummy）",
    bridge: "网桥",
    bond: "聚合接口",
    vlan: "VLAN",
    ppp: "拨号接口",
    loopback: "回环接口",
    tunnel: "隧道接口",
    unknown: "网络接口",
}

export function NetworkInterfacePicker({
    inventory,
    value,
    onChange,
}: {
    inventory?: NetworkInventory
    value: NICSelection
    onChange: (selection: NICSelection) => void
}) {
    const id = useId()
    const [manualName, setManualName] = useState("")
    const [error, setError] = useState("")
    const rows = interfaceRows(inventory, value)
    const automatic = isAutomaticSelection(value)
    const selectedCount = rows.filter((row) => interfaceSelected(row, value)).length
    const detected = inventory?.available === true

    function add() {
        const name = manualName.trim()
        if (
            !name ||
            name.length > 256 ||
            [...name].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
        ) {
            setError("请输入有效的网卡名称")
            return
        }
        if (rows.some((row) => row.name === name)) {
            setError("此网卡已在列表中")
            return
        }
        onChange(toggleInterface(rows, value, name, true))
        setManualName("")
        setError("")
    }

    return (
        <div className="min-w-0 space-y-2 rounded-md border border-input p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm">
                    {automatic ? "沿用默认统计规则" : "已选择 " + selectedCount + " 个网卡"}
                </p>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-9 [@media(pointer:coarse)]:min-h-11"
                    disabled={automatic}
                    onClick={() => onChange(null)}
                >
                    恢复默认
                </Button>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
                {detected
                    ? "勾选需要统计的网卡，提交后生效。恢复默认将沿用原有筛选规则。"
                    : inventory
                      ? "暂时无法读取网卡列表，现有设置保留。可手动添加网卡名称。"
                      : "当前 Agent 暂不支持网卡识别，现有设置保留。可手动添加网卡名称，升级后自动显示列表。"}
            </p>
            {rows.length > 0 ? (
                <div
                    className="max-h-64 overflow-y-auto overscroll-contain rounded-md border divide-y"
                    data-nic-list
                >
                    {rows.map((row, index) => (
                        <label
                            key={row.name}
                            htmlFor={id + "-" + index}
                            className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/50"
                        >
                            <Checkbox
                                id={id + "-" + index}
                                aria-label={"统计 " + row.name}
                                checked={interfaceSelected(row, value)}
                                onCheckedChange={(checked) =>
                                    onChange(
                                        toggleInterface(rows, value, row.name, checked === true),
                                    )
                                }
                            />
                            <span className="min-w-0 flex-1">
                                <span className="block break-all text-sm font-medium">
                                    {row.name}
                                </span>
                                <span className="flex flex-wrap gap-x-2 text-xs leading-5 text-muted-foreground">
                                    <span>{kinds[row.kind] ?? kinds.unknown}</span>
                                    {row.missing ? (
                                        <span>{detected ? "当前未检测到" : "已配置"}</span>
                                    ) : (
                                        <span>
                                            {row.state === "up"
                                                ? "已启用"
                                                : row.state === "down"
                                                  ? "未连接或未启用"
                                                  : "状态未知"}
                                        </span>
                                    )}
                                    {!!row.speed_mbps && (
                                        <span>
                                            {row.speed_mbps >= 1000
                                                ? "链路 " + row.speed_mbps / 1000 + " Gbps"
                                                : "链路 " + row.speed_mbps + " Mbps"}
                                        </span>
                                    )}
                                </span>
                            </span>
                        </label>
                    ))}
                </div>
            ) : detected ? (
                <p className="py-2 text-sm text-muted-foreground">
                    未检测到可用网卡，当前设置不变。
                </p>
            ) : null}
            {!automatic && selectedCount === 0 && (
                <p role="status" className="text-xs leading-5 text-muted-foreground">
                    未选择网卡，提交后将停止网络统计。恢复默认可重新启用默认统计。
                </p>
            )}
            {hasOverlappingSelection(rows, value) && (
                <p className="text-xs leading-5 text-amber-700 dark:text-amber-400">
                    同一路径的网卡、网桥或拨号接口可能重复计数，请按需要选择。
                </p>
            )}
            {!detected && (
                <div className="space-y-1">
                    <div className="flex min-w-0 gap-2">
                        <Input
                            aria-label="网卡名称"
                            placeholder="例如 eth0"
                            value={manualName}
                            className="min-w-0 flex-1 [@media(pointer:coarse)]:min-h-11"
                            onChange={(event) => {
                                setManualName(event.target.value)
                                setError("")
                            }}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                    event.preventDefault()
                                    add()
                                }
                            }}
                        />
                        <Button
                            type="button"
                            variant="outline"
                            onClick={add}
                            className="shrink-0 [@media(pointer:coarse)]:min-h-11"
                        >
                            添加
                        </Button>
                    </div>
                    {error && (
                        <p role="alert" className="text-xs text-destructive">
                            {error}
                        </p>
                    )}
                </div>
            )}
        </div>
    )
}
