import { Button } from "./ui/button"
import { Input } from "./ui/input"

export const appearanceGroups = [
    { id: "all", label: "全部" },
    { id: "brand", label: "品牌与文字" },
    { id: "layout", label: "背景与布局" },
    { id: "data", label: "数据与工具" },
    { id: "effects", label: "动画与特效" },
]
const sections: Record<string, string[]> = {
    brand: [
        "branding",
        "brand",
        "font",
        "greeting",
        "clock",
        "runtime",
        "quote",
        "footer",
        "sponsor",
    ],
    layout: ["background", "video", "dark", "links", "hideControls", "appearance"],
    data: [
        "visitorIP",
        "footerIP",
        "counter",
        "traffic",
        "speed",
        "nameColor",
        "peakCut",
        "analytics",
        "utilities",
        "protection",
        "speedColor",
    ],
    effects: [
        "sideImage",
        "network",
        "snow",
        "fragments",
        "heart",
        "sakura",
        "stars",
        "live2d",
        "effects",
        "animatedMan",
        "friendsBanner",
        "friendsInteraction",
        "gadgetDecorations",
        "backToTop",
        "speedAnimation",
        "cardGadgets",
    ],
}
export function matchesSetting(
    d: {
        key: string
        title: string
        description?: string
        labels: Record<string, string | undefined>
    },
    query: string,
    group: string,
) {
    const category =
        Object.entries(sections).find(([, keys]) => keys.includes(d.key))?.[0] ?? "data"
    return (
        (group === "all" || category === group) &&
        [d.title, d.description, ...Object.values(d.labels)]
            .join(" ")
            .toLowerCase()
            .includes(query.trim().toLowerCase())
    )
}
export default function SettingsFilter({
    query,
    onQuery,
    group,
    onGroup,
    groups = appearanceGroups,
    count,
}: {
    query: string
    onQuery: (v: string) => void
    group: string
    onGroup: (v: string) => void
    groups?: typeof appearanceGroups
    count: number
}) {
    return (
        <div className="space-y-3">
            <Input
                type="search"
                aria-label="搜索设置"
                placeholder="搜索设置名称或内容"
                value={query}
                onChange={(e) => onQuery(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-2">
                {groups.map((g) => (
                    <Button
                        key={g.id}
                        type="button"
                        size="sm"
                        variant={g.id === group ? "default" : "outline"}
                        aria-pressed={g.id === group}
                        onClick={() => onGroup(g.id)}
                    >
                        {g.label}
                    </Button>
                ))}
                <span className="ml-auto text-xs text-muted-foreground" role="status">
                    {count} 项设置
                </span>
            </div>
        </div>
    )
}
