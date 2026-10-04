export interface SavedTerminalCommand {
    id: number
    name: string
    command: string
    version: number
}

export const terminalCommandsURL = "/api/v1/terminal-commands"

// A literal newline/escape/tab can execute or alter shell input while pasting.
export function terminalCommandError(command: string): string {
    if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(command)) {
        return "请输入单行命令，不支持换行或控制字符"
    }
    if (!command.trim() || new TextEncoder().encode(command).length > 8192) {
        return "命令不能为空，且不能超过 8192 字节"
    }
    return ""
}
