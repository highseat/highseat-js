import { afterEach, describe, expect, test, vi } from "vitest"
import {
  getAttributionId,
  identify,
  inject,
  SCRIPT_URL,
  setBeforeSend,
  track,
  type BeforeSendEvent,
} from "./index"

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
function createScript(dataset: Record<string, string> = {}, src = ""): FakeScript {
  const listeners = new Set<ErrorListener>()
  const script: FakeScript = {
    src,
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

// `wait(0)` waits out the microtask a debug log is decided in.
function wait(milliseconds: number) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

afterEach(() => {
  // Clears the `debug` option a test passed to `inject`.
  host.document = createDocument()
  inject({ site: "site_reset" })
  delete host.window
  delete host.document
  vi.restoreAllMocks()
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

describe("debug", () => {
  test("logs each call and whether it was queued or sent", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    host.window = {}
    host.document = createDocument([createScript({ site: "site_1" })])
    inject({ site: "site_1", debug: true })

    track("signup", { plan: "pro" })
    identify("user_1")
    host.window.highseat = { track: () => {}, [LIVE]: true }
    track("login")
    await wait(0)

    expect(info.mock.calls).toEqual([
      ['highseat: track "signup", queued until the tracker loads', { plan: "pro" }],
      ['highseat: identify "user_1", queued until the tracker loads'],
      ['highseat: track "login", sent to the tracker'],
    ])
  })

  test("logs nothing when turned off, even for calls made before inject", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    host.window = {}
    host.document = createDocument()

    // A child component's effect runs before the effect of the `<Highseat />` around it.
    track("video_played")
    inject({ site: "site_1", debug: false })
    await wait(0)

    expect(info).not.toHaveBeenCalled()
  })

  test("logs by default in development", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    const { env } = process
    process.env = { ...env, NODE_ENV: "development" }
    host.window = { highseat: { track: () => {}, [LIVE]: true } }

    try {
      track("video_played")
      await wait(0)
    } finally {
      process.env = env
    }

    expect(info.mock.calls).toEqual([['highseat: track "video_played", sent to the tracker']])
  })

  test("logs nothing by default outside development", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    host.window = {}

    track("video_played")
    await wait(0)

    expect(info).not.toHaveBeenCalled()
  })

  test("warns once when the tracker script fails to load", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "info").mockImplementation(() => {})
    const scripts: FakeScript[] = []
    host.window = {}
    host.document = createDocument(scripts)
    inject({ site: "site_1", debug: true })

    scripts[0]?.fail()
    track("video_played")
    track("login")
    await wait(200)

    expect(warn.mock.calls).toEqual([[expect.stringContaining("failed to load")]])
  })

  test("warns once when the page has no tracker script", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "info").mockImplementation(() => {})
    host.window = {}
    host.document = createDocument()
    inject({ site: "site_1", debug: true })
    // Another tool's snippet, which carries a `data-site` of its own.
    host.document = createDocument([createScript({ site: "ABCDEFGH" })])

    track("video_played")
    track("login")
    await wait(3200)

    expect(warn.mock.calls).toEqual([[expect.stringContaining("no tracker script")]])
  })

  test("stays quiet once the tracker has loaded", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "info").mockImplementation(() => {})
    host.window = {}
    host.document = createDocument()
    inject({ site: "site_1", debug: true })

    host.window.highseat = { track: () => {}, [LIVE]: true }
    track("video_played")
    await wait(200)

    expect(warn).not.toHaveBeenCalled()
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

  test("waits for a tracker script with an older site's UUID id", async () => {
    const site = "2c2b8e5d-8d22-4a77-9def-f720b5292db1"

    for (const src of ["https://site.test/0c1c2f2993", "/0c1c2f2993", SCRIPT_URL]) {
      host.window = {}
      host.document = createDocument([createScript({ site }, src)])
      const id = getAttributionId()
      host.window.highseat = { getAttributionId: () => "attr_1", [LIVE]: true }

      await expect(id).resolves.toBe("attr_1")
    }
  })

  test("resolves undefined at once for a UUID id on another tool's script", async () => {
    host.window = {}
    host.document = createDocument([
      createScript(
        { site: "2c2b8e5d-8d22-4a77-9def-f720b5292db1" },
        "https://cdn.usefathom.com/script.js",
      ),
    ])
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

  test("sets the beforeSend hook before it adds the script", () => {
    const scripts: FakeScript[] = []
    let hookAtAppend: unknown
    host.window = {}
    host.document = {
      ...createDocument(scripts),
      head: {
        append: (script: FakeScript) => {
          hookAtAppend = host.window?.highseat?.beforeSend
          scripts.push(script)
        },
      },
    }

    inject({ site: "site_1", beforeSend: dropAdmin })

    expect(hookAtAppend).toBe(dropAdmin)
  })
})

function dropAdmin(event: BeforeSendEvent) {
  return event.url.includes("/admin/") ? null : event
}

describe("setBeforeSend", () => {
  test("sets the hook on the stub, for the tracker to pick up when it loads", () => {
    host.window = {}

    setBeforeSend(dropAdmin)

    expect(host.window.highseat?.beforeSend).toBe(dropAdmin)
  })

  test("replaces the hook on a running tracker, and clears it with undefined", () => {
    const tracker = { [LIVE]: true }
    host.window = { highseat: tracker }

    setBeforeSend(dropAdmin)
    expect(host.window.highseat).toBe(tracker)
    expect(tracker).toHaveProperty("beforeSend", dropAdmin)

    setBeforeSend(undefined)
    expect(tracker).toHaveProperty("beforeSend", undefined)
  })

  test("does nothing on a server", () => {
    expect(() => setBeforeSend(dropAdmin)).not.toThrow()
  })
})
