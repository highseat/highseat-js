import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { createProxy } from "./proxy"
import type { ClientIpPreset, ProxyOptions } from "./proxy"

interface Forwarded {
  url: string
  method: string
  headers: Headers
  body: string
}

const SECRET = "hs_secret_test"
const PATH = "/3f9a0c1e2b"
const SITE = "https://site.test"
const OPTIONS = { path: PATH, secret: SECRET, clientIp: "cloudflare" } satisfies ProxyOptions

const originalFetch = globalThis.fetch
let forwarded: Forwarded[] = []
let respond: () => Response | Promise<Response>
let warn: ReturnType<typeof vi.spyOn>

// Every runtime reads `fetch` off the global when the handler calls it, so swapping the global
// stands in for ingest the same way on Node, Bun and workerd.
beforeEach(() => {
  // Most requests here carry no visitor IP, which the handler warns about.
  warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  forwarded = []
  respond = () => new Response("ok")
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body as Uint8Array<ArrayBuffer> | undefined
    forwarded.push({
      url: input instanceof Request ? input.url : input.toString(),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: body ? new TextDecoder().decode(body) : "",
    })
    return respond()
  }
})

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

function getForwarded(): Forwarded {
  const [request] = forwarded
  if (!request) throw new Error("The proxy never called fetch")
  return request
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

function sendEvent(headers: Record<string, string> = {}, body = '{"site":"site_1","events":[]}') {
  return new Request(`${SITE}${PATH}`, { method: "POST", body, headers })
}

describe("createProxy", () => {
  test("throws on a value that is not a site secret", () => {
    expect(() => createProxy({ ...OPTIONS, secret: "site_1" })).toThrow(/not a site secret/)
  })

  test("accepts a secret minted under an older prefix", async () => {
    for (const secret of ["hs_proxy_old", "ana_proxy_old"]) {
      await createProxy({ ...OPTIONS, secret })(new Request(`${SITE}${PATH}`))
    }

    expect(forwarded.map(({ headers }) => headers.get("x-hs-secret"))).toEqual([
      "hs_proxy_old",
      "ana_proxy_old",
    ])
  })

  test("adds the leading slash to a path written without one", async () => {
    await createProxy({ ...OPTIONS, path: "3f9a0c1e2b" })(new Request(`${SITE}${PATH}`))

    expect(getForwarded().url).toBe("https://cdn.highseat.com/script.js")
  })

  test("throws on a malformed upstream", () => {
    expect(() => createProxy({ ...OPTIONS, upstream: "cdn.highseat.com" })).toThrow()
  })

  test.skipIf(typeof process === "undefined")(
    "reads the path and the secret from the environment",
    () =>
      withEnv({ HIGHSEAT_PATH: PATH, HIGHSEAT_SECRET: SECRET }, async () => {
        const proxy = createProxy({ clientIp: "cloudflare" })
        await proxy(new Request(`${SITE}${PATH}`))

        expect(getForwarded().headers.get("x-hs-secret")).toBe(SECRET)
        expect((await proxy(new Request(`${SITE}/other`))).status).toBe(404)
      }),
  )

  test.skipIf(typeof process === "undefined")(
    "while Next.js builds, a malformed secret waits for the first request",
    () =>
      withEnv({ NEXT_PHASE: "phase-production-build" }, async () => {
        const proxy = createProxy({ ...OPTIONS, secret: "site_1" })

        await expect(proxy(new Request(`${SITE}${PATH}`))).rejects.toThrow(/not a site secret/)
        expect(forwarded).toHaveLength(0)
      }),
  )

  test.skipIf(typeof process === "undefined")(
    "while Next.js builds, a missing secret prints no warning",
    () =>
      withEnv({ NEXT_PHASE: "phase-production-build" }, async () => {
        createProxy({ path: PATH, clientIp: "vercel" })

        expect(warn).not.toHaveBeenCalled()
      }),
  )
})

// The warning is printed once per process, so every case that prints it sits in one test.
describe("without a path or a secret", () => {
  test("never throws, answers or passes requests through, and warns once", async () => {
    function page() {
      return new Response("page")
    }
    const noSecret = createProxy({ path: PATH, clientIp: "cloudflare" })
    const emptySecret = createProxy({ ...OPTIONS, secret: "" })
    const noPath = createProxy({ secret: SECRET, clientIp: "cloudflare", fallback: page })
    const noSecretWithFallback = createProxy({ path: PATH, clientIp: "cloudflare", fallback: page })

    for (const proxy of [noSecret, emptySecret]) {
      const response = await proxy(new Request(`${SITE}${PATH}`))
      expect(response.status).toBe(503)
      expect(response.headers.get("cache-control")).toBe("no-store")
      expect(await response.json()).toEqual({
        error: "The Highseat proxy is off: set HIGHSEAT_SECRET.",
      })
      expect((await proxy(new Request(`${SITE}/about`))).status).toBe(404)
    }

    for (const proxy of [noPath, noSecretWithFallback]) {
      for (const url of [`${SITE}${PATH}`, `${SITE}/about`]) {
        expect(await (await proxy(new Request(url, { method: "POST" }))).text()).toBe("page")
      }
    }

    expect(forwarded).toHaveLength(0)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toMatch(/HIGHSEAT_SECRET not set/)
  })
})

describe("routing", () => {
  test("a GET on the path loads the script from the ingest host", async () => {
    await createProxy(OPTIONS)(new Request(`${SITE}${PATH}`))

    expect(getForwarded().url).toBe("https://cdn.highseat.com/script.js")
    expect(getForwarded().method).toBe("GET")
  })

  test("a POST on the path forwards the events, body untouched", async () => {
    await createProxy(OPTIONS)(sendEvent())

    expect(getForwarded().url).toBe("https://cdn.highseat.com/api/event")
    expect(getForwarded().method).toBe("POST")
    expect(getForwarded().body).toBe('{"site":"site_1","events":[]}')
  })

  test("a HEAD on the path asks for the script's headers", async () => {
    await createProxy(OPTIONS)(new Request(`${SITE}${PATH}`, { method: "HEAD" }))

    expect(getForwarded().url).toBe("https://cdn.highseat.com/script.js")
    expect(getForwarded().method).toBe("HEAD")
  })

  test("another method is refused without reaching ingest", async () => {
    const response = await createProxy(OPTIONS)(new Request(`${SITE}${PATH}`, { method: "PUT" }))

    expect(response.status).toBe(405)
    expect(response.headers.get("allow")).toBe("GET, HEAD, POST")
    expect(forwarded).toHaveLength(0)
  })

  test("another path is a 404 without reaching ingest", async () => {
    const proxy = createProxy(OPTIONS)
    const response = await proxy(new Request(`${SITE}/api/highseat`, { method: "POST" }))

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: "Not the proxy path. The Highseat proxy answers on its own path only.",
    })
    expect((await proxy(new Request(`${SITE}/about`))).status).toBe(404)
    expect((await proxy(new Request(`${SITE}${PATH}/script.js`))).status).toBe(404)
    expect(forwarded).toHaveLength(0)
  })

  test("another path goes to the fallback when there is one", async () => {
    const proxy = createProxy({ ...OPTIONS, fallback: () => new Response("page", { status: 200 }) })
    const response = await proxy(new Request(`${SITE}/about`))

    expect(await response.text()).toBe("page")
    expect(forwarded).toHaveLength(0)
  })

  test("without a path, every request the host routes here is proxied", async () => {
    const { path: _path, ...options } = OPTIONS
    await createProxy(options)(new Request(`${SITE}/anything`))

    expect(getForwarded().url).toBe("https://cdn.highseat.com/script.js")
  })

  test("the query string never decides the path", async () => {
    await createProxy(OPTIONS)(new Request(`${SITE}${PATH}?v=2`))

    expect(getForwarded().url).toBe("https://cdn.highseat.com/script.js")
  })

  test("forwards to another upstream origin", async () => {
    await createProxy({ ...OPTIONS, upstream: "http://localhost:3001/" })(sendEvent())

    expect(getForwarded().url).toBe("http://localhost:3001/api/event")
  })
})

describe("headers to ingest", () => {
  test("adds the site secret and the visitor IP", async () => {
    await createProxy(OPTIONS)(sendEvent({ "cf-connecting-ip": "203.0.113.7" }))

    expect(getForwarded().headers.get("x-hs-secret")).toBe(SECRET)
    expect(getForwarded().headers.get("x-hs-client-ip")).toBe("203.0.113.7")
  })

  test("forwards the event headers ingest reads", async () => {
    await createProxy(OPTIONS)(
      sendEvent({
        "content-type": "text/plain",
        "user-agent": "Mozilla/5.0",
        origin: SITE,
      }),
    )

    expect(getForwarded().headers.get("content-type")).toBe("text/plain")
    expect(getForwarded().headers.get("user-agent")).toBe("Mozilla/5.0")
    expect(getForwarded().headers.get("origin")).toBe(SITE)
  })

  test("never forwards a visitor's credentials, referer or own x-hs-* headers", async () => {
    const visitor = {
      cookie: "session=1",
      authorization: "Bearer token",
      referer: `${SITE}/pricing`,
      "x-hs-secret": "hs_secret_stolen",
      "x-hs-client-ip": "198.51.100.1",
      "x-hs-ip": "198.51.100.1",
      "x-fp-secret": "legacy",
      "x-forwarded-for": "198.51.100.1",
      "cf-connecting-ip": "203.0.113.7",
    }
    const proxy = createProxy(OPTIONS)
    await proxy(sendEvent(visitor))
    await proxy(new Request(`${SITE}${PATH}`, { headers: visitor }))

    for (const { headers } of forwarded) {
      expect(headers.get("x-hs-secret")).toBe(SECRET)
      expect(headers.get("x-hs-client-ip")).toBe("203.0.113.7")
      for (const name of [
        "cookie",
        "authorization",
        "referer",
        "x-hs-ip",
        "x-fp-secret",
        "x-forwarded-for",
      ]) {
        expect(headers.get(name)).toBeNull()
      }
    }
  })

  test("asks ingest for an uncompressed body", async () => {
    await createProxy(OPTIONS)(
      new Request(`${SITE}${PATH}`, { headers: { "accept-encoding": "gzip, br" } }),
    )

    expect(getForwarded().headers.get("accept-encoding")).toBe("identity")
  })

  test("sends the script's If-None-Match upstream", async () => {
    await createProxy(OPTIONS)(
      new Request(`${SITE}${PATH}`, { headers: { "if-none-match": '"abc"' } }),
    )

    expect(getForwarded().headers.get("if-none-match")).toBe('"abc"')
  })
})

describe("client IP", () => {
  const presets: [ClientIpPreset, string][] = [
    ["vercel", "x-real-ip"],
    ["cloudflare", "cf-connecting-ip"],
    ["netlify", "x-nf-client-connection-ip"],
    ["nginx", "x-real-ip"],
  ]

  for (const [preset, header] of presets) {
    test(`${preset} reads ${header}`, async () => {
      await createProxy({ ...OPTIONS, clientIp: preset })(sendEvent({ [header]: " 203.0.113.7 " }))

      expect(getForwarded().headers.get("x-hs-client-ip")).toBe("203.0.113.7")
    })
  }

  test("a function reads it from anywhere", async () => {
    await createProxy({ ...OPTIONS, clientIp: () => "2001:db8::1" })(sendEvent())

    expect(getForwarded().headers.get("x-hs-client-ip")).toBe("2001:db8::1")
  })

  test("warns once per handler, naming the preset and its header, when the IP is empty", async () => {
    const proxy = createProxy({ ...OPTIONS, clientIp: "vercel" })
    await proxy(sendEvent())
    await proxy(sendEvent())

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toMatch(/"vercel" preset's x-real-ip header/)
  })

  test("does not warn while the IP is there", async () => {
    await createProxy(OPTIONS)(sendEvent({ "cf-connecting-ip": "203.0.113.7" }))

    expect(warn).not.toHaveBeenCalled()
  })

  test("never falls back to x-forwarded-for, which a visitor can write", async () => {
    await createProxy(OPTIONS)(sendEvent({ "x-forwarded-for": "198.51.100.1, 203.0.113.7" }))

    // Ingest answers an empty one 400, which shows the misconfigured proxy in the dashboard.
    expect(getForwarded().headers.get("x-hs-client-ip")).toBe("")
  })
})

describe("the script response", () => {
  test("keeps its validators and drops the encoding of a body the runtime decompressed", async () => {
    // Node, Bun and Deno decompress the body and keep both headers, as this response does.
    respond = () =>
      new Response("console.log(1)", {
        headers: {
          "content-type": "application/javascript",
          "content-encoding": "br",
          "content-length": "9",
          etag: '"abc"',
          "cache-control": "public, max-age=3600",
          "cloudflare-cdn-cache-control": "public, max-age=86400",
          vary: "Accept-Encoding",
          "set-cookie": "upstream=1",
          connection: "keep-alive",
          "keep-alive": "timeout=5",
        },
      })
    const response = await createProxy(OPTIONS)(new Request(`${SITE}${PATH}`))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe("console.log(1)")
    expect(response.headers.get("content-type")).toBe("application/javascript")
    expect(response.headers.get("etag")).toBe('"abc"')
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600")
    expect(response.headers.get("vary")).toBe("Accept-Encoding")
    for (const name of [
      "content-encoding",
      "content-length",
      "cloudflare-cdn-cache-control",
      "set-cookie",
      "connection",
      "keep-alive",
    ]) {
      expect(response.headers.get(name)).toBeNull()
    }
  })

  test("a 304 comes back as a 304 without a body", async () => {
    respond = () =>
      new Response(null, {
        status: 304,
        headers: { etag: '"abc"', "cache-control": "public, max-age=3600" },
      })
    const response = await createProxy(OPTIONS)(
      new Request(`${SITE}${PATH}`, { headers: { "if-none-match": '"abc"' } }),
    )

    expect(response.status).toBe(304)
    expect(response.body).toBeNull()
    expect(response.headers.get("etag")).toBe('"abc"')
  })
})

describe("the event response", () => {
  test("passes the status through and is never cached", async () => {
    respond = () =>
      Response.json(
        { ok: true },
        {
          status: 202,
          headers: { "cache-control": "public, max-age=60", "x-hs-ip": "203.0.113.7" },
        },
      )
    const response = await createProxy(OPTIONS)(sendEvent())

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ ok: true })
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(response.headers.get("x-hs-ip")).toBe("203.0.113.7")
  })

  test("forwards retry-after on a refusal", async () => {
    respond = () => new Response(null, { status: 429, headers: { "retry-after": "1" } })
    const response = await createProxy(OPTIONS)(sendEvent())

    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("1")
  })

  test("answers 502 when ingest cannot be reached", async () => {
    respond = () => {
      throw new TypeError("fetch failed")
    }
    const response = await createProxy(OPTIONS)(sendEvent())

    expect(response.status).toBe(502)
    expect(response.headers.get("cache-control")).toBe("no-store")
  })

  test("refuses an oversized batch without forwarding it", async () => {
    const response = await createProxy(OPTIONS)(sendEvent({}, "x".repeat(512 * 1024 + 1)))

    expect(response.status).toBe(413)
    expect(forwarded).toHaveLength(0)
  })
})
