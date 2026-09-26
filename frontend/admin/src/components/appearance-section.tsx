import { Switch } from "@/components/ui/switch"
import { ChevronDown } from "lucide-react"
import { type ReactNode, useId, useState } from "react"

type Props = {
    title: string
    description: string
    enabled?: boolean
    onEnabledChange?: (value: boolean) => void
    headingLevel?: 2 | 3
    children: ReactNode
}
export function AppearanceSection({
    title,
    description,
    enabled,
    onEnabledChange,
    headingLevel = 2,
    children,
}: Props) {
    const [open, setOpen] = useState(false)
    const id = useId()
    const Heading = headingLevel === 3 ? "h3" : "h2"
    return (
        <section className="rounded-lg border p-4">
            <div className="flex items-start gap-4">
                <div className="min-w-0 flex-1">
                    <Heading>
                        <button
                            type="button"
                            className="flex w-full items-center gap-2 rounded text-left font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                            aria-label={title}
                            aria-expanded={open}
                            aria-controls={id}
                            onClick={() => setOpen((value) => !value)}
                        >
                            <span className="min-w-0 flex-1">
                                <span className="block">{title}</span>
                                <span className="mt-1 block text-sm font-normal text-muted-foreground">{description}</span>
                            </span>
                            <ChevronDown
                                aria-hidden="true"
                                className={
                                    "h-4 w-4 shrink-0 transition-transform " +
                                    (open ? "rotate-180" : "")
                                }
                            />
                        </button>
                    </Heading>
                </div>
                {enabled !== undefined && onEnabledChange && <Switch aria-label={title} checked={enabled} onCheckedChange={onEnabledChange} />}
            </div>
            <div id={id} hidden={!open}>
                <div className="mt-4 border-t pt-4">{children}</div>
            </div>
        </section>
    )
}
