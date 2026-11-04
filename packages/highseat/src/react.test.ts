import { Window } from "happy-dom"
import { act, createElement, StrictMode, type ReactElement } from "react"
import { createRoot, hydrateRoot, type Root } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { EMBED_ORIGIN, EMBED_RESIZE_MESSAGE } from "./embed"
import type { BeforeSend, BeforeSendEvent, UserId } from "./index"
import { Embed, Highseat, useBeforeSend, useIdentify, type EmbedProps } from "./react"

interface Host {
  window?: unknown
  document?: unknown
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

interface IdentifyProps {
  userId: UserId
}

interface RedactProps {
  beforeSend: BeforeSend
}

const host = globalThis as unknown as Host

let page: Window
let root: Root
let container: ReturnType<Window["document"]["createElement"]>

function Identify({ userId }: IdentifyProps) {
  useIdentify(userId)
  return null
}

function Redact({ beforeSend }: RedactProps) {
  useBeforeSend(beforeSend)
  return null
}

function dropAdmin(event: BeforeSendEvent) {
  return event.url.includes("/admin/") ? null : event
}

function keepAll(event: BeforeSendEvent) {
  return event
}

// Renders `element` under Strict Mode, which runs every effect twice on mount.
function render(element: ReactElement) {
  act(() => root.render(createElement(StrictMode, null, element)))
}

function renderEmbed(props: Partial<EmbedProps> = {}) {
  render(createElement(Embed, { token: "abc", title: "Visitors", ...props }))
}

function getFrame() {
  const frame = container.querySelector("iframe")
  if (!frame) throw new Error("The embed rendered no frame")
  return frame as unknown as HTMLIFrameElement
}

// happy-dom loads no page into a frame, so each frame gets a window of its own here.
function stubFrameWindow(frame: HTMLIFrameElement) {
  const frameWindow = {}
  Object.defineProperty(frame, "contentWindow", { value: frameWindow })
  return frameWindow
}

function postResize(height: unknown, origin: string, source: unknown) {
  const data = { type: EMBED_RESIZE_MESSAGE, height }
  const event = new page.MessageEvent("message", { data, origin })
  Object.defineProperty(event, "source", { value: source })
  act(() => void page.dispatchEvent(event))
}

function findGlobal() {
  return (page as unknown as { highseat?: { q?: unknown[]; beforeSend?: unknown } }).highseat
}

function findQueue() {
  return findGlobal()?.q
}

beforeEach(() => {
  // The page never fetches the tracker: only the script tag and the queue are under test.
  page = new Window({
    settings: {
      disableJavaScriptFileLoading: true,
      disableJavaScriptEvaluation: true,
      disableIframePageLoading: true,
    },
  })
  host.window = page
  host.document = page.document
  host.IS_REACT_ACT_ENVIRONMENT = true
  container = page.document.createElement("div")
  root = createRoot(container as unknown as Element)
})

afterEach(async () => {
  act(() => root.unmount())
  await page.happyDOM.close()
  delete host.window
  delete host.document
  delete host.IS_REACT_ACT_ENVIRONMENT
})

describe("useIdentify", () => {
  test("identifies each new value once under Strict Mode", () => {
    for (const userId of [undefined, "user_1", "user_1", 42, null, undefined]) {
      render(createElement(Identify, { userId }))
    }

    expect(findQueue()).toEqual([
      ["identify", ["user_1"]],
      ["identify", [42]],
      ["identify", [null]],
    ])
  })

  test("identifies the id it mounts with once under Strict Mode", () => {
    render(createElement(Identify, { userId: "user_1" }))

    expect(findQueue()).toEqual([["identify", ["user_1"]]])
  })
})

describe("useBeforeSend", () => {
  test("sets the hook while mounted and clears it on unmount", () => {
    render(createElement(Redact, { beforeSend: dropAdmin }))
    expect(findGlobal()?.beforeSend).toBe(dropAdmin)

    render(createElement(Redact, { beforeSend: keepAll }))
    expect(findGlobal()?.beforeSend).toBe(keepAll)

    act(() => root.render(null))
    expect(findGlobal()?.beforeSend).toBeUndefined()
  })

  test("leaves a hook another component set since alone", () => {
    render(createElement(Redact, { beforeSend: dropAdmin }))
    const api = findGlobal()
    if (api) api.beforeSend = keepAll

    act(() => root.render(null))
    expect(findGlobal()?.beforeSend).toBe(keepAll)
  })
})

describe("Highseat", () => {
  test("sets the beforeSend hook", () => {
    render(createElement(Highseat, { site: "site_1", beforeSend: dropAdmin }))

    expect(findGlobal()?.beforeSend).toBe(dropAdmin)
  })

  test("loads the tracker and identifies the user", () => {
    render(createElement(Highseat, { site: "site_1", userId: "user_1" }))
    render(createElement(Highseat, { site: "site_1", userId: "user_1" }))

    expect(page.document.head.querySelectorAll("script[data-site='site_1']")).toHaveLength(1)
    expect(findQueue()).toEqual([["identify", ["user_1"]]])
  })

  test("leaves the id alone without a user", () => {
    render(createElement(Highseat, { site: "site_1" }))

    expect(findQueue()).toBeUndefined()
  })
})

describe("Embed", () => {
  test("renders the credit link and no frame on the server", () => {
    const html = renderToString(createElement(Embed, { token: "abc", title: "Visitors" }))

    expect(html).toContain('href="https://highseat.com/?ref=embed"')
    expect(html).toContain(">Analytics by Highseat</a>")
    expect(html).not.toContain("nofollow")
    expect(html).not.toContain("<iframe")
  })

  test("holds the height of the widget's kind on the server", () => {
    const element = createElement(Embed, { token: "abc", title: "Visitors", widget: "chart" })

    expect(renderToString(element)).toContain("height:360px")
  })

  test("hydrates a theme the server did not know without a mismatch", () => {
    const errors: unknown[] = []
    const props = { token: "abc", title: "Visitors", widget: "chart" } as const
    const hydrated = page.document.createElement("div")
    hydrated.innerHTML = renderToString(createElement(Embed, props))

    let hydratedRoot: Root | undefined
    act(() => {
      hydratedRoot = hydrateRoot(
        hydrated as unknown as Element,
        createElement(Embed, { ...props, theme: "dark" }),
        { onRecoverableError: error => errors.push(error) },
      )
    })

    expect(errors).toEqual([])
    expect(hydrated.querySelector("iframe")?.getAttribute("src")).toContain("theme=dark")
    act(() => hydratedRoot?.unmount())
  })

  test("omits the credit link when asked", () => {
    const element = createElement(Embed, { token: "abc", title: "Visitors", credit: false })

    expect(renderToString(element)).not.toContain("<a")
  })

  test("lets a class replace the credit link's default style", () => {
    renderEmbed({ creditClassName: "credit" })

    const link = container.querySelector("a")
    expect(link?.className).toBe("credit")
    expect(link?.getAttribute("style")).toBeNull()
  })

  test("frames a widget with a transparent background and a matching scheme", () => {
    renderEmbed({ widget: "chart", theme: "dark" })

    const frame = getFrame()
    expect(frame.src).toBe(`${EMBED_ORIGIN}/share/abc?embed=1&theme=dark&background=transparent`)
    expect(frame.style.colorScheme).toBe("dark")
    expect(frame.style.height).toBe("360px")
  })

  test("frames a whole board with its own background at the board's height", () => {
    renderEmbed()

    const frame = getFrame()
    expect(frame.src).toBe(`${EMBED_ORIGIN}/share/abc?embed=1`)
    expect(frame.style.colorScheme).toBe("")
    expect(frame.style.height).toBe("1600px")
  })

  test("passes other attributes to the frame and a class to its box", () => {
    renderEmbed({ id: "traffic", loading: "eager", className: "box" })

    expect(getFrame().id).toBe("traffic")
    expect(getFrame().getAttribute("loading")).toBe("eager")
    expect(getFrame().parentElement?.className).toBe("box")
  })

  test("holds the slot until a null theme becomes known", () => {
    renderEmbed({ theme: null, height: 200 })
    expect(container.querySelector("iframe")).toBeNull()

    renderEmbed({ theme: "light", height: 200 })
    expect(getFrame().src).toContain("theme=light")
  })

  test("takes the height its own frame reports from the embed origin", () => {
    renderEmbed({ widget: "chart" })

    postResize(412.5, EMBED_ORIGIN, stubFrameWindow(getFrame()))

    expect(getFrame().style.height).toBe("413px")
  })

  test("ignores a resize from another origin", () => {
    renderEmbed({ widget: "chart" })

    postResize(412, "https://evil.example", stubFrameWindow(getFrame()))

    expect(getFrame().style.height).toBe("360px")
  })

  test("ignores a resize from another frame", () => {
    renderEmbed({ widget: "chart" })
    stubFrameWindow(getFrame())

    postResize(412, EMBED_ORIGIN, {})

    expect(getFrame().style.height).toBe("360px")
  })

  test("keeps the reported height across a theme change and replaces the frame", () => {
    renderEmbed({ widget: "chart", theme: "light" })
    const frame = getFrame()
    postResize(412, EMBED_ORIGIN, stubFrameWindow(frame))

    renderEmbed({ widget: "chart", theme: "dark" })

    expect(getFrame()).not.toBe(frame)
    expect(getFrame().style.height).toBe("412px")
  })

  test("stops listening on unmount", () => {
    const removeEventListener = vi.spyOn(page, "removeEventListener")
    renderEmbed({ widget: "chart" })

    act(() => root.render(null))

    expect(removeEventListener).toHaveBeenCalledWith("message", expect.any(Function))
  })
})
