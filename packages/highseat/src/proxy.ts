import { findProxyPath, isNextBuild } from "./env"
import { type ClientIp, DEFAULT_UPSTREAM, findValidSecret, getClientIpReader } from "./ingest"

export type { ClientIp, ClientIpPreset } from "./ingest"

export interface ProxyOptions {
  /**
   * The site's proxy path from Installation settings, such as `/3f9a0c1e2b`, with or without its
   * leading slash. A request on any
   * other path is answered 404, or handed to `fallback`. Defaults to the `HIGHSEAT_PATH`
   * environment variable. Leave both unset on a host whose router already sends only the proxy
   * path here, such as a file named after the path.
   */
  path?: string
  /**
   * The site secret, `hs_secret_…`, or an older one that starts `hs_proxy_` or `ana_proxy_`.
   * Defaults to the `HIGHSEAT_SECRET` environment variable. Without one the proxy is off: the
   * proxy path answers 503, or every request goes to `fallback`.
   */
  secret?: string
  /**
   * Where the visitor's IP comes from: `vercel`, `cloudflare`, `netlify`, `nginx` (the
   * `X-Real-IP` header your nginx sets), or a function. A visitor can write any header the host
   * does not overwrite, so there is no default.
   *
   * The outermost proxy that sets the header decides the preset. Behind a proxied Cloudflare
   * record, use `cloudflare` on any origin, not only a Worker or a Pages Function: a Next.js,
   * TanStack Start or Node server behind Cloudflare, with or without Traefik or nginx in between,
   * sees a Cloudflare edge address in `X-Real-IP`, and the visitor's IP in `cf-connecting-ip`.
   */
  clientIp: ClientIp
  /** The ingest origin the proxy forwards to. Defaults to `https://cdn.highseat.com`. */
  upstream?: string
  /**
   * Answers a request on any path other than `path`, for a handler that sees every request on
   * the site: `fetch` in a Cloudflare Worker routed on the whole site, `next` in a Pages
   * Function. Needs `path`: without it, or without the secret, the proxy is off and every
   * request goes here, so the site still serves in a development setup without the variables.
   */
  fallback?: (request: Request) => Response | Promise<Response>
}

/** A fetch handler, the shape every supported runtime and framework route accepts. */
export type ProxyHandler = (request: Request) => Promise<Response>

// The visitor headers each direction forwards. Copied by name, so a cookie, an `Authorization`
// header or a visitor's own `x-hs-*` header never reaches ingest.
const SCRIPT_REQUEST_HEADERS = ["user-agent", "if-none-match"]
const EVENT_REQUEST_HEADERS = ["content-type", "user-agent", "origin"]

// The upstream headers the response keeps. Rebuilt by name because Node, Bun and Deno hand back
// a decompressed body under the original `content-encoding` and `content-length`, which would
// describe bytes this handler no longer has. `x-hs-ip` and `x-hs-ip-source` show which IP
// ingest resolved, for `curl -i` against the proxy path.
const RESPONSE_HEADERS = [
  "content-type",
  "etag",
  "cache-control",
  "vary",
  "retry-after",
  "x-hs-ip",
  "x-hs-ip-source",
]

// Statuses whose response must not carry a body, which the Response constructor enforces.
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304])

const UPSTREAM_TIMEOUT_MS = 10_000

// Ingest refuses a larger batch, so a bigger body is answered here without buffering the rest.
const MAX_EVENT_BYTES = 512 * 1024

function copyHeaders(from: Headers, to: Headers, names: string[]) {
  for (const name of names) {
    const value = from.get(name)
    if (value !== null) to.set(name, value)
  }
}

function answerError(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } })
}

// A JSON body rather than an empty 404, so `curl -i` on the route handler's own URL tells this
// answer apart from ingest's.
function answerOtherPath() {
  return answerError(404, "Not the proxy path. The Highseat proxy answers on its own path only.")
}

// The handler can be created per request (a Worker that reads its options from `env`), so a
// missing variable is reported once per process rather than once per handler.
let hasWarnedMissing = false

/**
 * The handler for a proxy missing a variable: every request goes to `fallback`, or the proxy
 * path answers 503 naming what is missing.
 */
function createDisabledProxy(
  missing: string[],
  path: string | undefined,
  fallback: ProxyOptions["fallback"],
): ProxyHandler {
  const names = missing.join(" and ")

  // A Next.js build loads every route without serving one, often without the runtime variables.
  if (!hasWarnedMissing && !isNextBuild()) {
    hasWarnedMissing = true
    const outcome = fallback ? "every request goes to `fallback`" : "the proxy path answers 503"
    console.warn(`highseat/proxy: ${names} not set, so the proxy is off and ${outcome}.`)
  }

  return async function proxy(request) {
    if (fallback) return fallback(request)
    if (path !== undefined && new URL(request.url).pathname !== path) return answerOtherPath()
    return answerError(503, `The Highseat proxy is off: set ${names}.`)
  }
}

/** The request body, or `undefined` once it passes `MAX_EVENT_BYTES`. */
async function readEventBody(request: Request): Promise<Uint8Array<ArrayBuffer> | undefined> {
  if (Number(request.headers.get("content-length")) > MAX_EVENT_BYTES) return
  if (!request.body) return new Uint8Array()

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0

  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    size += chunk.value.byteLength
    if (size > MAX_EVENT_BYTES) {
      void reader.cancel()
      return
    }
    chunks.push(chunk.value)
  }

  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

/**
 * Creates the first-party proxy handler for a site. A GET serves the tracker script and a POST
 * forwards its events, both to the ingest host, with the site secret and the visitor's IP. The
 * returned function takes a `Request` and returns a `Response`, so it mounts as a Next.js route
 * handler, a Cloudflare Worker, a Pages Function, a Netlify or Vercel function, an Astro
 * endpoint or a Hono route.
 *
 * A missing path or secret never throws: the handler passes every request to `fallback`, or
 * answers the proxy path with a 503 naming the variable, and warns once. A value that is not a
 * site secret throws, since that is a copying mistake rather than a variable left unset.
 */
export function createProxy(options: ProxyOptions): ProxyHandler {
  const path = findProxyPath(options.path)
  const { fallback } = options
  let foundSecret: string | undefined

  try {
    foundSecret = findValidSecret(options.secret, "highseat/proxy")
  } catch (error) {
    // Next.js loads every route while it builds, so there the error waits for the first request
    // rather than failing a build that never serves one.
    if (!isNextBuild()) throw error
    return () => Promise.reject(error)
  }

  const upstream = new URL(options.upstream ?? DEFAULT_UPSTREAM).origin

  // Without a secret, ingest would read every visitor as this server and drop it as datacenter
  // traffic. Without a path, a handler that sees every request cannot tell the proxy's apart.
  const missing = [
    ...(fallback && path === undefined ? ["HIGHSEAT_PATH"] : []),
    ...(foundSecret ? [] : ["HIGHSEAT_SECRET"]),
  ]
  if (!foundSecret || missing.length) return createDisabledProxy(missing, path, fallback)

  const secret = foundSecret

  const clientIpReader = getClientIpReader(options.clientIp, "highseat/proxy")
  let hasWarnedNoIp = false

  // Ingest answers 400 to every event without a visitor IP and says nothing about the preset,
  // so the first request without one names the source it read.
  function readClientIp(request: Request) {
    const ip = clientIpReader.read(request)

    if (!ip && !hasWarnedNoIp) {
      hasWarnedNoIp = true
      console.warn(
        `highseat/proxy: no visitor IP in ${clientIpReader.source}, so Highseat refuses every event. Set clientIp to the outermost proxy in front of this server.`,
      )
    }
    return ip
  }

  function buildUpstreamHeaders(request: Request, names: string[]) {
    const headers = new Headers({
      // The response never copies `content-encoding`, so ingest is asked for a plain body.
      "accept-encoding": "identity",
      "x-hs-secret": secret,
      "x-hs-client-ip": readClientIp(request),
    })
    copyHeaders(request.headers, headers, names)
    return headers
  }

  async function forward(url: string, init: RequestInit) {
    let response: Response

    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) })
    } catch {
      return answerError(502, "Highseat is unreachable from this proxy.")
    }

    const headers = new Headers()
    copyHeaders(response.headers, headers, RESPONSE_HEADERS)
    if (init.method === "POST") headers.set("cache-control", "no-store")

    const body = NULL_BODY_STATUSES.has(response.status) ? null : response.body
    return new Response(body, { status: response.status, headers })
  }

  return async function proxy(request) {
    if (path !== undefined && new URL(request.url).pathname !== path) {
      return fallback ? fallback(request) : answerOtherPath()
    }

    if (request.method === "GET" || request.method === "HEAD") {
      return forward(`${upstream}/script.js`, {
        method: request.method,
        headers: buildUpstreamHeaders(request, SCRIPT_REQUEST_HEADERS),
      })
    }

    if (request.method === "POST") {
      const body = await readEventBody(request)
      if (!body) return answerError(413, "The event batch is too large.")

      return forward(`${upstream}/api/event`, {
        method: "POST",
        headers: buildUpstreamHeaders(request, EVENT_REQUEST_HEADERS),
        body,
      })
    }

    return new Response(null, { status: 405, headers: { allow: "GET, HEAD, POST" } })
  }
}
