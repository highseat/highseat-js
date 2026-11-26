import { findHostPlatform, findSecret, findServerSite, isNextBuild } from "./env"
import type { BuiltInEvents, PropertyValue, Revenue, TrackArgsOf, TrackNameOf } from "./index"
import {
  type ClientIp,
  DEFAULT_UPSTREAM,
  getClientIpReader,
  isClientIp,
  isSiteSecret,
  SECRET_PREFIX,
} from "./ingest"

export type { ClientIp, ClientIpPreset } from "./ingest"

/**
 * Server-side events, sent from your own backend with the site secret: a server action, a route
 * handler, a webhook handler or a job. Events are batched and sent in the background, retried
 * when Highseat is busy or unreachable, and nothing here throws: a failure goes to `onError`,
 * and so do options that cannot be right, which turn the tracker off.
 */

/**
 * Request headers in any shape a server hands them over: a `Headers` object, what Next.js's
 * `headers()` returns, or Node's `request.headers` record.
 */
export type HeadersLike =
  | { get: (name: string) => string | null }
  | Record<string, string | string[] | undefined>

/**
 * Keeps a serverless function alive until a promise settles: `waitUntil` from
 * `@vercel/functions`, or `ctx.waitUntil` in a Cloudflare Worker and `context.waitUntil` in a
 * Netlify function, bound to their object.
 */
export type WaitUntil = (promise: Promise<unknown>) => void

/** Who an event belongs to and where it happened, given with each `track()` call. */
export interface ServerEventOptions {
  /**
   * The request being handled. The visitor's IP (see `clientIp`), their user agent and the
   * hostname are read from it, and a `pageview` takes its URL and referrer too.
   */
  request?: Request
  /** The request's headers, when there is no `Request`: `await headers()` in a server action. */
  headers?: HeadersLike
  /** The visitor's IP. Wins over the one read from `request` or `headers`. */
  ip?: string
  /** The visitor's user agent. Wins over the one read from `request` or `headers`. */
  userAgent?: string
  /**
   * A user id from your own system. An event with no visitor (no IP and no user agent, as from
   * a job) counts as this user, and without one as a visitor of its own.
   */
  userId?: string | number
  /** A hostname of the site. Defaults to the tracker's `hostname`, then the request's host. */
  hostname?: string
  /** The page's URL. A `pageview` defaults to the request's URL. */
  url?: string
  /** The page the visitor came from. A `pageview` defaults to the request's `Referer`. */
  referrer?: string
  /**
   * The event's id, any string up to 255 characters. Defaults to a new UUID. Pass an id your
   * system already holds (a job id, a webhook event id), and a retry of the same event within
   * three days is stored once.
   */
  eventId?: string
  /** When the event happened, up to a day ago. Defaults to the moment `track()` is called. */
  timestamp?: Date
  /**
   * Sends this event at once and keeps the function alive until it lands. Wins over the
   * tracker's `waitUntil`.
   */
  waitUntil?: WaitUntil
}

/** An event Highseat did not store, as `onError` reports it. */
export interface TrackErrorEvent {
  /** The event's name. */
  name: string
  /** The event's id: the one passed to `track()`, or the UUID it was given. */
  eventId: string
  /** Why Highseat refused or dropped it, such as `revenue.amount_not_integer` or `bot`. */
  reason?: string
}

/** A failure `track()` and `createTracker()` never throw, handed to `onError`. */
export interface TrackError {
  /**
   * `rejected`: refused as invalid, for good. `dropped`: accepted but not stored, for a `reason`
   * of `foreign_hostname`, `bot` or `excluded` (a recognised retry is never reported). `failed`:
   * never landed, after every retry or at `close()`'s deadline, or refused whole (a wrong secret).
   * `invalid`: the tracker's options cannot be right, such as a secret without its `hs_secret_`
   * prefix, so it sends nothing. It is reported once, by `createTracker()`, with no events.
   */
  type: "rejected" | "dropped" | "failed" | "invalid"
  /** What happened, in a sentence. */
  message: string
  /** The HTTP status Highseat answered, when it answered. */
  status?: number
  /** The events concerned. */
  events: TrackErrorEvent[]
}

/** An event as the tracker would send it, handed to the `dryRun` logger. */
export interface DryRunEvent {
  /** The event's name. */
  name: string
  /** The event's id: the one passed to `track()`, or the UUID it was given. */
  eventId: string
  /** The properties as Highseat stores them: every value a string, cut to 500 characters. */
  properties: Record<string, string>
  /** The revenue, when the event carries some. */
  revenue?: Revenue
  /** The user id, as a string. */
  userId?: string
  /** The hostname the event is filed under. */
  hostname?: string
  /** The visitor's IP. */
  ip?: string
  /** The visitor's user agent. */
  userAgent?: string
  /** The page's URL. */
  url?: string
  /** The page the visitor came from. */
  referrer?: string
  /** When the event happened. */
  timestamp: Date
}

export interface TrackerOptions {
  /**
   * `false` turns the tracker off: every `track()` does nothing, and neither the options'
   * credentials nor the environment are read. Pass it where tracking must stay off, such as
   * outside production. Defaults to `true`.
   */
  enabled?: boolean
  /**
   * Logs each event instead of sending it. `true` logs through `console.info`, and a function
   * receives each event, to log through your own logger. A dry run sends nothing and needs no
   * credentials, even with `enabled: false`, so it also shows what a development server would
   * track. It never reads the environment, and options that cannot be right turn it off as they
   * would a real tracker.
   */
  dryRun?: boolean | ((event: DryRunEvent) => void)
  /** The site id, `site_…`. Defaults to `HIGHSEAT_SITE`, then `NEXT_PUBLIC_HIGHSEAT_SITE`. */
  site?: string
  /**
   * The site secret, `hs_secret_…`, from the site's Installation settings. Defaults to
   * `HIGHSEAT_SECRET`. Keep it on the server: it lets a caller name any visitor.
   */
  secret?: string
  /** The hostname every event is filed under unless it names its own. */
  hostname?: string
  /**
   * Where the visitor's IP is read from a request: `vercel`, `cloudflare`, `netlify`, `nginx`
   * or a function, as for `createProxy()`. Defaults to `cloudflare` in a Worker, `vercel` on
   * Vercel and `netlify` on Netlify. Anywhere else, set it, or pass `ip` with each event.
   */
  clientIp?: ClientIp
  /** The ingest origin. Defaults to `https://cdn.highseat.com`. */
  upstream?: string
  /** The `fetch` events are sent with. Defaults to the global one. */
  fetch?: typeof fetch
  /**
   * Receives every failure, and options that cannot be right as one `invalid` error. Defaults to
   * a `console.warn`.
   */
  onError?: (error: TrackError) => void
  /**
   * Sends every event at once and keeps the function alive until it lands. Pass it in a
   * serverless function, which may stop as soon as it answers.
   */
  waitUntil?: WaitUntil
  /** Milliseconds an event waits for others to share its request. Defaults to 1000. */
  flushInterval?: number
  /**
   * Retries of a batch Highseat answered 429 or 5xx, or never answered. Defaults to 4. Batches
   * go one at a time, so a retry's wait holds back every event behind it.
   */
  maxRetries?: number
  /** Milliseconds one request may take. Defaults to 10000. */
  timeout?: number
}

/**
 * The events Highseat knows by name that only a server sends, on top of the browser's built-in
 * events. Highseat refuses them from a browser. A site overrides an entry through `Register`.
 */
export interface ServerBuiltInEvents {
  /**
   * One call to a tool on the site's MCP server. `highseat/mcp` sends it for every call. Never
   * put the tool's arguments in it: assistant directories forbid recording conversation data.
   */
  mcp_tool_call: {
    /** The tool's name. */
    tool: string
    /** A label for the MCP server, such as `public` or `admin`, when the site runs more than one. */
    server?: string
    /**
     * The client's name as it declares it in `clientInfo`, else the product name its User-Agent
     * starts with (`Claude-User`), else `unknown`.
     */
    client: string
    /** The version the client declares in `clientInfo`, when it declares one. */
    client_version?: string
    /**
     * How `client` was found: declared in `clientInfo`, read off the User-Agent, or neither. A
     * declared name is the one to trust.
     */
    client_source: "client_info" | "user_agent" | "none"
    /** `ok`, or the error code the client saw, such as `NOT_FOUND`. */
    status: "ok" | (string & {})
    /**
     * How many items the call returned, for a read-only tool whose result is a list. Left out
     * for any other tool, so an empty list counts as an empty result and nothing else does.
     */
    results?: number
    /** How long the call took, in whole milliseconds. */
    duration_ms: number
  }
}

type ServerEvents = BuiltInEvents & ServerBuiltInEvents

/** The names the server's `track()` accepts: the browser's, plus {@link ServerBuiltInEvents}. */
export type ServerTrackName = TrackNameOf<ServerEvents>

/**
 * The arguments after an event's name: its properties, typed by `Register` as for the browser's
 * `track()`, then the options that say who it belongs to.
 */
export type ServerTrackArgs<Name extends string> = [
  ...TrackArgsOf<ServerEvents, Name>,
  options?: ServerEventOptions,
]

export interface Tracker {
  /** Records an event, queued and sent in the background. Returns at once and never throws. */
  track: <Name extends ServerTrackName>(name: Name, ...args: ServerTrackArgs<Name>) => void
  /** Sends every queued event, and resolves once each has landed or failed. Never rejects. */
  flush: () => Promise<void>
  /**
   * Sends what is queued and stops: a later `track()` sends nothing. Call it at shutdown, with a
   * `timeout` shorter than the shutdown's grace period.
   */
  close: (options?: CloseOptions) => Promise<void>
}

export interface CloseOptions {
  /**
   * Milliseconds to wait for the queue to drain. Past it, sending stops, the events still
   * unsent go to `onError` as `failed`, and `close()` resolves. Without one, `close()` waits for
   * every retry, which during an outage can take minutes.
   */
  timeout?: number
}

/** One event as ingest takes it, before its age is known. */
interface WireEvent {
  event_name: string
  event_id: string
  hostname?: string
  user_id?: string
  ip?: string
  user_agent?: string
  page_url?: string
  referrer?: string
  properties?: Record<string, string>
  revenue?: Revenue
}

interface QueuedEvent {
  event: WireEvent
  /** When it happened, which its `age` is measured from on every attempt. */
  at: number
  /** Resolves the promise handed to `waitUntil`, once the event has landed or failed. */
  settle?: () => void
}

interface BatchEntry {
  index: number
  reason: string
}

interface IngestAnswer {
  rejections?: BatchEntry[]
  dropped?: BatchEntry[]
}

const ENTRY = "highseat/server"

// Ingest's limit per request.
const MAX_BATCH_SIZE = 25

// Events held while Highseat is unreachable, the batch being sent included. A newer one past
// this is reported and not kept, so an outage cannot grow the process without bound.
const MAX_QUEUE_SIZE = 1000

// Ingest cuts a property value to this, and the tracker does too.
const MAX_PROPERTY_LENGTH = 500

const DEFAULT_FLUSH_INTERVAL_MS = 1000
const DEFAULT_MAX_RETRIES = 4
const DEFAULT_TIMEOUT_MS = 10_000

// The first retry's wait, doubled on each one after it, and the longest any wait lasts,
// `Retry-After` included.
const RETRY_BASE_MS = 500
const MAX_RETRY_DELAY_MS = 30_000

function isRetryable(status: number) {
  return status === 429 || status >= 500
}

/** The wait `Retry-After` asks for, in seconds or as a date, or `undefined` when there is none. */
function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return
  const seconds = Number(value)
  if (value.trim() !== "" && Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(value)
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now())
}

function getRetryDelay(attempt: number, retryAfter?: number) {
  const backoff = RETRY_BASE_MS * 2 ** attempt * (1 + Math.random() / 2)
  return Math.min(retryAfter ?? backoff, MAX_RETRY_DELAY_MS)
}

// The headers read off an object that offers only `get`: the ones the presets and the event's
// own fields read.
const READ_HEADERS = [
  "user-agent",
  "host",
  "x-forwarded-host",
  "referer",
  "x-real-ip",
  "cf-connecting-ip",
  "x-nf-client-connection-ip",
]

function toHeaders(headers: HeadersLike): Headers {
  if (headers instanceof Headers) return headers

  const copy = new Headers()
  if (typeof headers.get === "function") {
    const source = headers as { get: (name: string) => string | null }
    for (const name of READ_HEADERS) {
      const value = source.get(name)
      if (value !== null) copy.set(name, value)
    }
    return copy
  }

  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) copy.set(name, Array.isArray(value) ? value.join(", ") : value)
  }
  return copy
}

/** The host a request was sent to, without its port. */
function findRequestHost(request: Request) {
  const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim()
  const host = forwarded ?? request.headers.get("host") ?? new URL(request.url).host
  return host.replace(/:\d+$/, "") || undefined
}

/** The event's request, built from `headers` when it has none, so `clientIp` reads either. */
function findRequest({ request, headers }: ServerEventOptions): Request | undefined {
  if (request) return request
  if (!headers) return

  const copy = toHeaders(headers)
  const host = copy.get("x-forwarded-host") ?? copy.get("host") ?? "localhost"
  return new Request(`https://${host}/`, { headers: copy })
}

/** Properties as ingest stores them: strings, cut to its cap, with revenue on the event itself. */
function toWireProperties(properties: Record<string, PropertyValue | Revenue> | undefined) {
  const { revenue, ...rest } = properties ?? {}
  const values: Record<string, string> = {}
  for (const [key, value] of Object.entries(rest)) {
    // `revenue` is out of `rest`, so every value left is a property value.
    const property = value as PropertyValue
    if (property != null) values[key] = String(property).slice(0, MAX_PROPERTY_LENGTH)
  }
  return {
    ...(Object.keys(values).length ? { properties: values } : {}),
    ...(revenue && typeof revenue === "object" ? { revenue } : {}),
  }
}

function warnOnError(error: TrackError) {
  const message = `${ENTRY}: ${error.message}`
  if (error.events.length) {
    console.warn(message, error.events)
  } else {
    console.warn(message)
  }
}

/** Hands a failure to `onError`, whose own failure is ignored so tracking never throws. */
function reportTo(onError: (error: TrackError) => void, error: TrackError) {
  try {
    onError(error)
  } catch {}
}

/** Whether a request ran inside a Cloudflare Worker, which gives every request a `cf` object. */
function isWorkerRequest(request: Request) {
  return "cf" in request && !!(request as { cf?: unknown }).cf
}

// A site id is `site_` and 21 characters, or an older site's cuid or UUID. A value with a dot,
// a slash or a space is a domain or a URL, and one starting with `hs_` is a secret or an API key.
const SITE_ID = /^(?!hs_)[\w-]+$/

/**
 * Why the options cannot be right, empty when they can. Each one is a copying mistake that no
 * retry fixes, so the tracker turns off rather than sending events Highseat refuses.
 */
function listSetupProblems(options: TrackerOptions, site?: string, secret?: string) {
  const problems: string[] = []
  if (site && !SITE_ID.test(site)) {
    problems.push(
      "The site is not a site id. Copy it from the site's Installation settings, as site_….",
    )
  }
  if (secret && !isSiteSecret(secret)) {
    problems.push(
      `The secret is not a site secret. Copy it from the site's Installation settings; it starts with "${SECRET_PREFIX}".`,
    )
  }
  if (options.clientIp !== undefined && !isClientIp(options.clientIp)) {
    problems.push(`clientIp "${String(options.clientIp)}" is not a preset.`)
  }
  if (options.upstream !== undefined && !URL.canParse(options.upstream)) {
    problems.push("upstream is not a URL.")
  }
  return problems
}

/** Reports what is wrong with the options once, as an `invalid` error, and whether anything is. */
function reportSetupProblems(
  onError: (error: TrackError) => void,
  options: TrackerOptions,
  site?: string,
  secret?: string,
) {
  const problems = listSetupProblems(options, site, secret)
  if (!problems.length) return false

  reportTo(onError, {
    type: "invalid",
    message: `${problems.join(" ")} Events are not sent.`,
    events: [],
  })
  return true
}

const IDLE_TRACKER: Tracker = {
  track: () => {},
  flush: async () => {},
  close: async () => {},
}

// A missing variable is reported once per process, as `createProxy()` does.
let hasWarnedMissing = false

function createDisabledTracker(missing: string[]): Tracker {
  if (!hasWarnedMissing && !isNextBuild()) {
    hasWarnedMissing = true
    console.warn(`${ENTRY}: ${missing.join(" and ")} not set, so events are not sent.`)
  }
  return IDLE_TRACKER
}

/** Turns `track()`'s arguments into an event as ingest takes it. */
function createEventBuilder(options: TrackerOptions) {
  let hasWarnedNoClientIp = false

  function readClientIp(request: Request): string | undefined {
    const clientIp =
      options.clientIp ?? (isWorkerRequest(request) ? "cloudflare" : findHostPlatform())

    if (!clientIp) {
      if (!hasWarnedNoClientIp) {
        hasWarnedNoClientIp = true
        console.warn(
          `${ENTRY}: no clientIp set, so events from a request carry no visitor IP and no country. Set clientIp, or pass ip with each event.`,
        )
      }
      return
    }

    return getClientIpReader(clientIp, ENTRY).read(request) || undefined
  }

  return function buildEvent(
    name: string,
    properties: unknown,
    eventOptions: ServerEventOptions,
  ): WireEvent {
    const request = findRequest(eventOptions)
    const isPageview = name === "pageview"
    const userId = eventOptions.userId === undefined ? "" : String(eventOptions.userId)
    return {
      event_name: name,
      event_id: eventOptions.eventId ?? crypto.randomUUID(),
      hostname: eventOptions.hostname ?? options.hostname ?? (request && findRequestHost(request)),
      ...(userId ? { user_id: userId } : {}),
      ip: eventOptions.ip ?? (request && readClientIp(request)),
      user_agent: eventOptions.userAgent ?? request?.headers.get("user-agent") ?? undefined,
      page_url: eventOptions.url ?? (isPageview && eventOptions.request ? request?.url : undefined),
      referrer:
        eventOptions.referrer ??
        (isPageview ? (request?.headers.get("referer") ?? undefined) : undefined),
      ...toWireProperties(properties as Record<string, PropertyValue | Revenue> | undefined),
    }
  }
}

function logDryRun(event: DryRunEvent) {
  console.info(`${ENTRY}: dry run, not sent: ${JSON.stringify(event.name)}`, event)
}

/** The event under the names `track()` takes, with every unset field left out. */
function toDryRunEvent(event: WireEvent, timestamp: Date): DryRunEvent {
  const optional = {
    revenue: event.revenue,
    userId: event.user_id,
    hostname: event.hostname,
    ip: event.ip,
    userAgent: event.user_agent,
    url: event.page_url,
    referrer: event.referrer,
  }
  return {
    name: event.event_name,
    eventId: event.event_id,
    properties: event.properties ?? {},
    ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== undefined)),
    timestamp,
  }
}

/** A tracker that hands each event to `log` and sends nothing. */
function createDryRunTracker(
  options: TrackerOptions,
  log: (event: DryRunEvent) => void,
  onError: (error: TrackError) => void,
): Tracker {
  const buildEvent = createEventBuilder(options)
  let closed = false

  function track(name: string, ...args: unknown[]) {
    if (closed) return
    try {
      const [properties, eventOptions = {}] = args as [unknown, ServerEventOptions | undefined]
      const timestamp = eventOptions.timestamp ?? new Date()
      log(toDryRunEvent(buildEvent(name, properties, eventOptions), timestamp))
    } catch (error) {
      reportTo(onError, {
        type: "failed",
        message: error instanceof Error ? error.message : String(error),
        events: [],
      })
    }
  }

  return {
    track,
    flush: async () => {},
    close: async () => {
      closed = true
    },
  }
}

/**
 * Creates a tracker for a site's backend. Credentials come from the options or from
 * `HIGHSEAT_SITE` and `HIGHSEAT_SECRET`. It never throws, so a bad setting cannot stop a server
 * from starting: without credentials the tracker warns once and sends nothing, and options that
 * cannot be right, such as a secret without its prefix, go to `onError` once and turn it off.
 * `enabled: false` turns it off on purpose, and `dryRun` logs each event instead of sending it.
 *
 * ```ts
 * const tracker = createTracker({ hostname: "example.com" })
 * tracker.track("signup", { plan: "pro" }, { request, userId: user.id })
 * ```
 */
export function createTracker(options: TrackerOptions = {}): Tracker {
  const onError = options.onError ?? warnOnError

  // A dry run checks the options it is given, as production would, but never the environment.
  if (options.dryRun) {
    if (reportSetupProblems(onError, options, options.site, options.secret)) return IDLE_TRACKER
    const log = options.dryRun === true ? logDryRun : options.dryRun
    return createDryRunTracker(options, log, onError)
  }
  if (options.enabled === false) return IDLE_TRACKER

  const site = options.site ?? findServerSite()
  const secret = options.secret ?? findSecret()
  if (reportSetupProblems(onError, options, site, secret)) return IDLE_TRACKER

  const missing = [...(site ? [] : ["HIGHSEAT_SITE"]), ...(secret ? [] : ["HIGHSEAT_SECRET"])]
  if (!site || !secret) return createDisabledTracker(missing)

  const headers = { "content-type": "application/json", "x-site-id": site, "x-hs-secret": secret }

  const endpoint = `${new URL(options.upstream ?? DEFAULT_UPSTREAM).origin}/api/event`
  const send =
    options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init))
  const buildEvent = createEventBuilder(options)
  const flushInterval = options.flushInterval ?? DEFAULT_FLUSH_INTERVAL_MS
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
  const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS

  // The events waiting for the sender and the batch it holds, which both count toward the cap.
  let queue: QueuedEvent[] = []
  let sending: QueuedEvent[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  // The one sender loop, while it runs. Batches go one at a time, so a 429's `Retry-After`
  // pauses the whole tracker rather than one batch among many retrying at once.
  let sender: Promise<void> | undefined
  let closed = false
  // Set when `close()` reaches its deadline: the sender stops, and what is left is reported.
  let stopped = false
  const stopping = new AbortController()
  let endPause: (() => void) | undefined

  function report(error: TrackError) {
    reportTo(onError, error)
  }

  function listEvents(batch: QueuedEvent[]): TrackErrorEvent[] {
    return batch.map(({ event }) => ({ name: event.event_name, eventId: event.event_id }))
  }

  function toErrorEvents(batch: QueuedEvent[], entries: BatchEntry[]): TrackErrorEvent[] {
    return entries.flatMap(({ index, reason }) => {
      const queued = batch[index]
      return queued
        ? [{ name: queued.event.event_name, eventId: queued.event.event_id, reason }]
        : []
    })
  }

  /** Reports the events ingest refused or did not store, by their place in the batch. */
  async function readAnswer(response: Response, batch: QueuedEvent[]) {
    let answer: IngestAnswer
    try {
      answer = (await response.json()) as IngestAnswer
    } catch {
      return
    }

    const { status } = response
    const rejected = toErrorEvents(batch, answer.rejections ?? [])
    if (rejected.length) {
      report({ type: "rejected", message: "Highseat rejected events.", status, events: rejected })
    }

    const dropped = toErrorEvents(
      batch,
      (answer.dropped ?? []).filter(({ reason }) => reason !== "duplicate"),
    )
    if (dropped.length) {
      report({
        type: "dropped",
        message: "Highseat did not store events.",
        status,
        events: dropped,
      })
    }
  }

  async function readRefusal(response: Response) {
    try {
      const body = (await response.json()) as { error?: unknown }
      if (typeof body.error === "string") return body.error
    } catch {}
    return `Highseat answered ${response.status}.`
  }

  /** Waits before a retry, ended early when `close()` gives up. */
  function pause(ms: number) {
    return new Promise<void>(resolve => {
      const wait = setTimeout(resolve, ms)
      endPause = () => {
        clearTimeout(wait)
        resolve()
      }
    })
  }

  /** Sends one batch until it lands, fails for good, or `close()` gives up on it. */
  async function sendBatch(batch: QueuedEvent[]) {
    for (let attempt = 0; !stopped; attempt++) {
      const now = Date.now()
      // The age is measured again on each attempt, so a retried event keeps its own moment.
      const body = JSON.stringify(
        batch.map(({ event, at }) => ({ ...event, age: Math.max(0, now - at) })),
      )
      let response: Response | undefined
      let failure = "Highseat is unreachable."

      try {
        response = await send(endpoint, {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.any([stopping.signal, AbortSignal.timeout(timeout)]),
        })
      } catch (error) {
        if (error instanceof Error && error.name === "TimeoutError") {
          failure = `Highseat did not answer within ${timeout} ms.`
        }
      }

      // `close()` reports the batch it gave up on.
      if (stopped) return
      if (response?.ok) return readAnswer(response, batch)

      if ((response && !isRetryable(response.status)) || attempt >= maxRetries) {
        const message = response ? await readRefusal(response) : failure
        const status = response?.status
        return report({ type: "failed", message, status, events: listEvents(batch) })
      }

      // Released, so a runtime that pools connections can reuse this one.
      await response?.body?.cancel().catch(() => {})
      await pause(
        getRetryDelay(attempt, parseRetryAfter(response?.headers.get("retry-after") ?? null)),
      )
    }
  }

  function settle(batch: QueuedEvent[]) {
    for (const { settle } of batch) settle?.()
  }

  async function runSender() {
    while (queue.length && !stopped) {
      const batch = queue.slice(0, MAX_BATCH_SIZE)
      queue = queue.slice(MAX_BATCH_SIZE)
      sending = batch
      try {
        await sendBatch(batch)
      } catch {}
      sending = []
      settle(batch)
    }
  }

  /** Starts the sender unless it runs, and resolves when it next stops. */
  function startSender(): Promise<void> {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }

    sender ??= runSender().finally(() => {
      sender = undefined
      // An event queued in the tick the loop ended in found it still set, so it runs again.
      if (queue.length && !stopped) void startSender()
    })
    return sender
  }

  function schedule() {
    if (timer !== undefined) return
    timer = setTimeout(() => {
      timer = undefined
      void startSender()
    }, flushInterval)
    // A queued event must not keep a script or a test runner alive by itself.
    if (typeof timer === "object") timer.unref?.()
  }

  async function flush() {
    while ((queue.length || sending.length) && !stopped) await startSender()
  }

  /** Stops sending, and reports and settles every event not yet confirmed sent. */
  function giveUp(deadline: number) {
    stopped = true
    stopping.abort()
    endPause?.()
    if (timer !== undefined) clearTimeout(timer)

    const unsent = [...sending, ...queue]
    sending = []
    queue = []
    if (unsent.length) {
      report({
        type: "failed",
        message: `close() stopped after ${deadline} ms with ${unsent.length} events not confirmed sent.`,
        events: listEvents(unsent),
      })
    }
    settle(unsent)
  }

  async function close({ timeout: deadline }: CloseOptions = {}) {
    closed = true
    const drained = flush()
    if (deadline === undefined) return drained

    let wait: ReturnType<typeof setTimeout> | undefined
    const expired = new Promise<boolean>(resolve => {
      wait = setTimeout(() => resolve(true), deadline)
    })
    const timedOut = await Promise.race([drained.then(() => false), expired])
    clearTimeout(wait)
    if (timedOut) giveUp(deadline)
  }

  function track(name: string, ...args: unknown[]) {
    try {
      if (closed) return
      const [properties, eventOptions = {}] = args as [unknown, ServerEventOptions | undefined]
      const at = eventOptions.timestamp?.getTime() ?? Date.now()
      const queued: QueuedEvent = { event: buildEvent(name, properties, eventOptions), at }

      if (queue.length + sending.length >= MAX_QUEUE_SIZE) {
        report({
          type: "failed",
          message: `More than ${MAX_QUEUE_SIZE} events are waiting to be sent, so this one was not kept.`,
          events: listEvents([queued]),
        })
        return
      }

      queue.push(queued)
      const waitUntil = eventOptions.waitUntil ?? options.waitUntil
      if (waitUntil) waitUntil(new Promise<void>(resolve => (queued.settle = resolve)))

      if (waitUntil || queue.length >= MAX_BATCH_SIZE) {
        void startSender()
      } else {
        schedule()
      }
    } catch (error) {
      report({
        type: "failed",
        message: error instanceof Error ? error.message : String(error),
        events: [],
      })
    }
  }

  return { track, flush, close }
}

// The tracker the module-level functions share, made from the environment on first use.
let defaultTracker: Tracker | undefined

function getDefaultTracker(): Tracker {
  defaultTracker ??= createTracker()
  return defaultTracker
}

/**
 * Records an event with the tracker made from `HIGHSEAT_SITE` and `HIGHSEAT_SECRET`. A known
 * name checks its properties, as in the browser. Never throws.
 *
 * ```ts
 * track("signup", { plan: "pro" }, { request, userId: user.id })
 * ```
 */
export function track<Name extends ServerTrackName>(
  name: Name,
  ...args: ServerTrackArgs<Name>
): void {
  getDefaultTracker().track(name, ...args)
}

/** Sends every event `track()` has queued. Await it before a short-lived script exits. */
export function flush(): Promise<void> {
  return defaultTracker ? defaultTracker.flush() : Promise.resolve()
}

/** Sends what `track()` has queued and stops sending. Call it at shutdown. See `CloseOptions`. */
export function close(options?: CloseOptions): Promise<void> {
  return defaultTracker ? defaultTracker.close(options) : Promise.resolve()
}
