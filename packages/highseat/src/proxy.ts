export interface ProxyOptions {
  /** The site's proxy path. */
  path?: string
  /** The site secret, `hs_secret_…`. */
  secret?: string
  /** The ingest origin the proxy forwards to. */
  upstream?: string
}

/** A fetch handler, the shape every supported runtime and framework route accepts. */
export type ProxyHandler = (request: Request) => Promise<Response>

/** Creates the first-party proxy handler for a site. */
export function createProxy(_options: ProxyOptions = {}): ProxyHandler {
  return async () => new Response("Not implemented", { status: 501 })
}
