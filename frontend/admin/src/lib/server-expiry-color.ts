// Only the remaining-day number is emphasized; notification thresholds are unchanged.
export function remainingDaysClass(days: number): string {
    if (!Number.isFinite(days) || days > 7 || days < 0) return ""
    if (days <= 1) return "font-semibold text-red-600 dark:text-red-400"
    if (days <= 3) return "font-semibold text-orange-600 dark:text-orange-400"
    return "font-semibold text-yellow-600 dark:text-yellow-400"
}
