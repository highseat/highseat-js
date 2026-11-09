import { describe, expect, test } from "vitest"
import { createApi, HighseatApiError } from "./api"

interface Call {
  url: string
  init: RequestInit
}

/** Two pages of `getPages`, by the cursor that reads each. */
const PAGES: Record<string, { data: { path: string }[]; nextCursor: string | null }> = {
  first: { data: [{ path: "/" }, { path: "/pricing" }], nextCursor: "second" },
  second: { data: [{ path: "/blog" }], nextCursor: null },
}

/** A `fetch` that records its calls and answers with the given response. */
function createFetch(answer: (call: Call, index: number) => Response) {
  const calls: Call[] = []

  async function fetch(url: string, init: RequestInit = {}) {
    const call = { url, init }
    calls.push(call)
    return answer(call, calls.length - 1)
  }

  return { calls, fetch: fetch as typeof globalThis.fetch }
}

/** A `fetch` answer refusing the call with `429`. */
function refuse(code: string, retryAfter?: string) {
  const headers = retryAfter === undefined ? undefined : { "Retry-After": retryAfter }
  return Response.json({ error: { code } }, { status: 429, headers })
}

function readHeader(call: Call | undefined, name: string) {
  return new Headers(call?.init.headers).get(name)
}

describe("createApi", () => {
  test("sends the token and answers the body", async () => {
    const { calls, fetch } = createFetch(() => Response.json({ data: { visitors: 3 } }))
    const api = createApi({ token: "hs_live_one", fetch })

    const answer = await api.get("/sites/{site}/realtime", { path: { site: "example.com" } })

    expect(answer.data.visitors).toBe(3)
    expect(calls[0]?.url).toBe("https://api.highseat.com/v1/sites/example.com/realtime")
    expect(readHeader(calls[0], "authorization")).toBe("Bearer hs_live_one")
  })

  test("asks a token function before every call", async () => {
    const { calls, fetch } = createFetch(() => Response.json({ data: [], nextCursor: null }))
    const tokens = ["first", "second"]
    const api = createApi({ token: async () => tokens.shift() ?? "", fetch })

    await api.get("/sites")
    await api.get("/sites")

    expect(calls.map(call => readHeader(call, "authorization"))).toEqual([
      "Bearer first",
      "Bearer second",
    ])
  })

  test("encodes the path, repeats a list and leaves out an absent value", async () => {
    const { calls, fetch } = createFetch(() => Response.json({ data: [] }))
    const api = createApi({ token: "key", baseUrl: "https://api.test/v1", fetch })

    await api.get("/sites/{site}/pages", {
      path: { site: "a/b" },
      query: { filter: ["country:PL", "device:mobile"], cursor: undefined },
    })

    expect(calls[0]?.url).toBe(
      "https://api.test/v1/sites/a%2Fb/pages?filter=country%3APL&filter=device%3Amobile",
    )
  })

  test("generates an idempotency key for a POST without one", async () => {
    const { calls, fetch } = createFetch(() => Response.json({ data: {} }, { status: 201 }))
    const api = createApi({ token: "key", fetch })

    await api.post("/sites", { body: { name: "Example", domain: "example.com" } })
    await api.get("/sites")

    expect(readHeader(calls[0], "idempotency-key")).toMatch(/^[\da-f-]{36}$/)
    expect(readHeader(calls[1], "idempotency-key")).toBeNull()
  })

  test("sends a body as JSON with its idempotency key", async () => {
    const { calls, fetch } = createFetch(() => Response.json({ data: {} }, { status: 201 }))
    const api = createApi({ token: "key", fetch })

    await api.post("/sites", {
      body: { name: "Example", domain: "example.com" },
      idempotencyKey: "once",
    })

    expect(calls[0]?.init.method).toBe("POST")
    expect(calls[0]?.init.body).toBe(JSON.stringify({ name: "Example", domain: "example.com" }))
    expect(readHeader(calls[0], "content-type")).toBe("application/json")
    expect(readHeader(calls[0], "idempotency-key")).toBe("once")
  })

  test("answers nothing for a 204", async () => {
    const { fetch } = createFetch(() => new Response(null, { status: 204 }))
    const api = createApi({ token: "key", fetch })

    const answer = await api.delete("/sites/{site}/notes/{id}", {
      path: { site: "example.com", id: "note_one" },
    })

    expect(answer).toBeUndefined()
  })

  test("throws the API's failure", async () => {
    const error = { code: "RATE_LIMITED", message: "Slow down.", requestId: "req_one" }
    const { fetch } = createFetch(() => Response.json({ error }, { status: 429 }))
    const api = createApi({ token: "key", fetch })

    const failure = await api.get("/credential").catch((caught: unknown) => caught)

    expect(failure).toBeInstanceOf(HighseatApiError)
    expect(failure).toMatchObject({ status: 429, ...error })
  })

  test("throws for a failure without a JSON body", async () => {
    const { fetch } = createFetch(() => new Response("Bad gateway", { status: 502 }))
    const api = createApi({ token: "key", fetch })

    await expect(api.get("/credential")).rejects.toMatchObject({
      status: 502,
      code: "INTERNAL_SERVER_ERROR",
      message: "The Highseat API answered 502.",
    })
  })

  test("retries a 429 with a short Retry-After once, with the same idempotency key", async () => {
    const { calls, fetch } = createFetch((_call, index) =>
      index === 0
        ? refuse("RATE_LIMITED", "0")
        : Response.json({ data: { id: "note_one" } }, { status: 201 }),
    )
    const api = createApi({ token: "key", fetch })

    const answer = await api.createNote({
      site: "example.com",
      body: { date: "2026-11-09", text: "Launch" },
    })

    expect(answer.data.id).toBe("note_one")
    expect(calls).toHaveLength(2)
    expect(readHeader(calls[1], "idempotency-key")).toBe(readHeader(calls[0], "idempotency-key"))
    expect(calls[1]?.init.body).toBe(calls[0]?.init.body)
  })

  test("retries too many concurrent calls when no Retry-After came through", async () => {
    const { calls, fetch } = createFetch((_call, index) =>
      index === 0 ? refuse("TOO_MANY_CONCURRENT_REQUESTS") : Response.json({ data: {} }),
    )
    const api = createApi({ token: "key", fetch })

    await api.getCredential()

    expect(calls).toHaveLength(2)
  })

  test("retries only once", async () => {
    const { calls, fetch } = createFetch(() => refuse("RATE_LIMITED", "0"))
    const api = createApi({ token: "key", fetch })

    await expect(api.getCredential()).rejects.toMatchObject({ status: 429, code: "RATE_LIMITED" })
    expect(calls).toHaveLength(2)
  })

  test("throws a 429 with a long Retry-After without retrying", async () => {
    const { calls, fetch } = createFetch(() => refuse("RATE_LIMITED", "3600"))
    const api = createApi({ token: "key", fetch })

    await expect(api.getCredential()).rejects.toMatchObject({ status: 429, code: "RATE_LIMITED" })
    expect(calls).toHaveLength(1)
  })
})

describe("named methods", () => {
  test("put path parameters in the path and the rest in the query", async () => {
    const { calls, fetch } = createFetch(() => Response.json({ data: {}, meta: {} }))
    const api = createApi({ token: "key", baseUrl: "https://api.test/v1", fetch })

    await api.getOverview({ site: "example.com", period: "30d", filter: ["country:PL"] })

    expect(calls[0]?.init.method).toBe("GET")
    expect(calls[0]?.url).toBe(
      "https://api.test/v1/sites/example.com/overview?period=30d&filter=country%3APL",
    )
  })

  test("send a write's body and method", async () => {
    const { calls, fetch } = createFetch(() => Response.json({ data: {} }))
    const api = createApi({ token: "key", fetch })

    await api.updateNote({ site: "example.com", id: "note_one", body: { text: "Relaunch" } })

    expect(calls[0]?.init.method).toBe("PATCH")
    expect(calls[0]?.url).toBe("https://api.highseat.com/v1/sites/example.com/notes/note_one")
    expect(calls[0]?.init.body).toBe(JSON.stringify({ text: "Relaunch" }))
  })
})

describe("paginate", () => {
  function answerPage({ url }: Call) {
    const cursor = new URL(url).searchParams.get("cursor") ?? "first"
    return Response.json({ ...PAGES[cursor], meta: {} })
  }

  test("walks every cursor page with the same parameters", async () => {
    const { calls, fetch } = createFetch(answerPage)
    const api = createApi({ token: "key", baseUrl: "https://api.test/v1", fetch })
    const paths: string[] = []

    for await (const row of api.paginate.getPages({ site: "example.com", limit: 2 })) {
      paths.push(row.path)
    }

    expect(paths).toEqual(["/", "/pricing", "/blog"])
    expect(calls.map(call => call.url)).toEqual([
      "https://api.test/v1/sites/example.com/pages?limit=2",
      "https://api.test/v1/sites/example.com/pages?limit=2&cursor=second",
    ])
  })

  test("collects every page", async () => {
    const { fetch } = createFetch(answerPage)
    const api = createApi({ token: "key", fetch })

    const rows = await api.paginate.getPages({ site: "example.com" }).toArray()

    expect(rows.map(row => row.path)).toEqual(["/", "/pricing", "/blog"])
  })

  test("reads the next page only when the loop asks for it", async () => {
    const { calls, fetch } = createFetch(answerPage)
    const api = createApi({ token: "key", fetch })

    for await (const row of api.paginate.getPages({ site: "example.com" })) {
      expect(row.path).toBe("/")
      break
    }

    expect(calls).toHaveLength(1)
  })
})
