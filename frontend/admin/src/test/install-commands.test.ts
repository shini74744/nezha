/// <reference types="node" />
import { generateCommand } from "@/components/install-commands"
import { ModelProfile, ModelSetting } from "@/types"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync, statSync, readFileSync, readdirSync } from "node:fs"
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
    it.each([1, 2])("uses the short download-and-run form for OS %s", (os) => {
        const command = generateCommand(os, settings, profile, "uuid-test")
        expect(command).toBe(
            "curl -fL https://raw.githubusercontent.com/shini74744/nezha/main/agent/scripts/install.sh -o DDnezha-install.sh && env " +
            "DDNZ_SERVER='panel.example:443' DDNZ_TLS='true' DDNZ_CLIENT_SECRET='secret with '\\''quotes'\\'' $() ` text' DDNZ_UUID='uuid-test' sh DDnezha-install.sh",
        )
        expect(command).not.toMatch(/mktemp|ddnz_tmp|umask|trap|chmod|rm -f|curl.*\|/)
    })
    it.each([1, 2])("keeps automatic UUID generation and disabled TLS when unspecified for OS %s", (os) => {
        const command = generateCommand(os, {install_host: "panel.example:80"} as ModelSetting, profile)
        expect(command).toContain("DDNZ_TLS='false'")
        expect(command).not.toContain("DDNZ_UUID")
    })
    it("quotes PowerShell values and does not change persistent execution policy", () => {
        const command = generateCommand(3, settings, profile)
        expect(command).toContain("$env:DDNZ_CLIENT_SECRET='secret with ''quotes'' $() ` text';")
        expect(command).toContain("-ExecutionPolicy Bypass")
        expect(command).toContain("-OutFile DDnezha-install.ps1;powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./DDnezha-install.ps1")
        expect(command).toContain("$ErrorActionPreference='Stop'")
        expect(command).toContain("if ($LASTEXITCODE -ne 0) {throw 'Agent installation failed'}")
        expect(command).not.toMatch(/NewGuid|Join-Path|finally|Remove-Item/)
        expect(command).not.toContain("set-ExecutionPolicy")
        expect(command).not.toMatch(/Ssl3|Tls11|C:\\\\install/)
        expect(command).not.toContain("DDNZ_UUID")
    })
    it.skipIf(process.platform === "win32").each([1, 2])(
        "round trips POSIX credentials without interpolation for OS %s",
        (os) => {
            const dir = mkdtempSync(join(tmpdir(), "owned-install-test-"))
            try {
                writeFileSync(join(dir, "agent.sh"), "official installer - must not change")
                writeFileSync(join(dir, "DDnezha.sh"), "previous installer - must not change")
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
                            TMPDIR: dir,
                        },
                        encoding: "utf8",
                    },
                )
                expect(readFileSync(join(dir, "agent.sh"), "utf8")).toBe("official installer - must not change")
                expect(readFileSync(join(dir, "DDnezha.sh"), "utf8")).toBe("previous installer - must not change")
                expect(readFileSync(join(dir, "DDnezha-install.sh"), "utf8")).toBe(readFileSync(join(dir, "fixture"), "utf8"))
                expect(readdirSync(dir).sort()).toEqual(["DDnezha-install.sh", "DDnezha.sh", "agent.sh", "curl", "fixture"])
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
            writeFileSync(join(dir, "agent.sh"), "#!/bin/sh\ntouch ran-saved-installer\n", {mode: 0o755})
            writeFileSync(join(dir, "DDnezha-install.sh"), "#!/bin/sh\ntouch ran-saved-installer\n", {mode: 0o755})
            expect(() => execFileSync("sh", ["-c", generateCommand(os, settings, profile, "uuid-test")], {
                cwd: dir, env: {...process.env, PATH: dir + ":" + process.env.PATH, TMPDIR: dir}, stdio: "pipe",
            })).toThrow()
            expect(() => statSync(join(dir, "ran-saved-installer"))).toThrow()
            expect(readFileSync(join(dir, "agent.sh"), "utf8")).toBe("#!/bin/sh\ntouch ran-saved-installer\n")
            expect(readdirSync(dir).sort()).toEqual(["DDnezha-install.sh", "agent.sh", "curl"])
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
