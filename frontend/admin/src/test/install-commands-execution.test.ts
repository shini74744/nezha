/// <reference types="node" />
import { generateCommand } from "@/components/install-commands"
import { ModelProfile, ModelSetting } from "@/types"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const cases = [
    { server: "panel.example:443", secret: "fixture-only-key", tls: true, uuid: "fixture-node" },
    { server: "[2001:db8::1]:443", secret: "quotes ' \" ; $(touch injected) " + String.fromCharCode(96) + "echo injected" + String.fromCharCode(96) + " & | \n测试", tls: true, uuid: "node ' ; $(touch injected)" },
    { server: "panel.example:80", secret: "fixture-only-key", tls: false },
]
const commandFor = (os: number, value: typeof cases[number]) =>
    generateCommand(os, { install_host: value.server, tls: value.tls } as ModelSetting,
        { agent_secret: value.secret } as ModelProfile, value.uuid)

describe.skipIf(process.platform === "win32")("POSIX short command execution matrix", () => {
    for (const shell of ["sh", "bash"]) for (const os of [1, 2]) {
        it.each(cases)(shell + " OS " + os + " preserves parameters and supports repeat execution: $server", (value) => {
            const dir = mkdtempSync(join(tmpdir(), "DDnezha command test "))
            try {
                writeFileSync(join(dir, "curl"), '#!/bin/sh\nwhile [ "$#" -gt 0 ]; do if [ "$1" = "-o" ]; then cp "$MOCK_INSTALL" "$2"; exit; fi; shift; done\nexit 1\n', { mode: 0o755 })
                writeFileSync(join(dir, "fixture"), '#!/bin/sh\nprintf "%s\\000" "$DDNZ_SERVER" "$DDNZ_CLIENT_SECRET" "$DDNZ_TLS" "$DDNZ_UUID"\n')
                writeFileSync(join(dir, "agent.sh"), "preserve official installer")
                writeFileSync(join(dir, "DDnezha.sh"), "preserve previous management script")
                const env: NodeJS.ProcessEnv = { ...process.env, PATH: dir + ":" + process.env.PATH, MOCK_INSTALL: join(dir, "fixture") }
                delete env.DDNZ_UUID
                for (let repeat = 0; repeat < 2; repeat++) {
                    const result = spawnSync(shell, ["-c", commandFor(os, value)], { cwd: dir, env, encoding: "utf8" })
                    expect(result.status, result.stderr).toBe(0)
                    expect(result.stdout.split("\0")).toEqual([value.server, value.secret, String(value.tls), value.uuid || "", ""])
                    expect(readFileSync(join(dir, "agent.sh"), "utf8")).toBe("preserve official installer")
                    expect(readFileSync(join(dir, "DDnezha.sh"), "utf8")).toBe("preserve previous management script")
                    expect(readdirSync(dir).sort()).toEqual(["DDnezha-install.sh", "DDnezha.sh", "agent.sh", "curl", "fixture"])
                }
            } finally { rmSync(dir, { recursive: true, force: true }) }
        })
        it.each(["download", "partial", "installer"])(shell + " OS " + os + " returns failures: %s", (failure) => {
            const dir = mkdtempSync(join(tmpdir(), "DDnezha fail test "))
            try {
                const sentinel = '#!/bin/sh\ntouch should-not-run\n'
                writeFileSync(join(dir, "DDnezha-install.sh"), sentinel)
                writeFileSync(join(dir, "curl"),
                    failure === "download" ? "#!/bin/sh\nexit 22\n" :
                    failure === "partial" ? "#!/bin/sh\nprintf 'touch should-not-run\\n' > DDnezha-install.sh\nexit 18\n" :
                    "#!/bin/sh\nprintf '#!/bin/sh\\nexit 37\\n' > DDnezha-install.sh\n",
                    { mode: 0o755 })
                const result = spawnSync(shell, ["-c", commandFor(os, cases[0])], { cwd: dir, env: { ...process.env, PATH: dir + ":" + process.env.PATH }, encoding: "utf8" })
                expect(result.status).toBe(failure === "download" ? 22 : failure === "partial" ? 18 : 37)
                expect(readdirSync(dir).sort()).toEqual(["DDnezha-install.sh", "curl"])
            } finally { rmSync(dir, { recursive: true, force: true }) }
        })
    }
})

it.skipIf(!process.env.DDNZ_WINDOWS_COMMAND_FIXTURES)("exports exact generated commands for isolated native Windows tests", () => {
    writeFileSync(process.env.DDNZ_WINDOWS_COMMAND_FIXTURES!,
        JSON.stringify(cases.map(value => ({ ...value, command: commandFor(3, value) })), null, 2))
})
