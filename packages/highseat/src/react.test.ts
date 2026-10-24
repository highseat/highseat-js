import { Window } from "happy-dom"
import { act, createElement, StrictMode, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import type { BeforeSend, BeforeSendEvent, UserId } from "./index"
import { Highseat, useBeforeSend, useIdentify } from "./react"

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

function findGlobal() {
  return (page as unknown as { highseat?: { q?: unknown[]; beforeSend?: unknown } }).highseat
}

function findQueue() {
  return findGlobal()?.q
}

beforeEach(() => {
  // The page never fetches the tracker: only the script tag and the queue are under test.
  page = new Window({
    settings: { disableJavaScriptFileLoading: true, disableJavaScriptEvaluation: true },
  })
  host.window = page
  host.document = page.document
  host.IS_REACT_ACT_ENVIRONMENT = true
  root = createRoot(page.document.createElement("div") as unknown as Element)
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
