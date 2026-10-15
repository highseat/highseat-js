import { afterEach, describe, expect, test } from "vitest"
import { syncIdentity } from "./identity"
import type { UserId } from "./index"

interface Host {
  window?: { highseat?: Record<string, unknown> }
}

const host = globalThis as unknown as Host

// A session that loads, re-renders, switches user, signs out and reloads.
const SESSION: UserId[] = [undefined, "user_1", "user_1", 42, null, undefined]

// Feeds each value through `syncIdentity` the way the hook's effect does.
function runSession(values: UserId[]) {
  let identified: UserId
  for (const value of values) identified = syncIdentity(identified, value)
}

afterEach(() => {
  delete host.window
})

describe("syncIdentity", () => {
  test("identifies each new value once, through to the tracker once it has loaded", () => {
    const calls: unknown[] = []
    host.window = { highseat: { identify: (id: unknown) => calls.push(id) } }

    runSession(SESSION)

    expect(calls).toEqual(["user_1", 42, null])
  })

  test("queues each new value once before the tracker loads", () => {
    host.window = {}

    runSession(SESSION)

    expect(host.window.highseat?.q).toEqual([
      ["identify", ["user_1"]],
      ["identify", [42]],
      ["identify", [null]],
    ])
  })

  test("clears the id when the first known value is signed out", () => {
    host.window = {}

    runSession([undefined, null, null])

    expect(host.window.highseat?.q).toEqual([["identify", [null]]])
  })

  test("keeps the last id while the session reloads", () => {
    host.window = {}

    runSession(["user_1", undefined, "user_1"])

    expect(host.window.highseat?.q).toEqual([["identify", ["user_1"]]])
  })

  test("does nothing on a server", () => {
    expect(() => runSession(SESSION)).not.toThrow()
  })
})
