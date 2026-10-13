import { defineConfig } from "tsdown"
import type { UserConfig } from "tsdown"

const config: UserConfig = defineConfig({
  entry: ["src/index.ts", "src/react.ts", "src/next.ts", "src/proxy.ts"],
  format: "esm",
  platform: "neutral",
  dts: true,
  hash: false,
  sourcemap: true,
  outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
  // Rolldown warns that a module's "use client" may be lost in bundling. Each entry is its own
  // file, so it is kept, and `check-exports` fails the build of a client entry that lost it.
  checks: { moduleLevelDirective: false },
})

export default config
