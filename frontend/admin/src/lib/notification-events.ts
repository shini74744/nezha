export type EventModule = {
    mode: "inherit" | "fields" | "disabled"
    title: string
    fields: string[]
}
export type EventConfig = { enabled: boolean; modules: Record<string, EventModule> }
export const eventKinds = [
    ["offline", "服务器离线", "🔴 服务器离线"],
    ["online", "服务器上线", "🟢 服务器上线"],
    ["ip_change", "IP 变更", "🌐 IP 地址变更"],
    ["alert", "资源告警", "⚠️ 资源告警"],
    ["alert_recovery", "资源恢复", "✅ 资源告警恢复"],
    ["service_alert", "服务异常", "🔴 服务异常"],
    ["service_recovery", "服务恢复", "🟢 服务恢复"],
    ["tls", "TLS 证书", "🔐 TLS 证书通知"],
    ["task_success", "任务成功", "✅ 任务执行成功"],
    ["task_failure", "任务失败", "❌ 任务执行失败"],
    ["ddns_success", "DDNS 更新成功", "✅ DDNS 更新成功"],
    ["ddns_failure", "DDNS 更新失败", "❌ DDNS 更新失败"],
    ["other", "其他通知", "🔔 其他通知"],
] as const
export const eventGroups = [
    { id: "server", label: "服务器状态（离线 / 上线）", kinds: ["offline", "online"] },
    { id: "resource", label: "资源告警（告警 / 恢复）", kinds: ["alert", "alert_recovery"] },
    {
        id: "service",
        label: "服务监测（异常 / 恢复）",
        kinds: ["service_alert", "service_recovery"],
    },
    { id: "ddns", label: "DDNS 更新（成功 / 失败）", kinds: ["ddns_success", "ddns_failure"] },
    { id: "task", label: "任务执行（成功 / 失败）", kinds: ["task_success", "task_failure"] },
    { id: "ip_change", label: "IP 变更", kinds: ["ip_change"] },
    { id: "tls", label: "TLS 证书", kinds: ["tls"] },
    { id: "other", label: "其他通知", kinds: ["other"] },
]
export const eventStateLabels: Record<string, string> = {
    offline: "离线",
    online: "上线",
    alert: "告警",
    alert_recovery: "恢复",
    service_alert: "异常",
    service_recovery: "恢复",
    ddns_success: "成功",
    ddns_failure: "失败",
    task_success: "成功",
    task_failure: "失败",
}
export const eventFields = [
    ["time", "发生时间"],
    ["server", "服务器名称 / ID"],
    ["ip", "IP 地址"],
    ["rule", "规则 / 服务 / 任务名称"],
    ["details", "事件详情"],
    ["old_ip", "原 IP 地址"],
    ["new_ip", "新 IP 地址"],
    ["ip_history", "历史 IP（最近 7 次）"],
    ["cpu", "CPU"],
    ["memory", "内存"],
    ["disk", "磁盘"],
    ["network", "实时网速"],
    ["transfer", "累计流量"],
    ["load", "系统负载"],
    ["tcp", "TCP 连接数"],
    ["udp", "UDP 连接数"],
    ["domain", "域名"],
    ["record_type", "记录类型（A / AAAA）"],
    ["target_ip", "目标 IP"],
    ["result", "更新结果"],
] as const
export function availableEventFields(kind: string) {
    const base = ["time", "server", "rule", "details"]
    const metrics = ["ip", "cpu", "memory", "disk", "network", "transfer", "load", "tcp", "udp"]
    const keys =
        kind === "ip_change"
            ? [...base, "old_ip", "new_ip", "ip_history", "tcp", "udp"]
            : [
                    "offline",
                    "online",
                    "alert",
                    "alert_recovery",
                    "task_success",
                    "task_failure",
                ].includes(kind)
              ? [...base, ...metrics]
              : base
    if (kind.startsWith("ddns_"))
        return eventFields.filter(([key]) =>
            [...base, "domain", "record_type", "target_ip", "result"].includes(key),
        )
    return eventFields.filter(([key]) => keys.includes(key))
}
export function defaultEventModule(kind: string): EventModule {
    return {
        mode: "fields",
        title: eventKinds.find(([key]) => key === kind)?.[2] || "🔔 其他通知",
        fields: kind.startsWith("ddns_")
            ? ["time", "server", "rule", "domain", "record_type", "target_ip", "result"]
            : kind === "ip_change"
              ? ["time", "server", "details", "new_ip", "old_ip", "ip_history"]
              : ["offline", "online"].includes(kind)
                ? ["time", "server", "ip"]
                : ["time", "server", "rule", "details"],
    }
}
export function defaultEventConfig(): EventConfig {
    return {
        enabled: true,
        modules: Object.fromEntries(eventKinds.map(([key]) => [key, defaultEventModule(key)])),
    }
}
export function eventPreview(kind: string, module: EventModule, formatUnits: boolean) {
    const details: Record<string, string> = {
        offline: "[离线] 示例服务器(192.0.2.**) 服务器已离线",
        online: "[上线] 示例服务器(192.0.2.**) 服务器已恢复在线",
        ip_change: "[IP 变更] 示例服务器, 192.0.2.** => 198.51.100.**",
        alert: "[事件] 示例服务器(192.0.2.**) CPU 高负载",
        alert_recovery: "[恢复] 示例服务器(192.0.2.**) CPU 高负载",
        service_alert: "[故障] 网站监测 Reporter: 示例服务器, Error: 连接超时",
        service_recovery: "[正常] 网站监测 Reporter: 示例服务器",
        tls: "[TLS] 网站证书将在七天内到期",
        task_success: "[任务成功] 每日检查, 示例服务器",
        task_failure: "[任务失败] 每日检查, 示例服务器",
        ddns_success: "[DDNS 更新成功] 示例服务器，example.com A 记录更新成功",
        ddns_failure: "[DDNS 更新失败] 示例服务器，example.com A 记录更新失败",
        other: "其他系统事件详情",
    }
    const values: Record<string, string> = {
        time: "时间：2026-09-28 12:00:00 +0800",
        server: "服务器：示例服务器（ID：12）",
        ip: "IP：192.0.2.**",
        rule:
            "规则：" +
            (["offline", "online"].includes(kind)
                ? "离线"
                : kind.startsWith("task")
                  ? "每日检查"
                  : kind.startsWith("service") || kind === "tls"
                    ? "网站监测"
                    : "CPU 高负载"),
        details: "详情：" + details[kind],
        old_ip: "旧 IP：192.0.2.**",
        new_ip: "新 IP：198.51.100.**",
        ip_history:
            "历史 IP（最近 7 次，时间为变更时间）：\n" +
            Array.from(
                { length: 7 },
                (_, i) =>
                    `${i + 1}. 192.0.2.**/2001:db8::**  2026-09-${String(28 - i).padStart(2, "0")} 12:00:00 +0800`,
            ).join("\n"),
        cpu: formatUnits ? "CPU：85.25 %" : "CPU：85.250000",
        memory: formatUnits ? "内存：50.00 %" : "内存：0.500000",
        disk: formatUnits ? "磁盘：25.00 %" : "磁盘：0.250000",
        network: formatUnits ? "网速：↓8.39 Mbps | ↑4.19 Mbps" : "网速：↓1048576 B/s | ↑524288 B/s",
        transfer: formatUnits
            ? "累计流量：↓1.0 GB | ↑512 MB"
            : "累计流量：↓1073741824 | ↑536870912",
        load: "负载：0.50 / 0.40 / 0.30",
        tcp: "TCP 连接数：16",
        udp: "UDP 连接数：4",
        domain: "域名：example.com",
        record_type: "记录类型：A",
        target_ip: "目标 IP：192.0.2.**",
        result:
            kind === "ddns_failure"
                ? "结果：更新失败，已用尽重试次数；请检查 DNS 服务商配置和网络"
                : "结果：更新请求执行成功（DNS 缓存生效可能延迟）",
    }
    if (kind.startsWith("ddns_")) values.rule = "规则：示例 DDNS 配置"
    // These producers do not carry host metrics; mirror the backend's omitted fields.
    if (kind === "tls" || kind === "other") delete values.server
    if (["offline", "online", "ip_change"].includes(kind)) {
        if (kind === "ip_change") delete values.rule
    }
    return [
        module.title.trim() || defaultEventModule(kind).title,
        ...module.fields.map((key) => values[key]).filter(Boolean),
    ].join("\n")
}
