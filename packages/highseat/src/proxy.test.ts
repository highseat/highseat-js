import { describe, expect, test } from "vitest"
import { createProxy } from "./proxy"

describe("createProxy", () => {
  test("returns a handler that answers a request with a response", async () => {
    const proxy = createProxy()
    const response = await proxy(new Request("https://example.com/script.js"))

    expect(response).toBeInstanceOf(Response)
    expect(response.status).toBe(501)
  })
})
