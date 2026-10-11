import path from "node:path"
import { defineConfig } from "vite"
export default defineConfig({
    root: path.resolve(import.meta.dirname, "src/telegram-terminal"),
    base: "/telegram-terminal/",
    publicDir: false,
    build: {
        outDir: path.resolve(import.meta.dirname, "dist/telegram-terminal"),
        emptyOutDir: true,
        sourcemap: false,
    },
})
