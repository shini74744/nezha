import { FetcherMethod, fetcher } from "@/api/api"
import {
    AgentCredentialHistory,
    type AgentCredentialPair,
} from "@/components/agent-credential-history"
import { ServerReplacementCommand } from "@/components/server-replacement-command"
import { Button, ButtonProps } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuPortal,
    DropdownMenuSeparator,
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
import { Check, Clipboard, Copy, Download, History, RefreshCw } from "lucide-react"
import { forwardRef, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

enum OSTypes {
    Linux = 1,
    macOS,
    Windows,
}

type InstallCommandsMenuProps = ButtonProps & {
    uuid?: string
    serverName?: string
    iconOnly?: boolean
    menuItem?: boolean
    uuidActions?: boolean
}

export const InstallCommandsMenu = forwardRef<HTMLButtonElement, InstallCommandsMenuProps>(
    (
        { uuid, serverName, iconOnly = false, menuItem = false, uuidActions = false, ...props },
        ref,
    ) => {
        const [copy, setCopy] = useState(false)
        const [menuOpen, setMenuOpen] = useState(false)
        const menuOpenRef = useRef(false)
        const changeMenuOpen = (next: boolean) => {
            menuOpenRef.current = next
            setMenuOpen(next)
        }
        const triggerRef = useRef<HTMLButtonElement>(null)
        const [replacementOpen, setReplacementOpen] = useState(false)
        const [historyOpen, setHistoryOpen] = useState(false)
        const copying = useRef(false)
        const { data: settings } = useSettings()
        const { profile } = useAuth()

        const { t } = useTranslation()

        const switchState = async (type: number) => {
            changeMenuOpen(false)
            if (!copying.current) {
                copying.current = true
                try {
                    setCopy(true)
                    if (!profile) throw new Error("Profile is not found.")
                    if (!settings?.config) throw new Error("Settings is not found.")
                    const pair = await fetcher<AgentCredentialPair>(
                        FetcherMethod.POST,
                        "/api/v1/agent-credentials/issue",
                        uuid ? { uuid } : {},
                    )
                    await copyToClipboard(
                        generateCommand(
                            type,
                            settings.config,
                            { ...profile, agent_secret: pair.client_secret },
                            pair.uuid,
                        ),
                    )
                    toast.success("安装命令已复制")
                } catch (e: Error | any) {
                    toast(t("Error"), {
                        description: e.message,
                    })
                } finally {
                    copying.current = false
                    setCopy(false)
                }
            }
        }

        const copyUUID = async () => {
            changeMenuOpen(false)
            if (!uuid || copying.current) return
            copying.current = true
            try {
                const pair = await fetcher<AgentCredentialPair>(
                    FetcherMethod.POST,
                    "/api/v1/agent-credentials/issue",
                    { uuid },
                )
                await copyToClipboard(
                    JSON.stringify({ uuid: pair.uuid, client_secret: pair.client_secret }, null, 2),
                )
                toast.success("认证信息已复制")
            } catch (e) {
                toast.error(t("Error"), { description: e instanceof Error ? e.message : String(e) })
            } finally {
                copying.current = false
            }
        }
        const osItems = [OSTypes.Linux, OSTypes.macOS, OSTypes.Windows].map((type) => (
            <DropdownMenuItem
                key={type}
                className="nezha-copy"
                disabled={
                    copy || !profile || !settings?.config?.install_host || (uuidActions && !uuid)
                }
                onSelect={() => {
                    void switchState(type)
                }}
            >
                {OSTypes[type]}
            </DropdownMenuItem>
        ))

        return (
            <>
                <DropdownMenu open={menuOpen} onOpenChange={changeMenuOpen}>
                    <DropdownMenuTrigger asChild ref={triggerRef}>
                        {uuidActions ? (
                            <Button
                                ref={ref}
                                type="button"
                                size="icon"
                                variant="outline"
                                className="rounded-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]"
                                title="认证信息"
                                aria-label="认证信息"
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
                                {copy ? (
                                    <Check className="h-4 w-4" />
                                ) : (
                                    <Copy className="h-4 w-4" />
                                )}
                                <span className="ml-2">{i18next.t("InstallCommands")}</span>
                            </Button>
                        )}
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        onInteractOutside={(event) => {
                            // The trigger owns its toggle. A delayed outside-pointer
                            // event from the closing menu must not dismiss a reopen.
                            if (triggerRef.current?.contains(event.target as Node))
                                event.preventDefault()
                        }}
                        onCloseAutoFocus={(event) => {
                            if (menuOpenRef.current || historyOpen || replacementOpen)
                                event.preventDefault()
                        }}
                        side={menuItem ? "right" : undefined}
                        align={menuItem || uuidActions ? "start" : undefined}
                        sideOffset={4}
                        className={
                            "data-[state=closed]:animate-none " +
                            (uuidActions ? "w-64 max-w-[calc(100vw-16px)]" : "")
                        }
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
                                    复制认证信息
                                </DropdownMenuItem>
                                <DropdownMenuSub>
                                    <DropdownMenuSubTrigger>
                                        <Download className="h-4 w-4" />
                                        复制安装命令
                                    </DropdownMenuSubTrigger>
                                    <DropdownMenuPortal>
                                        <DropdownMenuSubContent sideOffset={4}>
                                            {osItems}
                                        </DropdownMenuSubContent>
                                    </DropdownMenuPortal>
                                </DropdownMenuSub>
                                {profile?.role === 0 && (
                                    <DropdownMenuItem
                                        disabled={!uuid || !settings?.config?.install_host}
                                        onSelect={() => setReplacementOpen(true)}
                                    >
                                        <RefreshCw className="size-4" />
                                        清理数据换机安装命令
                                    </DropdownMenuItem>
                                )}
                            </>
                        ) : (
                            <>
                                {osItems}
                                {!uuid && (
                                    <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem onSelect={() => setHistoryOpen(true)}>
                                            <History className="size-4" />
                                            生成认证历史
                                        </DropdownMenuItem>
                                    </>
                                )}
                            </>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
                {!uuid && profile && settings?.config && (
                    <AgentCredentialHistory
                        open={historyOpen}
                        onOpenChange={setHistoryOpen}
                        copyCommand={async (type, pair) => {
                            await copyToClipboard(
                                generateCommand(
                                    type,
                                    settings.config,
                                    { ...profile, agent_secret: pair.client_secret },
                                    pair.uuid,
                                ),
                            )
                        }}
                    />
                )}
                {uuid && profile && settings?.config && (
                    <ServerReplacementCommand
                        uuid={uuid}
                        name={serverName}
                        open={replacementOpen}
                        onOpenChange={setReplacementOpen}
                        generate={(type, secret) =>
                            generateCommand(
                                type,
                                settings.config,
                                { ...profile, agent_secret: secret },
                                uuid,
                            )
                        }
                    />
                )}
            </>
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

    const scriptBase = "https://raw.githubusercontent.com/shini74744/nezha/main/agent/scripts"
    const values: Record<string, string> = {
        DDNZ_SERVER: install_host,
        DDNZ_TLS: String(tls || false),
        DDNZ_CLIENT_SECRET: agent_secret,
    }
    if (uuid) values.DDNZ_UUID = uuid
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
            // Use our own download filename; never overwrite an existing agent.sh.
            // Execute only after a successful download, with credentials quoted as data.
            return `curl -fL ${scriptBase}/install.sh -o DDnezha-install.sh && env ${env} sh DDnezha-install.sh`
        case OSTypes.Windows:
            return `${envWin}$ErrorActionPreference='Stop';[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;Invoke-WebRequest -UseBasicParsing ${scriptBase}/install.ps1 -OutFile DDnezha-install.ps1;powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./DDnezha-install.ps1;if ($LASTEXITCODE -ne 0) {throw 'Agent installation failed'}`
        default:
            throw new Error(`Unknown OS: ${type}`)
    }
}