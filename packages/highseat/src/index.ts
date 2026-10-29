import { isDevelopment } from "./env"

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

// A registered event replaces a built-in one of the same name.
type KnownEvents<BuiltIns> = Omit<BuiltIns, keyof RegisteredEvents> & RegisteredEvents

/**
 * The event names a `track` with the given built-in events knows, built-in or registered.
 * `highseat/server` passes its server-only events on top of {@link BuiltInEvents}.
 */
export type KnownEventName<BuiltIns> = Extract<keyof KnownEvents<BuiltIns>, string>

/** Every event name `track` knows, built-in or registered. */
export type EventName = KnownEventName<BuiltInEvents>

/**
 * The names a `track` with the given built-in events accepts: known names, and any other string
 * unless the site is strict. `string & {}` keeps the known names in the editor's suggestions,
 * which a plain `string` in the union would absorb.
 */
export type TrackNameOf<BuiltIns> = Register extends { strict: true }
  ? KnownEventName<BuiltIns>
  : KnownEventName<BuiltIns> | (string & {})

/** The names `track` accepts: known names, and any other string unless the site is strict. */
export type TrackName = TrackNameOf<BuiltInEvents>

/**
 * The arguments after an event's name, for a `track` with the given built-in events. A known
 * name takes its declared properties, required when any of them is; any other name takes
 * {@link Properties}. Wrapped in tuples so a union of names is checked as a whole rather than
 * name by name.
 */
export type TrackArgsOf<BuiltIns, Name extends string> = [Name] extends [KnownEventName<BuiltIns>]
  ? {} extends KnownEvents<BuiltIns>[Name]
    ? [properties?: KnownEvents<BuiltIns>[Name]]
    : [properties: KnownEvents<BuiltIns>[Name]]
  : [properties?: Properties]

/** The arguments after an event's name: its properties. See {@link TrackArgsOf}. */
export type TrackArgs<Name extends string> = TrackArgsOf<BuiltInEvents, Name>

/**
 * A user id from your own system, as {@link identify} takes it. A string or a number identifies
 * the visitor, `null` clears the id, and `undefined` or an empty string changes nothing. Pass your
 * own database id, never an email or other personal data.
 */
export type UserId = string | number | null | undefined

/**
 * The part of an event {@link BeforeSend} sees and may change. The site, the visitor's user id
 * and the attribution id are out of reach, so a hook cannot change who an event belongs to.
 */
export interface BeforeSendEvent {
  /** The event's name: `pageview`, `engagement`, or a name passed to `track`. Read-only. */
  readonly name: string
  /** The page's full URL. The page path is read off the URL you return. */
  url: string
  /** The page the visitor came from, or the page left on a client-side navigation. */
  referrer?: string
  /** The event's properties, each value a string. */
  properties?: Record<string, string>
}

/**
 * Runs in the browser on every event before the tracker sends it, page views from client-side
 * navigation included. Return the event, changed or not, or `null` to drop it. Any other falsy
 * answer drops it too, and so does a hook that throws: a hook that keeps a secret out of the
 * data must not leak it when it fails. The error still reaches the console.
 *
 * ```ts
 * function beforeSend(event: BeforeSendEvent) {
 *   const url = new URL(event.url)
 *   if (url.pathname.startsWith("/admin/")) return null
 *   url.searchParams.delete("email")
 *   return { ...event, url: url.href }
 * }
 * ```
 */
export type BeforeSend = (event: BeforeSendEvent) => BeforeSendEvent | null

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
  /** The site's {@link BeforeSend} hook, read on every event. */
  beforeSend?: BeforeSend
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
  /** Changes or drops each event before it leaves the browser. See {@link BeforeSend}. */
  beforeSend?: BeforeSend
  /**
   * Logs every `track()` and `identify()` call to the console, and warns once when no tracker
   * script is on the page or the script failed to load. Defaults to `true` when
   * `process.env.NODE_ENV` is `development`, so a production build logs nothing.
   */
  debug?: boolean
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

const TRACKER_TIMEOUT = 3000
const TRACKER_POLL_INTERVAL = 50

const MISSING_SCRIPT_WARNING = [
  "highseat: no tracker script on this page, so no event reaches Highseat.",
  "Render <Highseat />, call inject({ site }), or add the script tag from the site's Installation settings.",
].join(" ")
const FAILED_SCRIPT_WARNING = [
  "highseat: the tracker script failed to load, so no event reaches Highseat.",
  "An ad blocker may have stopped it: load the tracker from the site's proxy path instead.",
].join(" ")
const SLOW_SCRIPT_WARNING = [
  `highseat: the tracker script has not loaded after ${TRACKER_TIMEOUT / 1000} seconds,`,
  "so every call waits in the queue. Check the network panel for a blocked or failed request.",
].join(" ")

// The script tags `inject` added, and every tracker script whose request failed, such as one an
// ad blocker stopped. A browser keeps no record of a failed script, so a failure is only known
// to a listener attached before it happened.
const injectedScripts = new WeakSet<HTMLScriptElement>()
const failedScripts = new WeakSet<HTMLScriptElement>()

// The `debug` option of the last `inject` call. Unset falls back to the build's environment.
let debugOption: boolean | undefined
// The windows whose tracker is being watched, so a page warns about its script once.
const watchedWindows = new WeakSet<Window>()

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

/** The page's tracker scripts, each one listened to from now on for a failed load. */
function getTrackerScripts() {
  const scripts = Array.from(document.scripts).filter(isTrackerScript)
  for (const script of scripts) script.addEventListener("error", markFailed)
  return scripts
}

function isDebug() {
  return debugOption ?? isDevelopment()
}

/**
 * Warns once per page when the tracker cannot arrive: no tracker script, or only failed ones. A
 * missing script is judged at the timeout, because `<Highseat />` adds its tag in an effect that
 * runs after the effects of the components inside it.
 */
function watchTracker() {
  if (typeof window === "undefined" || typeof document === "undefined") return
  if (watchedWindows.has(window)) return
  watchedWindows.add(window)

  const page = window
  const deadline = Date.now() + TRACKER_TIMEOUT

  function check() {
    // A replaced global window, as a test sets up for each case, is another page.
    if (window !== page || isLive(page.highseat)) return

    const scripts = getTrackerScripts()

    if (scripts.length > 0 && scripts.every(script => failedScripts.has(script))) {
      console.warn(FAILED_SCRIPT_WARNING)
      return
    }
    if (Date.now() < deadline) {
      setTimeout(check, TRACKER_POLL_INTERVAL)
      return
    }
    console.warn(scripts.length === 0 ? MISSING_SCRIPT_WARNING : SLOW_SCRIPT_WARNING)
  }

  setTimeout(check, TRACKER_POLL_INTERVAL)
}

/**
 * Logs a call when debugging is on. The check waits a microtask, so a `debug` option that
 * `<Highseat />` passes in its effect applies to the calls its children make in theirs.
 */
function logCall(method: "track" | "identify", args: unknown[], isQueued: boolean) {
  queueMicrotask(() => {
    if (!isDebug()) return

    const status = isQueued ? "queued until the tracker loads" : "sent to the tracker"
    const [value, properties] = args
    // `JSON.stringify` quotes a name or a string id, and returns `undefined` for an unset id.
    const message = `highseat: ${method} ${String(JSON.stringify(value))}, ${status}`

    if (properties === undefined) console.info(message)
    else console.info(message, properties)
    watchTracker()
  })
}

function call(method: "track" | "identify", args: unknown[]) {
  const api = findGlobal()
  if (!api) return

  const handler = api[method] as ((...values: unknown[]) => void) | undefined
  if (typeof handler !== "function") {
    api.q ??= []
    api.q.push([method, args])
    logCall(method, args, true)
    return
  }

  logCall(method, args, false)
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

  const deadline = Date.now() + (options.timeout ?? TRACKER_TIMEOUT)
  let api = window.highseat

  while (!isLive(api)) {
    if (Date.now() >= deadline) return

    const scripts = getTrackerScripts()
    // No tracker script at all, or only failed ones: the tracker cannot arrive.
    if (scripts.every(script => failedScripts.has(script))) return

    await new Promise(resolve => setTimeout(resolve, TRACKER_POLL_INTERVAL))
    api = window.highseat
  }

  try {
    return api.getAttributionId?.()
  } catch {
    return
  }
}

/**
 * Sets the {@link BeforeSend} hook, or clears it with `undefined`. Works before the tracker has
 * loaded, which picks the hook up when it starts, and applies from the next event once it runs.
 * Does nothing on a server.
 */
export function setBeforeSend(beforeSend: BeforeSend | undefined): void {
  const api = findGlobal()
  if (api) api.beforeSend = beforeSend
}

/**
 * Adds the tracker's script tag to the page, once. A second call for the same site, such as a
 * component mounting again, finds the tag and adds nothing, but its `debug` option still applies.
 * Does nothing on a server.
 */
export function inject(options: InjectOptions): void {
  if (typeof document === "undefined") return

  const { site, src = SCRIPT_URL, outbound, downloads, hashRouting, beforeSend, debug } = options
  debugOption = debug
  // Set before the script tag is added, so the first page view already passes through it.
  if (beforeSend) setBeforeSend(beforeSend)
  if (isDebug()) watchTracker()
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
