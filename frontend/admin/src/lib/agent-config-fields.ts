export type NicRule = { name: string; enabled: boolean }
export type ConfigDraft = Record<string, string | boolean | NicRule[]>
export type ConfigField = {
    key: string
    label: string
    group: string
    description: string
    kind: "boolean" | "number" | "lines" | "nics"
    initial: string | boolean | NicRule[]
    inverse?: boolean
    min?: number
    max?: number
    unit?: string
    placeholder?: string
    warning?: string
}

export const configGroups = ["监控采集", "上报频率", "更新设置", "远程功能", "网络设置"]

export const agentConfigFields: ConfigField[] = [
    {
        key: "gpu",
        label: "GPU 监控",
        group: "监控采集",
        kind: "boolean",
        initial: true,
        description: "采集显卡信息；需要节点硬件及驱动支持。",
    },
    {
        key: "temperature",
        label: "温度监控",
        group: "监控采集",
        kind: "boolean",
        initial: true,
        description: "采集硬件温度，部分云服务器不提供温度数据。",
    },
    {
        key: "skip_connection_count",
        label: "网络连接数统计",
        group: "监控采集",
        kind: "boolean",
        initial: true,
        inverse: true,
        description: "统计 TCP / UDP 连接数。连接很多时可关闭以降低开销。",
    },
    {
        key: "skip_procs_count",
        label: "进程数统计",
        group: "监控采集",
        kind: "boolean",
        initial: true,
        inverse: true,
        description: "采集运行中的进程数量，关闭后不再统计。",
    },
    {
        key: "hard_drive_partition_allowlist",
        label: "监控磁盘分区",
        group: "监控采集",
        kind: "lines",
        initial: "",
        placeholder: "/\n/data",
        description: "每行一个挂载路径，仅监控所列分区。留空恢复自动识别。",
    },
    {
        key: "nic_allowlist",
        label: "监控网卡",
        group: "监控采集",
        kind: "nics",
        initial: [],
        description: "按网卡名合并设置。名单非空时，仅采集名单中标记为监控的网卡；空列表恢复自动识别全部网卡。",
    },
    {
        key: "debug",
        label: "调试日志",
        group: "监控采集",
        kind: "boolean",
        initial: false,
        description: "输出更详细的排错日志，开启后可能增加日志量。",
    },
    {
        key: "report_delay",
        label: "状态上报间隔",
        group: "上报频率",
        kind: "number",
        initial: "3",
        min: 1,
        max: 4,
        unit: "秒",
        description: "每 1–4 秒上报一次运行状态。间隔越短，更新越及时、开销越大。",
    },
    {
        key: "ip_report_period",
        label: "IP 更新间隔",
        group: "上报频率",
        kind: "number",
        initial: "1800",
        min: 30,
        max: 4294967295,
        unit: "秒",
        description: "定期检查公网 IP；至少 30 秒，通常使用 1800 秒（30 分钟）。",
    },
    {
        key: "disable_auto_update",
        label: "自动更新 Agent",
        group: "更新设置",
        kind: "boolean",
        initial: true,
        inverse: true,
        description: "自动检查并安装 Agent 更新；关闭后不会自动升级。",
    },
    {
        key: "disable_force_update",
        label: "允许面板强制更新",
        group: "更新设置",
        kind: "boolean",
        initial: true,
        inverse: true,
        description: "允许使用面板的更新按钮为该节点下发升级任务。",
        warning: "关闭后无法通过面板强制更新该节点。",
    },
    {
        key: "self_update_period",
        label: "自动更新检查间隔",
        group: "更新设置",
        kind: "number",
        initial: "0",
        min: 0,
        max: 4294967295,
        unit: "分钟",
        description: "仅在自动更新开启时有效。填 0 使用默认的 30–90 分钟随机间隔。",
    },
    {
        key: "disable_command_execute",
        label: "允许远程终端与文件管理",
        group: "远程功能",
        kind: "boolean",
        initial: true,
        inverse: true,
        description: "允许面板执行命令、打开网页终端及访问节点文件。",
        warning:
            "关闭后，网页终端、文件管理和远程配置将不可用；需要通过其他 SSH 连接修改节点配置才能重新开启。",
    },
    {
        key: "disable_nat",
        label: "允许内网穿透",
        group: "远程功能",
        kind: "boolean",
        initial: true,
        inverse: true,
        description: "允许此节点执行面板下发的内网穿透任务。",
        warning: "关闭后，此节点不再接受内网穿透任务。",
    },
    {
        key: "disable_send_query",
        label: "允许网络探测",
        group: "远程功能",
        kind: "boolean",
        initial: true,
        inverse: true,
        description: "允许此节点执行 TCP、ICMP 和 HTTP 探测任务。",
        warning: "关闭后，此节点不再执行网络探测，相关监控可能缺少数据。",
    },
    {
        key: "use_ipv6_country_code",
        label: "优先使用 IPv6 识别地区",
        group: "网络设置",
        kind: "boolean",
        initial: false,
        description: "使用 IPv6 地址查询节点地区；关闭时优先使用 IPv4。",
    },
    {
        key: "dns",
        label: "自定义 DNS",
        group: "网络设置",
        kind: "lines",
        initial: "",
        placeholder: "1.1.1.1\n8.8.8.8",
        description: "每行一个 DNS 地址，留空使用系统默认。错误的地址可能影响域名解析。",
        warning: "更改 DNS 可能影响节点连接面板，请确认地址在目标节点上可用。",
    },
    {
        key: "custom_ip_api",
        label: "公网 IP 查询地址",
        group: "网络设置",
        kind: "lines",
        initial: "",
        placeholder: "https://api.ipify.org",
        description: "每行一个 HTTP / HTTPS 地址，服务应返回公网 IP。留空使用默认查询服务。",
    },
]

export type ConfigPatch = Record<
    string,
    boolean | number | string[] | Record<string, boolean> | null
>

export function buildAgentConfigPatch(draft: ConfigDraft) {
    const patch: ConfigPatch = {}
    const errors: Record<string, string> = {}
    const changes: { key: string; label: string; value: string; warning?: string }[] = []
    for (const field of agentConfigFields) {
        if (!Object.prototype.hasOwnProperty.call(draft, field.key)) continue
        const raw = draft[field.key]
        let value: ConfigPatch[string]
        let summary: string
        if (field.kind === "boolean") {
            if (typeof raw !== "boolean") {
                errors[field.key] = "请选择开启或关闭"
                continue
            }
            value = field.inverse ? !raw : raw
            summary = raw ? "开启" : "关闭"
        } else if (field.kind === "number") {
            const number = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN
            if (!Number.isInteger(number) || number < field.min! || number > field.max!) {
                errors[field.key] =
                    field.key === "report_delay"
                        ? "请输入 1–4 之间的整数"
                        : "请输入 " + field.min + "–" + field.max + " 之间的整数"
                continue
            }
            value = number
            summary =
                number === 0 && field.key === "self_update_period"
                    ? "默认随机间隔"
                    : number + " " + field.unit
        } else if (field.kind === "nics") {
            if (!Array.isArray(raw)) {
                errors[field.key] = "请填写网卡名称"
                continue
            }
            const names = raw.map((row) => row.name.trim())
            if (
                names.some((name) => !name || /[\s\x00-\x1f]/.test(name)) ||
                new Set(names).size !== names.length ||
                raw.some((row) => typeof row.enabled !== "boolean")
            ) {
                errors[field.key] = "请填写不重复的网卡名称，不可包含空格"
                continue
            }
            // JSON decoding into an existing Go map merges keys. null is required to clear it.
            value = raw.length
                ? Object.fromEntries(raw.map((row, i) => [names[i], row.enabled]))
                : null
            summary = raw.length
                ? raw
                      .map((row, i) => names[i] + "：" + (row.enabled ? "监控" : "不监控"))
                      .join("；")
                : "恢复自动识别全部网卡"
        } else {
            if (typeof raw !== "string") {
                errors[field.key] = "请按行填写"
                continue
            }
            const lines = [
                ...new Set(
                    raw
                        .split(/\r?\n/)
                        .map((line) => line.trim())
                        .filter(Boolean),
                ),
            ]
            if (
                field.key === "custom_ip_api" &&
                lines.some((line) => {
                    try {
                        const url = new URL(line)
                        return (
                            !["http:", "https:"].includes(url.protocol) ||
                            !url.hostname ||
                            !!url.username ||
                            !!url.password
                        )
                    } catch {
                        return true
                    }
                })
            ) {
                errors[field.key] = "请填写有效的 HTTP / HTTPS 地址，不要包含账号或密码"
                continue
            }
            if (field.key === "dns" && lines.some((line) => /\s|:\/\//.test(line))) {
                errors[field.key] = "DNS 请填写地址，不要填写网址或空格"
                continue
            }
            value = lines
            summary = lines.length ? lines.join("；") : "使用默认设置"
        }
        patch[field.key] = value
        changes.push({
            key: field.key,
            label: field.label,
            value: summary,
            warning:
                field.warning && (field.kind !== "boolean" || raw === false)
                    ? field.warning
                    : undefined,
        })
    }
    return { patch, errors, changes }
}
