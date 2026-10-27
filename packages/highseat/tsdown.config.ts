import { defineConfig } from "tsdown"
import type { UserConfig } from "tsdown"

const config: UserConfig = defineConfig({
  entry: ["src/index.ts", "src/react.ts", "src/next.ts", "src/proxy.ts", "src/server.ts"],
  format: "esm",
  platform: "neutral",
  dts: true,
  // One built file per source module. A shared chunk would move the React component out of
  // `react.js`, the file that carries "use client", and `next.js` would import it from there
  // without a client boundary, so a server layout would render its hooks on the server.
  unbundle: true,
  hash: false,
  sourcemap: true,
  outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
  // Rolldown warns that a module's "use client" may be lost in bundling. Each module is its own
  // file, so it is kept, and `check-exports` fails the build of a client module that lost it.
  checks: { moduleLevelDirective: false },
})

export default config
