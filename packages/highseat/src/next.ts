import { createElement, type ReactElement } from "react"
import { findNextSite, findProxyPath, isProduction } from "./env"
import type { InjectOptions } from "./index"
import { Highseat as ReactHighseat } from "./react"

export { createProxy } from "./proxy"
export type { ClientIp, ClientIpPreset, ProxyHandler, ProxyOptions } from "./proxy"

export interface HighseatProps extends Partial<InjectOptions> {}

/**
 * Loads the Highseat tracker in a Next.js app. Render it once, in the root layout. The site id
 * comes from `NEXT_PUBLIC_HIGHSEAT_SITE`, and the script loads from the site's proxy path in
 * `HIGHSEAT_PATH` when one is set. `HIGHSEAT_PATH` is a server variable, so in the Pages Router,
 * where the layout also renders in the browser, pass `src` instead. A prop wins over its variable.
 */
export function Highseat(props: HighseatProps): ReactElement | null {
  const site = props.site ?? findNextSite()
  const src = props.src ?? findProxyPath()

  if (!site) {
    console.warn("highseat: set NEXT_PUBLIC_HIGHSEAT_SITE, or pass `site` to <Highseat />")
    return null
  }

  return createElement(ReactHighseat, { ...props, site, src })
}

/** A Next.js rewrite: the subset of its fields this package writes and reads. */
interface Rewrite {
  source: string
  destination: string
}

/** The phases Next.js applies rewrites in, when `rewrites()` returns an object. */
interface RewritePhases {
  beforeFiles?: Rewrite[]
  afterFiles?: Rewrite[]
  fallback?: Rewrite[]
}

/** The part of a Next.js config `withHighseat` reads. */
interface NextConfigWithRewrites {
  rewrites?: () => Promise<Rewrite[] | RewritePhases>
}

/** A Next.js config with the proxy's rewrite added, or its own rewrites when there is no path. */
export type WithHighseatConfig<Config> = Config & {
  rewrites: () => Promise<Rewrite[] | RewritePhases>
}

export interface WithHighseatOptions {
  /**
   * The site's proxy path from Installation settings. Defaults to the `HIGHSEAT_PATH`
   * environment variable, the one `createProxy()` reads, so rotating the path is an
   * environment change and a redeploy.
   */
  path?: string
  /**
   * Where the app's proxy route handler lives. Defaults to `/api/highseat`, the route of
   * `app/api/highseat/route.ts`.
   */
  route?: string
}

const DEFAULT_ROUTE = "/api/highseat"

const NO_PATH_MESSAGE =
  "highseat/next: no proxy path. Set HIGHSEAT_PATH to the path from the site's Installation settings, or pass `path`."

// A dev session can ask for the rewrites more than once, so the warning is printed once.
let hasWarnedNoPath = false

/**
 * Adds a rewrite from the site's proxy path to the app's proxy route handler, ahead of every
 * other route. The rewrite stays inside the app, so the handler still sees the visitor's IP, and
 * the route file never moves when the path rotates.
 *
 * Without a proxy path, `next build` fails, while `next dev` warns once and runs without the
 * rewrite.
 *
 * ```ts
 * // next.config.ts
 * import { withHighseat } from "highseat/next"
 * export default withHighseat({ reactStrictMode: true })
 * ```
 */
export function withHighseat<Config extends object>(
  config: Config,
  options: WithHighseatOptions = {},
): WithHighseatConfig<Config> {
  const path = findProxyPath(options.path)

  // Typed loosely so any Next.js version's config fits; only `rewrites` is read.
  const { rewrites: ownRewrites } = config as NextConfigWithRewrites

  // Next.js hands the build phase only to a config written as a function, so a missing path is
  // judged where the rewrites are read: `next build` reads them in production mode, `next dev`
  // in development, and `next start` serves the ones the build wrote without asking again.
  async function passRewritesThrough(): Promise<Rewrite[] | RewritePhases> {
    if (isProduction()) throw new Error(NO_PATH_MESSAGE)

    if (!hasWarnedNoPath) {
      hasWarnedNoPath = true
      console.warn(`${NO_PATH_MESSAGE} The proxy is off until then.`)
    }
    return (await ownRewrites?.()) ?? []
  }

  if (!path) return { ...config, rewrites: passRewritesThrough }

  const rewrite = { source: path, destination: options.route ?? DEFAULT_ROUTE }

  async function rewrites(): Promise<RewritePhases> {
    const existing = (await ownRewrites?.()) ?? []

    // A plain array is Next.js shorthand for the `afterFiles` phase.
    if (Array.isArray(existing)) return { beforeFiles: [rewrite], afterFiles: existing }
    return { ...existing, beforeFiles: [rewrite, ...(existing.beforeFiles ?? [])] }
  }

  return { ...config, rewrites }
}
