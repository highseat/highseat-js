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
})

export default config
