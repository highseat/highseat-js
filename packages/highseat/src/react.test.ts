import { Window } from "happy-dom"
import { act, createElement, StrictMode, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import type { UserId } from "./index"
import { Highseat, useIdentify } from "./react"

interface Host {
  window?: unknown
  document?: unknown
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

interface IdentifyProps {
  userId: UserId
}

const host = globalThis as unknown as Host

let page: Window
let root: Root

function Identify({ userId }: IdentifyProps) {
  useIdentify(userId)
  return null
}

// Renders `element` under Strict Mode, which runs every effect twice on mount.
function render(element: ReactElement) {
  act(() => root.render(createElement(StrictMode, null, element)))
}

function findQueue() {
  return (page as unknown as { highseat?: { q?: unknown[] } }).highseat?.q
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

describe("Highseat", () => {
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
