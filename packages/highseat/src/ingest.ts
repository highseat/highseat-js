import { findSecret } from "./env"

/**
 * What `highseat/proxy` and `highseat/server` share about reaching ingest: its host, the site
 * secret's prefixes and where the visitor's IP is read.
 */

/** A host whose own header carries the visitor's IP. */
export type ClientIpPreset = "vercel" | "cloudflare" | "netlify" | "nginx"

/**
 * Where the visitor's IP is read: a host preset, or a function for any other setup. A function
 * returns the IP, or nothing when the request carries none.
 */
export type ClientIp = ClientIpPreset | ((request: Request) => string | null | undefined)

/** The ingest origin both handlers send to unless told otherwise. */
export const DEFAULT_UPSTREAM = "https://cdn.highseat.com"

// The current prefix first. Ingest still accepts the secrets minted under the older two, so a
// site keeps its secret when it moves to this package.
const SECRET_PREFIXES = ["hs_secret_", "hs_proxy_", "ana_proxy_"]

const CLIENT_IP_HEADERS: Record<ClientIpPreset, string> = {
  vercel: "x-real-ip",
  // Read from the inbound request: Cloudflare overwrites it on the Worker's own subrequest.
  cloudflare: "cf-connecting-ip",
  netlify: "x-nf-client-connection-ip",
  nginx: "x-real-ip",
}

interface ClientIpReader {
  read: (request: Request) => string
  /** Where `read` looks, for the warning about an empty IP. */
  source: string
}

/**
 * The site secret, `option` or else `HIGHSEAT_SECRET`, or `undefined` when neither is set. Throws
 * on a value that is not one, naming the entry point that read it: that is a copying mistake.
 */
export function findValidSecret(option: string | undefined, entry: string): string | undefined {
  const secret = option ?? findSecret()
  if (!secret || SECRET_PREFIXES.some(prefix => secret.startsWith(prefix))) return secret

  throw new Error(
    `${entry}: not a site secret. Copy it from the site's Installation settings; it starts with "${SECRET_PREFIXES[0]}".`,
  )
}

export function getClientIpReader(clientIp: ClientIp, entry: string): ClientIpReader {
  if (typeof clientIp === "function") {
    return { read: request => clientIp(request)?.trim() ?? "", source: "the clientIp function" }
  }

  const header = CLIENT_IP_HEADERS[clientIp]
  if (!header) throw new Error(`${entry}: unknown clientIp preset "${String(clientIp)}".`)
  return {
    read: request => request.headers.get(header)?.trim() ?? "",
    source: `the "${clientIp}" preset's ${header} header`,
  }
}
