import { Button, ButtonProps } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuPortal,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useAuth } from "@/hooks/useAuth"
import useSettings from "@/hooks/useSetting"
import { copyToClipboard } from "@/lib/utils"
import { ModelProfile, ModelSetting } from "@/types"
import i18next from "i18next"
import { Check, Clipboard, Copy, Download } from "lucide-react"
import { forwardRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

enum OSTypes {
    Linux = 1,
    macOS,
    Windows,
}

type InstallCommandsMenuProps = ButtonProps & {
    uuid?: string
    iconOnly?: boolean
    menuItem?: boolean
    uuidActions?: boolean
}

export const InstallCommandsMenu = forwardRef<HTMLButtonElement, InstallCommandsMenuProps>(
    ({ uuid, iconOnly = false, menuItem = false, uuidActions = false, ...props }, ref) => {
        const [copy, setCopy] = useState(false)
        const { data: settings } = useSettings()
        const { profile } = useAuth()

        const { t } = useTranslation()

        const switchState = async (type: number) => {
            if (!copy) {
                try {
                    setCopy(true)
                    if (!profile) throw new Error("Profile is not found.")
                    if (!settings?.config) throw new Error("Settings is not found.")
                    await copyToClipboard(
                        generateCommand(type, settings!.config, profile, uuid) || "",
                    )
                    if (uuidActions) toast.success(t("UUIDInstallCommandCopied"))
                } catch (e: Error | any) {
                    console.error(e)
                    toast(t("Error"), {
                        description: e.message,
                    })
                } finally {
                    setTimeout(() => {
                        setCopy(false)
                    }, 2 * 1000)
                }
            }
        }

        const copyUUID = async () => {
            if (!uuid) return
            try {
                await copyToClipboard(uuid)
                toast.success(t("UUIDCopied"))
            } catch (e) {
                toast.error(t("Error"), { description: e instanceof Error ? e.message : String(e) })
            }
        }
        const osItems = [OSTypes.Linux, OSTypes.macOS, OSTypes.Windows].map((type) => (
            <DropdownMenuItem
                key={type}
                className="nezha-copy"
                disabled={
                    uuidActions &&
                    (!uuid || !profile?.agent_secret || !settings?.config?.install_host)
                }
                onSelect={() => {
                    void switchState(type)
                }}
            >
                {OSTypes[type]}
            </DropdownMenuItem>
        ))

        return (
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    {uuidActions ? (
                        <Button
                            ref={ref}
                            type="button"
                            size="icon"
                            variant="outline"
                            className="rounded-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]"
                            title={t("UUIDActions")}
                            aria-label={t("UUIDActions")}
                            disabled={!uuid}
                            {...props}
                        >
                            <Clipboard className="h-4 w-4" />
                        </Button>
                    ) : menuItem ? (
                        <button
                            type="button"
                            className="flex w-full items-center text-sm px-2 py-2 hover:bg-accent hover:text-accent-foreground"
                            title={i18next.t("InstallCommands")}
                        >
                            {copy ? (
                                <Check className="h-4 w-4 mr-2" />
                            ) : (
                                <Copy className="h-4 w-4 mr-2" />
                            )}
                            <span>{i18next.t("InstallCommands")}</span>
                        </button>
                    ) : iconOnly ? (
                        <Button
                            ref={ref}
                            title={i18next.t("InstallCommands")}
                            size="icon"
                            {...props}
                        >
                            {copy ? (
                                <Check className="h-4 w-4" />
                            ) : (
                                <Download className="h-4 w-4" />
                            )}
                        </Button>
                    ) : (
                        <Button ref={ref} title={i18next.t("InstallCommands")} {...props}>
                            {copy ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                            <span className="ml-2">{i18next.t("InstallCommands")}</span>
                        </Button>
                    )}
                </DropdownMenuTrigger>
                <DropdownMenuContent
                    side={menuItem ? "right" : undefined}
                    align={menuItem || uuidActions ? "start" : undefined}
                    sideOffset={4}
                    className={uuidActions ? "w-64 max-w-[calc(100vw-16px)]" : undefined}
                >
                    {uuidActions ? (
                        <>
                            <DropdownMenuItem
                                className="nezha-copy"
                                onSelect={() => {
                                    void copyUUID()
                                }}
                            >
                                <Clipboard className="h-4 w-4" />
                                {t("CopyUUID")}
                            </DropdownMenuItem>
                            <DropdownMenuSub>
                                <DropdownMenuSubTrigger>
                                    <Download className="h-4 w-4" />
                                    {t("CopyUUIDInstallCommand")}
                                </DropdownMenuSubTrigger>
                                <DropdownMenuPortal>
                                    <DropdownMenuSubContent sideOffset={4}>
                                        {osItems}
                                    </DropdownMenuSubContent>
                                </DropdownMenuPortal>
                            </DropdownMenuSub>
                        </>
                    ) : (
                        osItems
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
        )
    },
)

export const generateCommand = (
    type: number,
    { install_host, tls }: ModelSetting,
    { agent_secret }: ModelProfile,
    uuid?: string,
) => {
    if (!install_host) throw new Error(i18next.t("Results.InstallHostRequired"))

    if (!agent_secret) throw new Error(i18next.t("Results.AgentSecretRequired"))

    const scriptBase = "https://raw.githubusercontent.com/shini74744/agent/main/scripts"
    const values: Record<string, string> = {
        NZ_SERVER: install_host,
        NZ_TLS: String(tls || false),
        NZ_CLIENT_SECRET: agent_secret,
    }
    if (uuid) values.NZ_UUID = uuid
    const shellQuote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'"
    const psQuote = (value: string) => "'" + value.replace(/'/g, "''") + "'"
    const env = Object.entries(values)
        .map(([key, value]) => `${key}=${shellQuote(value)}`)
        .join(" ")
    const envWin = Object.entries(values)
        .map(([key, value]) => `$env:${key}=${psQuote(value)};`)
        .join("")

    switch (type) {
        case OSTypes.Linux:
        case OSTypes.macOS:
            return `curl --fail --location --retry 3 ${scriptBase}/install.sh -o agent.sh && chmod +x agent.sh && env ${env} ./agent.sh`
        case OSTypes.Windows:
            return `${envWin}$ErrorActionPreference=\'Stop\';[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;$nzInstaller=Join-Path $env:TEMP (\'nezha-install-\'+[guid]::NewGuid().ToString(\'N\')+\'.ps1\');try {Invoke-WebRequest -UseBasicParsing ${scriptBase}/install.ps1 -OutFile $nzInstaller;powershell.exe -NoProfile -ExecutionPolicy Bypass -File $nzInstaller;if ($LASTEXITCODE -ne 0) {throw \'Agent installation failed\'}} finally {if (Test-Path -LiteralPath $nzInstaller) {Remove-Item -LiteralPath $nzInstaller -Force}}`
        default:
            throw new Error(`Unknown OS: ${type}`)
    }
}
