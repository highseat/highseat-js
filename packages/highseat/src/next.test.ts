import { afterEach, describe, expect, test, vi } from "vitest"
import { withHighseat } from "./next"

const PATH = "/3f9a0c1e2b"
const PROXY_REWRITE = { source: PATH, destination: "/api/highseat" }

afterEach(() => {
  vi.restoreAllMocks()
})

/** Runs `run` under another `NODE_ENV`, the mode `next build` and `next dev` set. */
async function withNodeEnv(mode: string, run: () => Promise<void>) {
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = mode

  try {
    await run()
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previous
  }
}

describe("withHighseat", () => {
  test("rewrites the proxy path to the route handler before any file is served", async () => {
    const config = withHighseat({}, { path: PATH })

    expect(await config.rewrites()).toEqual({ beforeFiles: [PROXY_REWRITE], afterFiles: [] })
  })

  test("keeps an array of rewrites in the phase Next.js gives it", async () => {
    const own = { source: "/blog/:slug", destination: "/posts/:slug" }
    const config = withHighseat({ rewrites: async () => [own] }, { path: PATH })

    expect(await config.rewrites()).toEqual({ beforeFiles: [PROXY_REWRITE], afterFiles: [own] })
  })

  test("puts the proxy first among the app's own beforeFiles rewrites", async () => {
    const own = { source: "/docs", destination: "/help" }
    const config = withHighseat(
      { rewrites: async () => ({ beforeFiles: [own], fallback: [own] }) },
      { path: PATH },
    )

    expect(await config.rewrites()).toEqual({
      beforeFiles: [PROXY_REWRITE, own],
      fallback: [own],
    })
  })

  test("rewrites to a route handler elsewhere in the app", async () => {
    const config = withHighseat({}, { path: PATH, route: "/stats" })

    expect(await config.rewrites()).toEqual({
      beforeFiles: [{ source: PATH, destination: "/stats" }],
      afterFiles: [],
    })
  })

  test("keeps the rest of the config", () => {
    expect(withHighseat({ reactStrictMode: true }, { path: PATH }).reactStrictMode).toBe(true)
  })

  test("adds the leading slash to a path written without one", async () => {
    const config = withHighseat({}, { path: "3f9a0c1e2b" })

    expect(await config.rewrites()).toEqual({ beforeFiles: [PROXY_REWRITE], afterFiles: [] })
  })

  test.skipIf(typeof process === "undefined")(
    "fails the production build without a proxy path",
    () =>
      withNodeEnv("production", async () => {
        await expect(withHighseat({}).rewrites()).rejects.toThrow(/HIGHSEAT_PATH/)
      }),
  )

  test.skipIf(typeof process === "undefined")(
    "warns once in development without a proxy path, and keeps the app's own config",
    () =>
      withNodeEnv("development", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const own = { source: "/blog/:slug", destination: "/posts/:slug" }
        const config = withHighseat({ reactStrictMode: true, rewrites: async () => [own] })

        expect(config.reactStrictMode).toBe(true)
        expect(await config.rewrites()).toEqual([own])
        expect(await config.rewrites()).toEqual([own])
        expect(warn).toHaveBeenCalledTimes(1)
        expect(warn.mock.calls[0]?.[0]).toMatch(/HIGHSEAT_PATH/)
      }),
  )
})
