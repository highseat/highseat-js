import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { createTracker, flush, track } from "./server"
import type { TrackError, TrackerOptions } from "./server"

interface Sent {
  url: string
  headers: Headers
  events: Record<string, unknown>[]
}

const SITE = "site_test"
const SECRET = "hs_secret_test"
const CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

let sent: Sent[] = []
let answers: (() => Response | Promise<Response>)[] = []
let errors: TrackError[] = []
let warn: ReturnType<typeof vi.spyOn>

/** Stands in for ingest: records each request and answers with the next queued answer. */
async function fakeFetch(input: RequestInfo | URL, init?: RequestInit) {
  sent.push({
    url: input instanceof Request ? input.url : String(input as string | URL),
    headers: new Headers(init?.headers),
    events: JSON.parse(init?.body as string) as Record<string, unknown>[],
  })
  const answer = answers.shift()
  return answer ? answer() : Response.json({ ok: true, accepted: 1, rejected: 0, rejections: [] })
}

function tracker(options: TrackerOptions = {}) {
  return createTracker({
    site: SITE,
    secret: SECRET,
    hostname: "example.com",
    fetch: fakeFetch,
    onError: error => errors.push(error),
    ...options,
  })
}

function getEvents() {
  return sent.flatMap(request => request.events)
}

function getEvent(index = 0) {
  const event = getEvents()[index]
  if (!event) throw new Error(`No event ${index} was sent`)
  return event
}

/** Runs `run` with environment variables set, removing them afterwards. */
async function withEnv(values: Record<string, string>, run: () => Promise<void>) {
  Object.assign(process.env, values)

  try {
    await run()
  } finally {
    for (const name of Object.keys(values)) delete process.env[name]
  }
}

beforeEach(() => {
  sent = []
  answers = []
  errors = []
  warn = vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("createTracker", () => {
  test("sends an event with the site's credentials and the visitor it names", async () => {
    const highseat = tracker()
    highseat.track(
      "account_created",
      { plan: "pro", seats: 3, trial: false, coupon: undefined },
      { userId: 42, ip: "203.0.113.7", userAgent: CHROME },
    )
    await highseat.flush()

    const [request] = sent
    expect(request?.url).toBe("https://cdn.highseat.com/api/event")
    expect(request?.headers.get("x-site-id")).toBe(SITE)
    expect(request?.headers.get("x-hs-secret")).toBe(SECRET)
    expect(request?.headers.get("content-type")).toBe("application/json")

    const event = getEvent()
    expect(event).toMatchObject({
      event_name: "account_created",
      hostname: "example.com",
      user_id: "42",
      ip: "203.0.113.7",
      user_agent: CHROME,
      properties: { plan: "pro", seats: "3", trial: "false" },
    })
    expect(event.event_id).toMatch(UUID)
    expect(event.age).toBeGreaterThanOrEqual(0)
  })

  test("reads the visitor and the hostname off the request it handles", async () => {
    const highseat = tracker({ hostname: undefined, clientIp: "cloudflare" })
    const request = new Request("https://shop.example.com/checkout?step=2", {
      headers: {
        "cf-connecting-ip": "198.51.100.4",
        "user-agent": CHROME,
        referer: "https://a.test/",
      },
    })
    highseat.track("purchase", { revenue: { amount: 4999, currency: "USD" } }, { request })
    highseat.track("pageview", undefined, { request })
    await highseat.flush()

    expect(getEvent(0)).toMatchObject({
      event_name: "purchase",
      hostname: "shop.example.com",
      ip: "198.51.100.4",
      user_agent: CHROME,
      revenue: { amount: 4999, currency: "USD" },
    })
    // Only a page view is filed under the request's own page.
    expect(getEvent(0).page_url).toBeUndefined()
    expect(getEvent(1)).toMatchObject({
      page_url: "https://shop.example.com/checkout?step=2",
      referrer: "https://a.test/",
    })
  })

  test("reads headers in every shape a server hands them over", async () => {
    const highseat = tracker({ clientIp: "nginx" })
    const record = { "x-real-ip": "198.51.100.5", "user-agent": CHROME, host: "example.com" }
    const getter = { get: (name: string) => record[name as keyof typeof record] ?? null }
    highseat.track("account_created", undefined, { headers: record })
    highseat.track("account_created", undefined, { headers: getter })
    highseat.track("account_created", undefined, { headers: new Headers(record) })
    await highseat.flush()

    for (const event of getEvents()) {
      expect(event).toMatchObject({ ip: "198.51.100.5", user_agent: CHROME })
    }
  })

  test("an explicit visitor wins over the request's, and none is read without clientIp", async () => {
    const highseat = tracker()
    const request = new Request("https://example.com/", {
      headers: { "x-real-ip": "198.51.100.6", "user-agent": "curl/8" },
    })
    highseat.track("account_created", undefined, { request, userAgent: CHROME })
    highseat.track("account_created", undefined, { request, ip: "203.0.113.9" })
    await highseat.flush()

    expect(getEvent(0)).toMatchObject({ user_agent: CHROME })
    expect(getEvent(0).ip).toBeUndefined()
    expect(getEvent(1)).toMatchObject({ ip: "203.0.113.9", user_agent: "curl/8" })
    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/no clientIp set/)
  })

  test("keeps the id it is given, and dates an event by its timestamp", async () => {
    const highseat = tracker()
    highseat.track("invoice_paid", undefined, {
      eventId: "evt_1Q2w3E",
      timestamp: new Date(Date.now() - 60_000),
    })
    await highseat.flush()

    expect(getEvent().event_id).toBe("evt_1Q2w3E")
    expect(getEvent().age).toBeGreaterThanOrEqual(60_000)
  })

  test("batches events, at most 25 to a request", async () => {
    const highseat = tracker()
    for (let index = 0; index < 30; index++) highseat.track("tick", { index })
    await highseat.flush()

    expect(sent.map(request => request.events.length)).toEqual([25, 5])
  })

  test("sends on its own after the flush interval", async () => {
    const highseat = tracker({ flushInterval: 5 })
    highseat.track("account_created")
    for (let attempt = 0; attempt < 100 && !sent.length; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    expect(sent).toHaveLength(1)
  })

  test("sends at once and hands the send to waitUntil", async () => {
    const pending: Promise<unknown>[] = []
    const highseat = tracker({ flushInterval: 60_000 })
    highseat.track("account_created", undefined, { waitUntil: promise => pending.push(promise) })

    expect(pending).toHaveLength(1)
    await pending[0]
    expect(getEvent().event_name).toBe("account_created")
  })

  test("retries a busy or failing ingest under the same event id", async () => {
    answers = [
      () => new Response("busy", { status: 429, headers: { "retry-after": "0" } }),
      () => new Response("down", { status: 503, headers: { "retry-after": "0" } }),
    ]
    const highseat = tracker()
    highseat.track("account_created")
    await highseat.flush()

    expect(sent).toHaveLength(3)
    expect(new Set(getEvents().map(event => event.event_id)).size).toBe(1)
    expect(errors).toEqual([])
  })

  test("retries an unreachable ingest, then reports the batch", async () => {
    const highseat = tracker({
      maxRetries: 1,
      fetch: async () => {
        throw new TypeError("fetch failed")
      },
    })
    highseat.track("account_created", undefined, { eventId: "job-1" })
    await highseat.flush()

    expect(errors).toEqual([
      {
        type: "failed",
        message: "Highseat is unreachable.",
        status: undefined,
        events: [{ name: "account_created", eventId: "job-1" }],
      },
    ])
  })

  test("never retries a refusal, and reports what ingest said", async () => {
    answers = [() => Response.json({ error: "Invalid site secret" }, { status: 401 })]
    const highseat = tracker()
    highseat.track("account_created", undefined, { eventId: "job-2" })
    await highseat.flush()

    expect(sent).toHaveLength(1)
    expect(errors).toEqual([
      {
        type: "failed",
        message: "Invalid site secret",
        status: 401,
        events: [{ name: "account_created", eventId: "job-2" }],
      },
    ])
  })

  test("reports each event ingest rejected, by name and reason", async () => {
    answers = [
      () =>
        Response.json({
          ok: true,
          accepted: 1,
          rejected: 1,
          rejections: [{ index: 1, reason: "revenue.amount_not_integer" }],
        }),
    ]
    const highseat = tracker()
    highseat.track("account_created", undefined, { eventId: "a" })
    highseat.track("purchase", { revenue: { amount: 49.99, currency: "USD" } }, { eventId: "b" })
    await highseat.flush()

    expect(errors).toEqual([
      {
        type: "rejected",
        message: "Highseat rejected events.",
        status: 200,
        events: [{ name: "purchase", eventId: "b", reason: "revenue.amount_not_integer" }],
      },
    ])
  })

  test("reports each event ingest did not store, but never a recognised retry", async () => {
    answers = [
      () =>
        Response.json({
          ok: true,
          accepted: 0,
          rejected: 0,
          rejections: [],
          dropped: [
            { index: 0, reason: "foreign_hostname" },
            { index: 1, reason: "duplicate" },
          ],
        }),
    ]
    const highseat = tracker({ hostname: "preview.vercel.app" })
    highseat.track("account_created", undefined, { eventId: "a" })
    highseat.track("account_created", undefined, { eventId: "b" })
    await highseat.flush()

    expect(errors).toEqual([
      {
        type: "dropped",
        message: "Highseat did not store events.",
        status: 200,
        events: [{ name: "account_created", eventId: "a", reason: "foreign_hostname" }],
      },
    ])
  })

  test("sends one batch at a time, and a 429 holds back every batch behind it", async () => {
    let open = 0
    let mostOpen = 0
    let calls = 0
    const highseat = tracker({
      fetch: async (input, init) => {
        open++
        mostOpen = Math.max(mostOpen, open)
        await new Promise(resolve => setTimeout(resolve, 5))
        open--
        calls++
        if (calls === 1) return new Response(null, { status: 429, headers: { "retry-after": "0" } })
        return fakeFetch(input, init)
      },
    })
    for (let index = 0; index < 60; index++) highseat.track("tick", { index })
    await highseat.flush()

    expect(mostOpen).toBe(1)
    expect(sent.map(request => request.events.length)).toEqual([25, 25, 10])
    // The batch the 429 answered went first again, ahead of the rest.
    expect(getEvent(0).properties).toEqual({ index: "0" })
  })

  test("in an outage, keeps at most 1000 events, then stops at close's deadline", async () => {
    const highseat = tracker({
      // An ingest that never answers until the request is abandoned.
      fetch: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))
        }),
    })
    for (let index = 0; index < 1010; index++) {
      highseat.track("tick", undefined, { eventId: `e${index}` })
    }

    const overflow = errors.filter(error => error.message.includes("waiting to be sent"))
    expect(overflow.flatMap(error => error.events.map(event => event.eventId))).toEqual(
      Array.from({ length: 10 }, (_, index) => `e${1000 + index}`),
    )

    const started = Date.now()
    await highseat.close({ timeout: 20 })
    expect(Date.now() - started).toBeLessThan(1000)
    const [unsent] = errors.filter(error => error.message.startsWith("close() stopped"))
    expect(unsent?.type).toBe("failed")
    expect(unsent?.events).toHaveLength(1000)
  })

  test("sends what is queued on close, and nothing after it", async () => {
    const highseat = tracker({ flushInterval: 60_000 })
    highseat.track("account_created")
    await highseat.close()
    highseat.track("login")
    await highseat.flush()

    expect(getEvents().map(event => event.event_name)).toEqual(["account_created"])
  })

  test("never throws, even when onError does", async () => {
    answers = [() => new Response(null, { status: 400 })]
    const highseat = tracker({
      onError: () => {
        throw new Error("logger down")
      },
    })
    expect(() => highseat.track("account_created")).not.toThrow()
    await expect(highseat.flush()).resolves.toBeUndefined()
  })

  test("throws on a value that is not a site secret", () => {
    expect(() => tracker({ secret: "site_1" })).toThrow(/not a site secret/)
  })

  test("reads its credentials from the environment, and warns once without them", async () => {
    await withEnv({ HIGHSEAT_SITE: "site_env", HIGHSEAT_SECRET: "hs_secret_env" }, async () => {
      const highseat = createTracker({ hostname: "example.com", fetch: fakeFetch })
      highseat.track("account_created")
      await highseat.flush()
    })
    expect(sent[0]?.headers.get("x-site-id")).toBe("site_env")
    expect(sent[0]?.headers.get("x-hs-secret")).toBe("hs_secret_env")

    const highseat = createTracker({ fetch: fakeFetch })
    createTracker({ fetch: fakeFetch })
    highseat.track("account_created")
    await highseat.flush()
    expect(sent).toHaveLength(1)
    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/HIGHSEAT_SITE and HIGHSEAT_SECRET not set/)
  })
})

describe("track", () => {
  test("sends through a tracker made from the environment, over the global fetch", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = fakeFetch as typeof fetch

    try {
      await withEnv({ HIGHSEAT_SITE: "site_env", HIGHSEAT_SECRET: "hs_secret_env" }, async () => {
        track("account_created", { plan: "pro" }, { hostname: "example.com", userId: "u_1" })
        await flush()
      })
    } finally {
      globalThis.fetch = originalFetch
    }

    expect(sent[0]?.headers.get("x-site-id")).toBe("site_env")
    expect(getEvent()).toMatchObject({ event_name: "account_created", user_id: "u_1" })
  })
})
