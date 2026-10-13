/**
 * The variables the package reads from a customer's environment. Each is named in full, never
 * looked up by a computed key: Next.js inlines a `NEXT_PUBLIC_` variable into browser code only
 * where the source spells out `process.env.NEXT_PUBLIC_…`.
 */

/** The site id for `<Highseat />` in Next.js. Public, so it reaches the browser. */
export function findNextSite(): string | undefined {
  return process.env.NEXT_PUBLIC_HIGHSEAT_SITE
}

/** The site's proxy path. A server variable, shared with the proxy handler. */
export function findProxyPath(): string | undefined {
  return process.env.HIGHSEAT_PATH
}
