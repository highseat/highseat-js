/**
 * The variables the package reads from a customer's environment. Each is named in full, never
 * looked up by a computed key: Next.js inlines a `NEXT_PUBLIC_` variable into browser code only
 * where the source spells out `process.env.NEXT_PUBLIC_…`. The server variables return
 * `undefined` where the runtime has no `process`: a Cloudflare Worker without `nodejs_compat`,
 * whose options carry the values instead.
 */

/** The site id for `<Highseat />` in Next.js. Public, so it reaches the browser. */
export function findNextSite(): string | undefined {
  return process.env.NEXT_PUBLIC_HIGHSEAT_SITE
}

/**
 * The site's proxy path: `option` when given, else `HIGHSEAT_PATH`, a server variable shared by
 * `<Highseat />`, `withHighseat()` and the proxy handler. A value written without its leading
 * slash gets one, as Installation settings shows it (`/3f9a0c1e2b`). An empty value counts as
 * unset.
 */
export function findProxyPath(option?: string): string | undefined {
  const path = option ?? (typeof process === "undefined" ? undefined : process.env.HIGHSEAT_PATH)
  if (!path) return
  return path.startsWith("/") ? path : `/${path}`
}

/** The site secret for the proxy handler. */
export function findSecret(): string | undefined {
  if (typeof process === "undefined") return
  return process.env.HIGHSEAT_SECRET
}

/**
 * Whether this runs inside `next build`, which loads every route without serving one. Set in the
 * build's route workers only: `next.config.ts` receives the phase as an argument instead.
 */
export function isNextBuild(): boolean {
  if (typeof process === "undefined") return false
  return process.env.NEXT_PHASE === "phase-production-build"
}

/** Whether Node runs in production mode, as `next build` and `next start` do. */
export function isProduction(): boolean {
  if (typeof process === "undefined") return false
  return process.env.NODE_ENV === "production"
}
