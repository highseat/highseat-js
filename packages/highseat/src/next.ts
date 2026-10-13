import { createElement, type ReactElement } from "react"
import { findNextSite, findProxyPath } from "./env"
import type { InjectOptions } from "./index"
import { Highseat as ReactHighseat } from "./react"

export { createProxy } from "./proxy"
export type { ProxyHandler, ProxyOptions } from "./proxy"

export interface HighseatProps extends Partial<InjectOptions> {}

/** A proxy path as Installation settings shows it, `/3f9a0c1e2b`, with or without the slash. */
function formatProxySrc(path: string) {
  return path.startsWith("/") ? path : `/${path}`
}

/**
 * Loads the Highseat tracker in a Next.js app. Render it once, in the root layout. The site id
 * comes from `NEXT_PUBLIC_HIGHSEAT_SITE`, and the script loads from the site's proxy path in
 * `HIGHSEAT_PATH` when one is set. `HIGHSEAT_PATH` is a server variable, so in the Pages Router,
 * where the layout also renders in the browser, pass `src` instead. A prop wins over its variable.
 */
export function Highseat(props: HighseatProps): ReactElement | null {
  const site = props.site ?? findNextSite()
  const path = findProxyPath()
  const src = props.src ?? (path ? formatProxySrc(path) : undefined)

  if (!site) {
    console.warn("highseat: set NEXT_PUBLIC_HIGHSEAT_SITE, or pass `site` to <Highseat />")
    return null
  }

  return createElement(ReactHighseat, { ...props, site, src })
}
