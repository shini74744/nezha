import "./settings-editor.css"
import { Button } from "./ui/button"

export default function SettingsSaveBar({
    label,
    busy,
    reading = false,
    ready,
    dirty,
    validation,
    onSave,
    onUndo,
    onReload,
}: {
    label: string
    busy: boolean
    reading?: boolean
    ready: boolean
    dirty: boolean
    validation?: string
    onSave: () => void
    onUndo: () => void
    onReload: () => void
}) {
    return (
        <div
            data-settings-save-bar
            className="sticky bottom-0 z-20 border-t bg-background/95 py-3 backdrop-blur"
        >
            <div className="flex flex-wrap items-center gap-2">
                <Button
                    disabled={!ready || busy || reading || !dirty || !!validation}
                    onClick={onSave}
                >
                    {busy ? "保存中…" : label}
                </Button>
                <Button variant="outline" disabled={!dirty || busy || reading} onClick={onUndo}>
                    撤销本次修改
                </Button>
                <Button variant="ghost" disabled={busy || reading} onClick={onReload}>
                    重新读取
                </Button>
                <span role="status" className="text-xs text-muted-foreground">
                    {reading
                        ? "正在读取…"
                        : busy
                          ? "正在保存…"
                          : dirty
                            ? "有未保存的修改"
                            : ready
                              ? "已保存"
                              : ""}
                </span>
            </div>
            {validation && (
                <p role="alert" className="mt-2 text-sm text-destructive">
                    {validation}
                </p>
            )}
        </div>
    )
}
