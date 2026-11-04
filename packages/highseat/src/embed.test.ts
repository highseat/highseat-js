import { describe, expect, test } from "vitest"
import {
  EMBED_ORIGIN,
  EMBED_RESIZE_MESSAGE,
  findEmbedHeight,
  formatEmbedSrc,
  getFrameColorScheme,
} from "./embed"

const FRAME = {} as Window
const OTHER_FRAME = {} as Window

function createMessage(overrides: Partial<Pick<MessageEvent, "data" | "origin" | "source">> = {}) {
  return {
    origin: EMBED_ORIGIN,
    source: FRAME,
    data: { type: EMBED_RESIZE_MESSAGE, height: 342.2 },
    ...overrides,
  }
}

describe("formatEmbedSrc", () => {
  test("leaves the defaults out of the URL", () => {
    expect(formatEmbedSrc("abc", { theme: "system", background: "default" })).toBe(
      "https://app.highseat.com/share/abc?embed=1",
    )
  })

  test("adds a fixed theme and a transparent background", () => {
    expect(formatEmbedSrc("abc", { theme: "dark", background: "transparent" })).toBe(
      "https://app.highseat.com/share/abc?embed=1&theme=dark&background=transparent",
    )
  })

  test("keeps a token inside its path segment", () => {
    expect(formatEmbedSrc("a/b?c", { theme: "system", background: "default" })).toBe(
      "https://app.highseat.com/share/a%2Fb%3Fc?embed=1",
    )
  })
})

describe("getFrameColorScheme", () => {
  test("follows both schemes for the system theme", () => {
    expect(getFrameColorScheme("system")).toBe("light dark")
  })

  test("takes a fixed theme as written", () => {
    expect(getFrameColorScheme("dark")).toBe("dark")
  })
})

describe("findEmbedHeight", () => {
  test("rounds up the height of a message from the embed's own frame", () => {
    expect(findEmbedHeight(createMessage(), FRAME)).toBe(343)
  })

  test("ignores a message from another origin", () => {
    const message = createMessage({ origin: "https://evil.example" })

    expect(findEmbedHeight(message, FRAME)).toBeUndefined()
  })

  test("ignores a message from another frame on the embed's origin", () => {
    const message = createMessage({ source: OTHER_FRAME })

    expect(findEmbedHeight(message, FRAME)).toBeUndefined()
  })

  test("ignores every message while the frame is not on the page", () => {
    const message = createMessage({ source: null })

    expect(findEmbedHeight(message, null)).toBeUndefined()
    expect(findEmbedHeight(message, undefined)).toBeUndefined()
  })

  test.each([
    ["another type", { type: "other", height: 100 }],
    ["no data", null],
    ["a text height", { type: EMBED_RESIZE_MESSAGE, height: "100" }],
    ["a zero height", { type: EMBED_RESIZE_MESSAGE, height: 0 }],
    ["a negative height", { type: EMBED_RESIZE_MESSAGE, height: -1 }],
    ["an endless height", { type: EMBED_RESIZE_MESSAGE, height: Infinity }],
  ])("ignores a message with %s", (_name, data) => {
    expect(findEmbedHeight(createMessage({ data }), FRAME)).toBeUndefined()
  })
})
