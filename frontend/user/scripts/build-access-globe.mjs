import { fileURLToPath } from "node:url"
import { appendFile, readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { build } from "vite"

const resolve = path => fileURLToPath(new URL(path, import.meta.url))
await build({
  configFile: false,
  publicDir: false,
  build: {
    target: "es2020",
    outDir: resolve("../../../cmd/dashboard/controller/mapdata"),
    emptyOutDir: false,
    lib: { entry: resolve("../src/lib/access-globe.js"), name: "AccessGlobe", formats: ["iife"], fileName: () => "access_globe.js" },
    minify: true,
  },
})
const geo = createRequire(import.meta.url).resolve("d3-geo")
const array = createRequire(geo).resolve("d3-array")
const intern = createRequire(array).resolve("internmap")
const licenses = await Promise.all([geo, array, intern].map(entry =>
  readFile(join(dirname(entry), "../LICENSE"), "utf8")))
await appendFile(resolve("../../../cmd/dashboard/controller/mapdata/access_globe.js"),
  "\n/* Third-party licenses\n" + licenses.join("\n") + "\n*/\n")
