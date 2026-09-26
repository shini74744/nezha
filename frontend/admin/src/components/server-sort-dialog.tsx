import { reassignServerIDs, updateServerOrder } from "@/api/server"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { IconButton } from "@/components/xui/icon-button"
import { ModelServer } from "@/types"
import { GripVertical, ListRestart } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { KeyedMutator } from "swr"

interface ServerSortDialogProps {
    servers: ModelServer[]
    mutate: KeyedMutator<ModelServer[]>
}

export function reorderServers(
    current: ModelServer[],
    draggedID: number,
    targetID: number,
    after: boolean,
): ModelServer[] {
    if (draggedID === targetID) return current
    const from = current.findIndex((server) => server.id === draggedID)
    if (from < 0 || !current.some((server) => server.id === targetID)) return current
    const next = [...current]
    const [moved] = next.splice(from, 1)
    const targetIndex = next.findIndex((server) => server.id === targetID)
    next.splice(targetIndex + (after ? 1 : 0), 0, moved)
    return next
}

export function ServerSortDialog({ servers, mutate }: ServerSortDialogProps) {
    const { t } = useTranslation()
    const [open, setOpen] = useState(false)
    const [ordered, setOrdered] = useState<ModelServer[]>(servers)
    const [draggedID, setDraggedID] = useState<number | null>(null)
    const [saving, setSaving] = useState(false)
    const [reassigning, setReassigning] = useState(false)

    useEffect(() => {
        if (!open) setOrdered(servers)
    }, [servers, open])

    const handleOpenChange = (next: boolean) => {
        if (next) setOrdered(servers)
        setOpen(next)
    }

    const moveTo = (targetID: number, after: boolean) => {
        if (draggedID === null) return
        setOrdered((current) => reorderServers(current, draggedID, targetID, after))
    }

    const saveOrder = async () => {
        setSaving(true)
        try {
            await updateServerOrder(ordered.map((server) => server.id))
            await mutate()
            toast(t("Success"), { description: t("ServerOrderSaved") })
            setOpen(false)
        } catch (error) {
            toast(t("Error"), { description: String(error) })
        } finally {
            setSaving(false)
        }
    }
    const assignSystemIDs = async () => {
        setReassigning(true)
        try {
            await reassignServerIDs(ordered.map((server) => server.id))
            toast(t("Done"), { description: t("ServerIDReassignRestarting") })
            setOpen(false)
        } catch (error) {
            toast(t("Error"), { description: String(error) })
            setReassigning(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
                <IconButton icon="menu" title={t("ServerSort")} aria-label={t("ServerSort")} />
            </DialogTrigger>
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>{t("ServerSort")}</DialogTitle>
                    <DialogDescription>{t("ServerSortHint")}</DialogDescription>
                </DialogHeader>
                <ScrollArea className="max-h-[60vh] pr-3">
                    <div className="space-y-2">
                        {ordered.map((server, index) => (
                            <div
                                key={server.id}
                                draggable
                                onDragStart={(event) => {
                                    event.dataTransfer.effectAllowed = "move"
                                    event.dataTransfer.setData("text/plain", String(server.id))
                                    setDraggedID(server.id)
                                }}
                                onDragEnd={() => setDraggedID(null)}
                                onDragOver={(event) => {
                                    event.preventDefault()
                                    event.dataTransfer.dropEffect = "move"
                                }}
                                onDrop={(event) => {
                                    event.preventDefault()
                                    const rect = event.currentTarget.getBoundingClientRect()
                                    moveTo(server.id, event.clientY > rect.top + rect.height / 2)
                                }}
                                className="flex cursor-grab items-center gap-3 rounded-lg border bg-background p-3 active:cursor-grabbing"
                            >
                                <GripVertical className="h-5 w-5 shrink-0 text-muted-foreground" />
                                <span className="w-8 text-sm text-muted-foreground">
                                    {index + 1}
                                </span>
                                <span className="min-w-0 flex-1 break-words font-medium">
                                    {server.name}
                                </span>
                                <span className="text-sm text-muted-foreground">
                                    ID {server.id}
                                </span>
                            </div>
                        ))}
                    </div>
                </ScrollArea>
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                    {t("ServerIDReassignHint")}
                </div>
                <DialogFooter className="gap-2 sm:justify-between">
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button variant="destructive" disabled={saving || reassigning}>
                                <ListRestart className="mr-2 h-4 w-4" />
                                {t("ServerIDReassign")}
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>
                                    {t("ServerIDReassignConfirmTitle")}
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                    {t("ServerIDReassignConfirm")}
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
                                <AlertDialogAction
                                    onClick={assignSystemIDs}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                    {t("Confirm")}
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                    <Button onClick={saveOrder} disabled={saving || reassigning}>
                        {saving ? t("Loading") : t("Save")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
