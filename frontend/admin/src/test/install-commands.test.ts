/// <reference types="node" />
import { generateCommand } from "@/components/install-commands"
import { ModelProfile, ModelSetting } from "@/types"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const settings = { install_host: "panel.example:443", tls: true } as ModelSetting
const profile = { agent_secret: "secret with 'quotes' $() ` text" } as ModelProfile
describe("owned Agent install commands", () => {
    it.each([1, 2, 3])("uses only the owned installer for OS %s", (os) => {
        const command = generateCommand(os, settings, profile, "uuid-test")
        expect(command).toContain(
            "https://raw.githubusercontent.com/shini74744/agent/main/scripts/install.",
        )
        expect(command).not.toMatch(/nezhahq|naibahq|gitee|atomgit|jsdelivr/)
        expect(command).toContain("NZ_UUID")
    })
    it("quotes PowerShell values and does not change persistent execution policy", () => {
        const command = generateCommand(3, settings, profile)
        expect(command).toContain("$env:NZ_CLIENT_SECRET='secret with ''quotes'' $() ` text';")
        expect(command).toContain("-ExecutionPolicy Bypass")
        expect(command).not.toContain("set-ExecutionPolicy")
        expect(command).not.toMatch(/Ssl3|Tls11|C:\\\\install/)
        expect(command).not.toContain("NZ_UUID")
    })
    it.skipIf(process.platform === "win32")(
        "round trips POSIX credentials without interpolation",
        () => {
            const dir = mkdtempSync(join(tmpdir(), "owned-install-test-"))
            try {
                writeFileSync(
                    join(dir, "curl"),
                    '#!/bin/sh\nwhile [ "$#" -gt 0 ]; do if [ "$1" = "-o" ]; then cp "$MOCK_INSTALL" "$2"; exit; fi; shift; done\nexit 1\n',
                    { mode: 0o755 },
                )
                writeFileSync(
                    join(dir, "fixture"),
                    'printf "%s\\n" "$NZ_SERVER" "$NZ_CLIENT_SECRET" "$NZ_TLS" "${NZ_UUID:-}"\n',
                )
                const result = execFileSync(
                    "sh",
                    ["-c", generateCommand(1, settings, profile, "uuid-test")],
                    {
                        env: {
                            ...process.env,
                            PATH: dir + ":" + process.env.PATH,
                            MOCK_INSTALL: join(dir, "fixture"),
                        },
                        encoding: "utf8",
                    },
                )
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
