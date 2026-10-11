import path from "node:path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
export default defineConfig({
    root: path.resolve(import.meta.dirname, "src/telegram-terminal"),
    base: "/telegram-terminal/",
    plugins: [react()],
    resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
    publicDir: false,
    css: { postcss: path.resolve(import.meta.dirname) },
    build: {
        outDir: path.resolve(import.meta.dirname, "dist/telegram-terminal"),
        emptyOutDir: true,
        sourcemap: false,
        chunkSizeWarningLimit: 1500,
    },
})
