/**
 * The browser client. Every call goes to the hosted tracker on `window.highseat`; before the
 * tracker has loaded, calls wait in a queue the tracker drains on startup. Nothing here throws:
 * on a server, with the tracker blocked, or with tracking off, a call does nothing.
 */

/** A value an event property can hold. A `null` or `undefined` value is left out of the event. */
export type PropertyValue = string | number | boolean | null | undefined

/**
 * Money attached to an event. `amount` is an integer in the currency's smallest unit, so
 * `{ amount: 4999, currency: "USD" }` is $49.99 and `{ amount: 5000, currency: "JPY" }` is ¥5000.
 */
export interface Revenue {
  /** An integer in minor units: 4999 for $49.99. An amount with decimals is rejected. */
  amount: number
  /** An ISO 4217 code, such as `USD` or `EUR`. */
  currency: string
}

/** The properties of an event with no declared shape: any string keys, plus optional revenue. */
export interface Properties {
  /** Money the event brought in. */
  revenue?: Revenue
  [key: string]: PropertyValue | Revenue
}

/**
 * The events Highseat knows by name. A site extends it, or overrides an entry, through
 * {@link Register}. Type-only: it adds nothing to the bundle.
 */
export interface BuiltInEvents {
  /** A visitor created an account. */
  signup: Properties
  /** A visitor signed in. */
  login: Properties
  /**
   * A sale. With a payment provider connected, leave `revenue` out: the provider's webhook
   * records the money, and revenue sent here as well would count the sale twice. Send `revenue`
   * only for a checkout no provider reports, and then with an `order_id`, so a provider sale
   * added later for the same order is not counted again.
   */
  purchase: Properties
  /** A paid subscription began. */
  subscription_started: Properties
  /** A free trial began. */
  trial_started: Properties
  /** A file download. The tracker records links to files on its own. */
  file_download: { url: string }
  /** A click on a link to another site. The tracker records these on its own. */
  outbound_link_click: { url: string }
  /** A visit to a missing page. Call it from a single-page app's not-found route. */
  "404": Properties
}

/**
 * Declares a site's own events. Augment it from any file the compiler sees:
 *
 * ```ts
 * declare module "highseat" {
 *   interface Register {
 *     events: {
 *       signup: { plan: "free" | "pro" }
 *     }
 *     strict: true
 *   }
 * }
 * ```
 *
 * `events` adds names, or replaces a built-in one's properties. `strict: true` makes `track`
 * accept only built-in and registered names, so a misspelt name is a type error.
 */
export interface Register {}

/**
 * A registered event's properties as `track` accepts them. A shape with no properties takes none,
 * and a property whose type an event cannot carry becomes `never`, so a call passing it fails
 * instead of sending `"[object Object]"`. The shape is not rejected at registration, where a
 * failed check would silently drop every registered event at once.
 */
type CheckedProperties<Shape> = [keyof Shape] extends [never]
  ? Record<string, never>
  : { [Key in keyof Shape]: Shape[Key] extends PropertyValue | Revenue ? Shape[Key] : never }

type RegisteredEvents = Register extends { events: infer Registered }
  ? { [Name in keyof Registered]: CheckedProperties<Registered[Name]> }
  : {}

type KnownEvents = Omit<BuiltInEvents, keyof RegisteredEvents> & RegisteredEvents

/** Every event name `track` knows, built-in or registered. */
export type EventName = Extract<keyof KnownEvents, string>

/**
 * The names `track` accepts: known names, and any other string unless the site is strict.
 * `string & {}` keeps the known names in the editor's suggestions, which a plain `string` in the
 * union would absorb.
 */
export type TrackName = Register extends { strict: true } ? EventName : EventName | (string & {})

/**
 * The arguments after an event's name. A known name takes its declared properties, required
 * when any of them is; any other name takes {@link Properties}. Wrapped in tuples so a union of
 * names is checked as a whole rather than name by name.
 */
export type TrackArgs<Name extends string> = [Name] extends [EventName]
  ? {} extends KnownEvents[Name]
    ? [properties?: KnownEvents[Name]]
    : [properties: KnownEvents[Name]]
  : [properties?: Properties]

/**
 * A user id from your own system, as {@link identify} takes it. A string or a number identifies
 * the visitor, `null` clears the id, and `undefined` or an empty string changes nothing. Pass your
 * own database id, never an email or other personal data.
 */
export type UserId = string | number | null | undefined

/** The tracker's API on `window.highseat`, or the queue that stands in for it until it loads. */
export interface HighseatGlobal {
  /** Records an event. */
  track?: (name: string, properties?: Properties) => void
  /** Sets or clears the visitor's user id. */
  identify?: (id: UserId) => void
  /** The id that joins a payment to this tab's visit. */
  getAttributionId?: () => string | undefined
  /** Calls made before the tracker loaded, drained in order when it starts. */
  q?: [string, unknown[]][]
}

/** How long {@link getAttributionId} waits for the tracker. */
export interface AttributionOptions {
  /** Milliseconds to wait for the tracker to load. Defaults to 3000. */
  timeout?: number
}

/** How the tracker is loaded. Each option maps to an attribute on its script tag. */
export interface InjectOptions {
  /** The site id, `site_…`, from the site's Installation settings. */
  site: string
  /**
   * Where the script loads from: the site's proxy path (`/3f9a0c1e2b`) for first-party
   * delivery, or a full URL. Defaults to Highseat's own host. The tracker posts its events back
   * to the same place.
   */
  src?: string
  /** Records clicks on links to other sites as `outbound_link_click`. Defaults to `true`. */
  outbound?: boolean
  /** Records clicks on links to files as `file_download`. Defaults to `true`. */
  downloads?: boolean
  /** Counts a change of `#/route` as a page view, for an app that routes by hash. */
  hashRouting?: boolean
}

declare global {
  interface Window {
    highseat?: HighseatGlobal
  }
}

/** Where the tracker loads from when the site has no proxy path. */
export const SCRIPT_URL = "https://cdn.highseat.com/script.js"

// The tracker marks its own API with this symbol. A site's own stub can define methods too, so
// only the symbol proves the tracker is running.
const LIVE = Symbol.for("highseat")

const SCRIPT_HOST = new URL(SCRIPT_URL).host
// A site's proxy path: `/` and ten hex characters.
const PROXY_PATH = /^\/[0-9a-f]{10}$/

const ATTRIBUTION_TIMEOUT = 3000
const ATTRIBUTION_POLL_INTERVAL = 50

// The script tags `inject` added, and every tracker script whose request failed, such as one an
// ad blocker stopped. A browser keeps no record of a failed script, so a failure is only known
// to a listener attached before it happened.
const injectedScripts = new WeakSet<HTMLScriptElement>()
const failedScripts = new WeakSet<HTMLScriptElement>()

function findGlobal(): HighseatGlobal | undefined {
  if (typeof window === "undefined") return
  return (window.highseat ??= {})
}

function isLive(api: HighseatGlobal | undefined): api is HighseatGlobal {
  return !!api && (api as Record<symbol, unknown>)[LIVE] === true
}

// One function for every script, so attaching it on each poll adds no second listener.
function markFailed(event: Event) {
  failedScripts.add(event.currentTarget as HTMLScriptElement)
}

/**
 * Whether a script tag loads the tracker, judged as the tracker judges itself. Fathom's snippet
 * carries a `data-site` too, so a tag is matched by a `site_` id, or by a `src` on a proxy path
 * or on Highseat's host: an older site's id is a UUID, which any tool could use.
 */
function isTrackerScript(script: HTMLScriptElement) {
  const { site } = script.dataset
  if (injectedScripts.has(script) || site?.startsWith("site_")) return true
  if (site === undefined) return false

  try {
    // A browser hands back `src` resolved; the base only matters to a relative one.
    const url = new URL(script.src, "http://localhost")
    return url.host === SCRIPT_HOST || PROXY_PATH.test(url.pathname)
  } catch {
    return false
  }
}

function findTrackerScripts() {
  return Array.from(document.scripts).filter(isTrackerScript)
}

function call(method: "track" | "identify", args: unknown[]) {
  const api = findGlobal()
  if (!api) return

  const handler = api[method] as ((...values: unknown[]) => void) | undefined
  if (typeof handler !== "function") {
    api.q ??= []
    api.q.push([method, args])
    return
  }

  try {
    handler(...args)
  } catch {}
}

/**
 * Records an event. A known name autocompletes and checks its properties; any other name is a
 * custom event, unless {@link Register} sets `strict`. Names are stored exactly as written, so
 * `Purchase` and `purchase` are two events.
 */
export function track<Name extends TrackName>(name: Name, ...args: TrackArgs<Name>): void {
  const [properties] = args
  call("track", properties === undefined ? [name] : [name, properties])
}

/**
 * Links the visitor to a user id from your own system, on this event and every later one, across
 * visits. `null` clears it at sign-out. An empty or `undefined` id is ignored, so
 * `identify(user?.id)` before a session loads does not sign the visitor out.
 */
export function identify(id: UserId): void {
  call("identify", [id])
}

/**
 * The id that joins a payment to this tab's visit. Pass it to the checkout as metadata
 * (`attribution_id`), and the payment provider's webhook credits the sale to the visit's source.
 * Resolves to `undefined`, so a checkout that awaits it never hangs: at once when the page has
 * no tracker script or its script fails to load (an ad blocker stopping it), after the timeout
 * when the script is still loading, and on a server or with tracking off.
 */
export async function getAttributionId(
  options: AttributionOptions = {},
): Promise<string | undefined> {
  if (typeof window === "undefined" || typeof document === "undefined") return

  const deadline = Date.now() + (options.timeout ?? ATTRIBUTION_TIMEOUT)
  let api = window.highseat

  while (!isLive(api)) {
    if (Date.now() >= deadline) return

    const scripts = findTrackerScripts()
    for (const script of scripts) script.addEventListener("error", markFailed)
    // No tracker script at all, or only failed ones: the tracker cannot arrive.
    if (scripts.every(script => failedScripts.has(script))) return

    await new Promise(resolve => setTimeout(resolve, ATTRIBUTION_POLL_INTERVAL))
    api = window.highseat
  }

  try {
    return api.getAttributionId?.()
  } catch {
    return
  }
}

/**
 * Adds the tracker's script tag to the page, once. A second call for the same site, such as a
 * component mounting again, finds the tag and does nothing. Does nothing on a server.
 */
export function inject(options: InjectOptions): void {
  if (typeof document === "undefined") return

  const { site, src = SCRIPT_URL, outbound, downloads, hashRouting } = options
  if (Array.from(document.scripts).some(script => script.dataset.site === site)) return

  const script = document.createElement("script")
  script.addEventListener("error", markFailed)
  injectedScripts.add(script)
  script.src = src
  script.dataset.site = site
  if (outbound === false) script.dataset.outbound = "false"
  if (downloads === false) script.dataset.downloads = "false"
  if (hashRouting) script.dataset.hashRouting = ""
  document.head.append(script)
}
