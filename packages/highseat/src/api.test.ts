import { describe, expect, test } from "vitest"
import { createApi, HighseatApiError } from "./api"

interface Call {
  url: string
  init: RequestInit
}

/** A `fetch` that records its calls and answers with the given response. */
function createFetch(answer: () => Response) {
  const calls: Call[] = []

  async function fetch(url: string, init: RequestInit = {}) {
    calls.push({ url, init })
    return answer()
  }

  return { calls, fetch: fetch as typeof globalThis.fetch }
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
})
