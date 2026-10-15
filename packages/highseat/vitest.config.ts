import { cloudflareTest } from "@cloudflare/vitest-plugin"
import { defineConfig } from "vitest/config"
import type { ViteUserConfig } from "vitest/config"

// One suite, two runtimes: `node` runs it on Node, `workerd` inside the Workers runtime through
// Miniflare. Bun runs the same files with `bun test`, which reads the `vitest` imports natively.
const config: ViteUserConfig = defineConfig({
  test: {
    projects: [
      { test: { name: "node", include: ["src/**/*.test.ts"] } },
      {
        plugins: [cloudflareTest({ miniflare: { compatibilityDate: "2026-10-01" } })],
        test: {
          name: "workerd",
          include: ["src/**/*.test.ts"],
          // The React tests render into happy-dom, which needs `node:vm`. A Worker never runs a
          // component's effects, and `identity.test.ts` covers the logic they call.
          exclude: ["src/react.test.ts"],
          // workerd cannot read Vitest's module cache, which sits in the root node_modules.
          fsModuleCache: false,
        },
      },
    ],
  },
})

export default config
