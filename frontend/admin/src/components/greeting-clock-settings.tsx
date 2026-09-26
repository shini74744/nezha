import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { type Feature, definitions } from "@/lib/appearance-config"

type Rule = { name: string; start: string; end: string; messages: string[] }
export function GreetingSettings({
    value,
    onChange,
}: {
    value: Feature
    onChange: (value: Feature) => void
}) {
    const rules = value.rules as Rule[]
    const replace = (next: Rule[]) => onChange({ ...value, rules: next })
    const patch = (index: number, fields: Partial<Rule>) =>
        replace(rules.map((rule, i) => (i === index ? { ...rule, ...fields } : rule)))
    return (
        <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
                按访客本地时间匹配，包含开始、不包含结束；支持跨午夜，起止相同表示全天。重叠时取上方第一个时段。空白文案忽略，无匹配文案时显示主题原问候语。
            </p>
            {rules.map((rule, index) => (
                <fieldset key={index} className="min-w-0 space-y-3 rounded border p-3">
                    <legend className="px-1 text-sm">
                        时段 {index + 1} · {rule.name || "未命名"}
                    </legend>
                    <div className="grid gap-3 sm:grid-cols-3">
                        <label className="min-w-0">
                            名称
                            <Input
                                aria-label={"问候时段名称 " + (index + 1)}
                                value={rule.name}
                                onChange={(e) => patch(index, { name: e.target.value })}
                            />
                        </label>
                        <label className="min-w-0">
                            开始时间
                            <Input
                                aria-label={"问候开始时间 " + (index + 1)}
                                type="time"
                                value={rule.start}
                                onChange={(e) => patch(index, { start: e.target.value })}
                            />
                        </label>
                        <label className="min-w-0">
                            结束时间
                            <Input
                                aria-label={"问候结束时间 " + (index + 1)}
                                type="time"
                                value={rule.end}
                                onChange={(e) => patch(index, { end: e.target.value })}
                            />
                        </label>
                    </div>
                    {rule.messages.map((message, j) => (
                        <div className="flex min-w-0 items-center gap-2" key={j}>
                            <Input
                                className="min-w-0 flex-1"
                                aria-label={"问候语 " + (index + 1) + "-" + (j + 1)}
                                value={message}
                                onChange={(e) =>
                                    patch(index, {
                                        messages: rule.messages.map((item, k) =>
                                            k === j ? e.target.value : item,
                                        ),
                                    })
                                }
                            />
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="shrink-0"
                                aria-label={"删除问候语 " + (index + 1) + "-" + (j + 1)}
                                onClick={() =>
                                    patch(index, {
                                        messages: rule.messages.filter((_, k) => k !== j),
                                    })
                                }
                            >
                                删除
                            </Button>
                        </div>
                    ))}
                    <div className="flex flex-wrap gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={rule.messages.length >= 256}
                            aria-label={"添加问候语 " + (index + 1)}
                            onClick={() => patch(index, { messages: [...rule.messages, ""] })}
                        >
                            添加问候语
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={index === 0}
                            aria-label={"上移问候时段 " + (index + 1)}
                            onClick={() => {
                                const next = [...rules]
                                ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
                                replace(next)
                            }}
                        >
                            上移时段
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label={"删除问候时段 " + (index + 1)}
                            onClick={() => replace(rules.filter((_, i) => i !== index))}
                        >
                            删除时段
                        </Button>
                    </div>
                </fieldset>
            ))}
            <Button
                type="button"
                variant="outline"
                disabled={rules.length >= 32}
                onClick={() =>
                    replace([
                        ...rules,
                        { name: "新时段", start: "00:00", end: "00:00", messages: [""] },
                    ])
                }
            >
                添加问候时段
            </Button>
        </div>
    )
}
export function ClockSettings({
    value,
    onChange,
}: {
    value: Feature
    onChange: (value: Feature) => void
}) {
    const definition = definitions.find((item) => item.key === "clock")!
    const valid = (color: string) => /^#[0-9a-f]{6}$/i.test(color)
    return (
        <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
                小时按 0–23、分秒按 0–59 从起始色渐变到结束色。可点色块选色，或填写
                #RRGGBB；起止颜色相同即为纯色。
            </p>
            <div className="grid gap-4 lg:grid-cols-3">
                {[
                    ["hour", "小时"],
                    ["minute", "分钟"],
                    ["second", "秒钟"],
                ].map(([unit, title]) => (
                    <fieldset key={unit} className="min-w-0 space-y-3 rounded border p-3">
                        <legend className="px-1">{title}</legend>
                        {["StartColor", "EndColor"].map((suffix) => {
                            const key = unit + suffix
                            return (
                                <div key={key} className="space-y-1">
                                    <label htmlFor={"clock-" + key} className="text-sm">
                                        {definition.labels[key]}
                                    </label>
                                    <div className="flex min-w-0 items-center gap-2">
                                        <input
                                            type="color"
                                            aria-label={definition.labels[key] + "选色"}
                                            className="h-10 w-12 shrink-0 cursor-pointer rounded border bg-transparent p-1"
                                            value={valid(value[key]) ? value[key] : "#ffffff"}
                                            onChange={(e) =>
                                                onChange({ ...value, [key]: e.target.value })
                                            }
                                        />
                                        <Input
                                            id={"clock-" + key}
                                            className="min-w-0"
                                            value={value[key]}
                                            onChange={(e) =>
                                                onChange({ ...value, [key]: e.target.value })
                                            }
                                        />
                                    </div>
                                </div>
                            )
                        })}
                        <div
                            aria-label={title + "渐变预览"}
                            className="h-5 rounded border"
                            style={{
                                background:
                                    valid(value[unit + "StartColor"]) &&
                                    valid(value[unit + "EndColor"])
                                        ? "linear-gradient(to right, " +
                                          value[unit + "StartColor"] +
                                          ", " +
                                          value[unit + "EndColor"] +
                                          ")"
                                        : undefined,
                            }}
                        />
                    </fieldset>
                ))}
            </div>
        </div>
    )
}
