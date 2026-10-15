/// <reference types="node" />
import { generateCommand } from "@/components/install-commands"
import { ModelProfile, ModelSetting } from "@/types"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync, statSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const settings = { install_host: "panel.example:443", tls: true } as ModelSetting
const profile = { agent_secret: "secret with 'quotes' $() ` text" } as ModelProfile
describe("owned Agent install commands", () => {
    it.each([1, 2, 3])("uses only the owned installer for OS %s", (os) => {
        const command = generateCommand(os, settings, profile, "uuid-test")
        expect(command).toContain(
            "https://raw.githubusercontent.com/shini74744/nezha/main/agent/scripts/install.",
        )
        expect(command).not.toMatch(/nezhahq|naibahq|gitee|atomgit|jsdelivr/)
        expect(command).toContain("DDNZ_UUID")
    })
    it("quotes PowerShell values and does not change persistent execution policy", () => {
        const command = generateCommand(3, settings, profile)
        expect(command).toContain("$env:DDNZ_CLIENT_SECRET='secret with ''quotes'' $() ` text';")
        expect(command).toContain("-ExecutionPolicy Bypass")
        expect(command).not.toContain("set-ExecutionPolicy")
        expect(command).not.toMatch(/Ssl3|Tls11|C:\\\\install/)
        expect(command).not.toContain("DDNZ_UUID")
    })
    it.skipIf(process.platform === "win32").each([1, 2])(
        "round trips POSIX credentials without interpolation for OS %s",
        (os) => {
            const dir = mkdtempSync(join(tmpdir(), "owned-install-test-"))
            try {
                writeFileSync(
                    join(dir, "curl"),
                    '#!/bin/sh\nwhile [ "$#" -gt 0 ]; do if [ "$1" = "-o" ]; then cp "$MOCK_INSTALL" "$2"; exit; fi; shift; done\nexit 1\n',
                    { mode: 0o755 },
                )
                writeFileSync(
                    join(dir, "fixture"),
                    '#!/bin/sh\nprintf "%s\\n" "$DDNZ_SERVER" "$DDNZ_CLIENT_SECRET" "$DDNZ_TLS" "${DDNZ_UUID:-}"\n',
                )
                const result = execFileSync(
                    "sh",
                    ["-c", generateCommand(os, settings, profile, "uuid-test")],
                    {
                        cwd: dir,
                        env: {
                            ...process.env,
                            PATH: dir + ":" + process.env.PATH,
                            MOCK_INSTALL: join(dir, "fixture"),
                        },
                        encoding: "utf8",
                    },
                )
                expect(statSync(join(dir,"DDnezha.sh")).mode & 0o111).not.toBe(0);
                expect(readFileSync(join(dir,"DDnezha.sh"),"utf8")).toContain("#!/bin/sh");
                expect(result).toBe(
                    [settings.install_host, profile.agent_secret, "true", "uuid-test", ""].join(
                        "\n",
                    ),
                )
            } finally {
                rmSync(dir, { recursive: true, force: true })
            }
        },
    )
    it("rejects missing credentials and unsupported OS", () => {
        expect(() => generateCommand(1, {} as ModelSetting, profile)).toThrow()
        expect(() => generateCommand(1, settings, {} as ModelProfile)).toThrow()
        expect(() => generateCommand(999, settings, profile)).toThrow()
    })
})

describe("generated installation command execution boundaries", () => {
    it.skipIf(process.platform === "win32").each([1, 2])("failed download never executes a saved POSIX installer for OS %s", (os) => {
        const dir = mkdtempSync(join(tmpdir(), "owned-install-fail-"))
        try {
            writeFileSync(join(dir, "curl"), "#!/bin/sh\nexit 22\n", {mode: 0o755})
            writeFileSync(join(dir, "DDnezha.sh"), "#!/bin/sh\ntouch ran-saved-installer\n", {mode: 0o755})
            expect(() => execFileSync("sh", ["-c", generateCommand(os, settings, profile, "uuid-test")], {
                cwd: dir, env: {...process.env, PATH: dir + ":" + process.env.PATH}, stdio: "pipe",
            })).toThrow()
            expect(() => statSync(join(dir, "ran-saved-installer"))).toThrow()
        } finally { rmSync(dir, {recursive: true, force: true}) }
    })
    it.skipIf(process.platform !== "win32")("executes generated Windows command with exact credentials and only the unified URL", () => {
        const dir = mkdtempSync(join(tmpdir(), "owned-install-win-"))
        try {
            const fixture = join(dir, "fixture.ps1")
            writeFileSync(fixture, '[ordered]@{server=$env:DDNZ_SERVER;secret=$env:DDNZ_CLIENT_SECRET;uuid=$env:DDNZ_UUID;tls=$env:DDNZ_TLS} | ConvertTo-Json -Compress\n')
            const stub = 'function Invoke-WebRequest {param([Parameter(Position=0)][string]$Uri,[switch]$UseBasicParsing,[string]$OutFile); if ($Uri -cne "https://raw.githubusercontent.com/shini74744/nezha/main/agent/scripts/install.ps1") {throw "unexpected installer URL"}; Copy-Item -LiteralPath $env:MOCK_INSTALL -Destination $OutFile}; '
            const result = execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", stub + generateCommand(3, settings, profile, "uuid-test")], {
                cwd: dir, env: {...process.env, MOCK_INSTALL: fixture}, encoding: "utf8",
            })
            expect(JSON.parse(result.trim())).toEqual({server: settings.install_host, secret: profile.agent_secret, uuid: "uuid-test", tls: "true"})
        } finally { rmSync(dir, {recursive: true, force: true}) }
    })
})
