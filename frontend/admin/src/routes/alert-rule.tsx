import { deleteAlertRules } from "@/api/alert-rule"
import { swrFetcher } from "@/api/api"
import { ActionButtonGroup } from "@/components/action-button-group"
import { AlertRuleCard } from "@/components/alert-rule"
import { CopyButton } from "@/components/copy-button"
import { HeaderButtonGroup } from "@/components/header-button-group"
import { NotificationTab } from "@/components/notification-tab"
import { Checkbox } from "@/components/ui/checkbox"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { useNotification } from "@/hooks/useNotfication"
import { ruleSummary } from "@/lib/alert-rule-editor"
import { selectableTableFeatures } from "@/lib/table"
import { ModelAlertRule, triggerModes } from "@/types"
import { ColumnDef, flexRender, useTable } from "@tanstack/react-table"
import { useEffect, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import useSWR from "swr"

export default function AlertRulePage() {
    const { t } = useTranslation()
    const { notifierGroup } = useNotification()

    const { data, mutate, error, isLoading } = useSWR<ModelAlertRule[]>(
        "/api/v1/alert-rule",
        swrFetcher,
    )

    useEffect(() => {
        if (error)
            toast(t("Error"), {
                description: t("Results.ErrorFetchingResource", { error: error.message }),
            })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [error])

    const columns: ColumnDef<typeof selectableTableFeatures, ModelAlertRule>[] = [
        {
            id: "select",
            header: ({ table }) => (
                <Checkbox
                    checked={
                        table.getIsAllPageRowsSelected() ||
                        (table.getIsSomePageRowsSelected() && "indeterminate")
                    }
                    onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
                    aria-label="Select all"
                />
            ),
            cell: ({ row }) => (
                <Checkbox
                    checked={row.getIsSelected()}
                    onCheckedChange={(value) => row.toggleSelected(!!value)}
                    aria-label="Select row"
                />
            ),
            enableHiding: false,
        },
        {
            header: "ID",
            accessorKey: "id",
            accessorFn: (row) => row.id,
        },
        {
            header: t("Name"),
            accessorKey: "name",
            accessorFn: (row) => row.name,
            cell: ({ row }) => {
                const s = row.original
                return <div className="max-w-32 whitespace-normal break-words">{s.name}</div>
            },
        },
        {
            header: t("NotifierGroup"),
            accessorKey: "ngroup",
            accessorFn: (row) => row.notification_group_id,
            cell: ({ row }) =>
                notifierGroup?.find((g) => g.group.id === row.original.notification_group_id)?.group
                    .name ||
                (row.original.notification_group_id
                    ? `#${row.original.notification_group_id}`
                    : "不发送"),
        },
        {
            header: t("TriggerMode"),
            accessorKey: "trigger Mode",
            accessorFn: (row) => triggerModes[row.trigger_mode] || "",
            cell: ({ row }) => (row.original.trigger_mode === 1 ? "单次触发" : "持续触发"),
        },
        {
            header: t("Rules"),
            cell: ({ row }) => {
                const s = row.original
                return (
                    <div className="min-w-52 max-w-sm space-y-2 whitespace-normal break-words">
                        {s.rules.map((rule, index) => (
                            <p key={index} className="text-xs leading-relaxed">
                                {index > 0 ? "且 " : ""}
                                {ruleSummary(rule)}
                            </p>
                        ))}
                        <CopyButton text={JSON.stringify(s.rules)} />
                    </div>
                )
            },
        },
        {
            header: t("TasksToTriggerOnAlert"),
            accessorKey: "failTriggerTasks",
            accessorFn: (row) => row.fail_trigger_tasks,
        },
        {
            header: t("TasksToTriggerAfterRecovery"),
            accessorKey: "recoverTriggerTasks",
            accessorFn: (row) => row.recover_trigger_tasks,
        },
        {
            header: t("Enable"),
            accessorKey: "enable",
            accessorFn: (row) => row.enable,
            cell: ({ row }) => (
                <span
                    className={
                        row.original.enable
                            ? "text-green-700 dark:text-green-400"
                            : "text-muted-foreground"
                    }
                >
                    {row.original.enable ? "已启用" : "已停用"}
                </span>
            ),
        },
        {
            id: "actions",
            header: t("Actions"),
            cell: ({ row }) => {
                const s = row.original
                return (
                    <ActionButtonGroup
                        className="flex gap-2"
                        delete={{
                            fn: deleteAlertRules,
                            id: s.id,
                            mutate: mutate,
                        }}
                    >
                        <AlertRuleCard mutate={mutate} data={s} />
                    </ActionButtonGroup>
                )
            },
        },
    ]

    const dataCache = useMemo(() => {
        return data ?? []
    }, [data])

    const table = useTable({
        features: selectableTableFeatures,
        data: dataCache,
        columns,
    })

    const selectedRows = table.getSelectedRowModel().rows

    return (
        <div className="px-3">
            <div className="flex flex-wrap gap-3 mt-6 mb-4">
                <NotificationTab className="w-full sm:flex-1 sm:max-w-2xl" />
                <HeaderButtonGroup
                    className="flex ml-auto self-end sm:self-auto gap-2 flex-wrap shrink-0"
                    delete={{
                        fn: deleteAlertRules,
                        id: selectedRows.map((r) => r.original.id),
                        mutate: mutate,
                    }}
                >
                    <AlertRuleCard mutate={mutate} />
                </HeaderButtonGroup>
            </div>

            <Table>
                <TableHeader>
                    {table.getHeaderGroups().map((headerGroup) => (
                        <TableRow key={headerGroup.id}>
                            {headerGroup.headers.map((header) => {
                                return (
                                    <TableHead key={header.id} className="text-sm">
                                        {header.isPlaceholder
                                            ? null
                                            : flexRender(
                                                  header.column.columnDef.header,
                                                  header.getContext(),
                                              )}
                                    </TableHead>
                                )
                            })}
                        </TableRow>
                    ))}
                </TableHeader>
                <TableBody>
                    {isLoading ? (
                        <TableRow>
                            <TableCell colSpan={columns.length} className="h-24 text-center">
                                {t("Loading")}...
                            </TableCell>
                        </TableRow>
                    ) : table.getRowModel().rows?.length ? (
                        table.getRowModel().rows.map((row) => (
                            <TableRow key={row.id} data-state={row.getIsSelected() && "selected"}>
                                {row.getVisibleCells().map((cell) => (
                                    <TableCell key={cell.id} className="text-xsm">
                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    </TableCell>
                                ))}
                            </TableRow>
                        ))
                    ) : (
                        <TableRow>
                            <TableCell colSpan={columns.length} className="h-24 text-center">
                                {t("NoResults")}
                            </TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>
        </div>
    )
}
