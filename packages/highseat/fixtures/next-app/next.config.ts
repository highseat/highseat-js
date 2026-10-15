import { withHighseat } from "highseat/next"

export default withHighseat({
  cacheComponents: true,
  // The fixture sits inside the package, so Next.js would otherwise take the package's own
  // `src/proxy.ts` for the app's request proxy.
  turbopack: { root: import.meta.dirname },
  outputFileTracingRoot: import.meta.dirname,
})
