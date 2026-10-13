import { afterEach, describe, expect, test } from "vitest"
import { getAttributionId, identify, inject, SCRIPT_URL, track } from "./index"

type ErrorListener = (event: { currentTarget: FakeScript }) => void

interface FakeScript {
  src: string
  dataset: Record<string, string>
  addEventListener: (type: string, listener: ErrorListener) => void
  /** Fires `error`, as a script an ad blocker stopped does. */
  fail: () => void
}

interface Host {
  window?: { highseat?: Record<string | symbol, unknown> }
  document?: unknown
}

const host = globalThis as unknown as Host
const LIVE = Symbol.for("highseat")

// A script tag with the parts the client reads: its attributes and its `error` listeners, which,
// as in a browser, a listener added twice joins once.
function createScript(dataset: Record<string, string> = {}): FakeScript {
  const listeners = new Set<ErrorListener>()
  const script: FakeScript = {
    src: "",
    dataset,
    addEventListener: (type, listener) => type === "error" && listeners.add(listener),
    fail: () => listeners.forEach(listener => listener({ currentTarget: script })),
  }
  return script
}

// The parts of a document the client touches, with a plain array standing in for the page's scripts.
function createDocument(scripts: FakeScript[] = []) {
  return {
    scripts,
    head: { append: (script: FakeScript) => scripts.push(script) },
    createElement: () => createScript(),
  }
}

afterEach(() => {
  delete host.window
  delete host.document
})

describe("track and identify", () => {
  test("queue on the stub until the tracker replaces it", () => {
    host.window = {}

    identify("user_1")
    track("login")
    track("video_played", { seconds: 42 })

    expect(host.window.highseat?.q).toEqual([
      ["identify", ["user_1"]],
      ["track", ["login"]],
      ["track", ["video_played", { seconds: 42 }]],
    ])
  })

  test("call through to the tracker once it has loaded", () => {
    const calls: unknown[][] = []
    host.window = {
      highseat: {
        track: (...args: unknown[]) => calls.push(["track", ...args]),
        identify: (...args: unknown[]) => calls.push(["identify", ...args]),
      },
    }

    identify(null)
    track("purchase", { revenue: { amount: 4999, currency: "USD" } })

    expect(calls).toEqual([
      ["identify", null],
      ["track", "purchase", { revenue: { amount: 4999, currency: "USD" } }],
    ])
  })

  test("swallow an error the tracker throws", () => {
    host.window = {
      highseat: {
        track: () => {
          throw new Error("broken")
        },
      },
    }

    expect(() => track("login")).not.toThrow()
  })

  test("do nothing on a server", () => {
    expect(() => identify("user_1")).not.toThrow()
    expect(() => track("404")).not.toThrow()
  })
})

describe("getAttributionId", () => {
  test("resolves the tracker's id once it has loaded", async () => {
    host.window = {}
    host.document = createDocument([createScript({ site: "site_1" })])
    const id = getAttributionId()
    host.window.highseat = { getAttributionId: () => "attr_1", [LIVE]: true }

    await expect(id).resolves.toBe("attr_1")
  })

  test("ignores a stub that is not the tracker", async () => {
    host.window = { highseat: { getAttributionId: () => "not_ours" } }
    host.document = createDocument([createScript({ site: "site_1" })])

    await expect(getAttributionId({ timeout: 0 })).resolves.toBeUndefined()
  })

  test("waits out the timeout while the tracker script is still loading", async () => {
    host.window = {}
    host.document = createDocument([createScript({ site: "site_1" })])
    const started = Date.now()

    await expect(getAttributionId({ timeout: 100 })).resolves.toBeUndefined()
    expect(Date.now() - started).toBeGreaterThanOrEqual(100)
  })

  test("resolves undefined at once when the script inject added fails to load", async () => {
    const scripts: FakeScript[] = []
    host.window = {}
    host.document = createDocument(scripts)
    inject({ site: "site_1" })
    const started = Date.now()
    const id = getAttributionId()

    scripts[0]?.fail()

    await expect(id).resolves.toBeUndefined()
    expect(Date.now() - started).toBeLessThan(1000)
  })

  test("resolves undefined at once when the page's own tracker script fails to load", async () => {
    const script = createScript({ site: "site_1" })
    host.window = {}
    host.document = createDocument([script])
    const started = Date.now()
    const id = getAttributionId()

    script.fail()

    await expect(id).resolves.toBeUndefined()
    expect(Date.now() - started).toBeLessThan(1000)
  })

  test("resolves undefined at once when the page has no tracker script", async () => {
    host.window = {}
    // Another tool's snippet, which carries a `data-site` of its own.
    host.document = createDocument([createScript({ site: "ABCDEFGH" })])
    const started = Date.now()

    await expect(getAttributionId()).resolves.toBeUndefined()
    expect(Date.now() - started).toBeLessThan(1000)
  })

  test("resolves undefined on a server", async () => {
    await expect(getAttributionId()).resolves.toBeUndefined()
  })
})

describe("inject", () => {
  test("adds the script with the site's options", () => {
    const scripts: FakeScript[] = []
    host.document = createDocument(scripts)

    inject({ site: "site_1", src: "/3f9a0c1e2b", outbound: false, hashRouting: true })

    expect(scripts.map(({ src, dataset }) => ({ src, dataset }))).toEqual([
      { src: "/3f9a0c1e2b", dataset: { site: "site_1", outbound: "false", hashRouting: "" } },
    ])
  })

  test("loads from Highseat's host without a proxy path", () => {
    const scripts: FakeScript[] = []
    host.document = createDocument(scripts)

    inject({ site: "site_1" })

    expect(scripts[0]?.src).toBe(SCRIPT_URL)
  })

  test("adds one script when a component mounts again", () => {
    const scripts: FakeScript[] = []
    host.document = createDocument(scripts)

    inject({ site: "site_1" })
    inject({ site: "site_1" })

    expect(scripts).toHaveLength(1)
  })

  test("leaves a script tag the page already has alone", () => {
    const scripts = [createScript({ site: "site_1" })]
    host.document = createDocument(scripts)

    inject({ site: "site_1", src: "/3f9a0c1e2b" })

    expect(scripts).toHaveLength(1)
  })

  test("does nothing on a server", () => {
    expect(() => inject({ site: "site_1" })).not.toThrow()
  })
})
