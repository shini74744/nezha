import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { publicNoteSnapshotText } from "@/lib/server-operation-details"

export function ServerOperationContent({ label, content }: { label: string; content?: string }) {
    const available = content !== undefined
    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="ml-2 h-7 shrink-0 px-2 text-xs"
                    aria-label={"查看" + label + "内容"}
                    disabled={!available}
                    title={available ? "查看该次操作保存的内容" : "旧记录未保存具体内容，无法还原"}
                >
                    查看内容
                </Button>
            </DialogTrigger>
            <DialogContent className="flex max-h-[80dvh] w-[94vw] max-w-3xl flex-col gap-3 rounded-lg p-4 sm:p-5">
                <DialogHeader className="pr-6 text-left">
                    <DialogTitle>公开配置／备注 · {label}</DialogTitle>
                    <DialogDescription className="text-xs leading-5">
                        该次操作保存的内容，仅供查看；不会执行其中的 HTML 或脚本。
                    </DialogDescription>
                </DialogHeader>
                <pre
                    tabIndex={0}
                    aria-label={label + "的公开配置或备注"}
                    className="min-h-0 min-w-0 overflow-y-auto overscroll-contain whitespace-pre-wrap break-all rounded-md border bg-muted/30 p-3 font-mono text-xs leading-5"
                >
                    {publicNoteSnapshotText(content ?? "")}
                </pre>
            </DialogContent>
        </Dialog>
    )
}
