import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { defaultPlanValueUnit, formatPlanValue, planValueUnits, splitPlanValue, type PlanValueKind } from "@/lib/plan-value-units"

interface Props {
    id: string
    kind: PlanValueKind
    label: string
    value?: string
    onChange: (value: string) => void
}

export default function PlanValueInput({ id, kind, label, value = "", onChange }: Props) {
    const { t } = useTranslation()
    const [pendingUnit, setPendingUnit] = useState(() => splitPlanValue(kind, value)?.unit || defaultPlanValueUnit[kind])
    const [draft, setDraft] = useState<{ value: string; amount: string } | null>(null)
    const parsed = splitPlanValue(kind, value)
    const unit = parsed?.unit || pendingUnit
    const unitLabel = kind === "amount"
        ? t("PublicNote.CurrencyUnit", { defaultValue: "Currency" })
        : t("PublicNote.ValueUnit", { defaultValue: "Unit" })
    const unitName = (key: string) => kind === "amount"
        ? t("PublicNote.Currency" + key, { defaultValue: key }) + " (" + key + ")"
        : key

    return <div className="flex min-w-0 gap-2" data-plan-value={kind}>
        <Input
            id={id} aria-label={label} inputMode="decimal" placeholder="0"
            className="min-w-0 flex-1"
            value={draft?.value === value ? draft.amount : parsed?.amount ?? value}
            onBlur={() => setDraft(null)}
            onChange={event => {
                const text = event.target.value
                const next = splitPlanValue(kind, text)
                const nextUnit = next?.unit || unit
                setPendingUnit(nextUnit)
                // Keep custom legacy descriptions intact until the user replaces them.
                const saved = next ? formatPlanValue(kind, next.amount, nextUnit) : text
                setDraft({ value: saved, amount: next?.amount ?? text })
                onChange(saved)
            }}
        />
        <Select
            value={parsed ? unit : ""} disabled={!parsed}
            onValueChange={nextUnit => {
                setPendingUnit(nextUnit)
                if (parsed?.amount) onChange(formatPlanValue(kind, parsed.amount, nextUnit))
            }}
        >
            <SelectTrigger
                aria-label={label + unitLabel}
                className={kind === "amount" ? "w-[140px] shrink-0" : "w-[90px] shrink-0"}
            ><SelectValue placeholder={unitLabel} /></SelectTrigger>
            <SelectContent>
                {planValueUnits[kind].map(key => <SelectItem key={key} value={key}>{unitName(key)}</SelectItem>)}
            </SelectContent>
        </Select>
    </div>
}
