import { describe, expect, test } from "vitest"
import type { Tracker } from "./server"
import { createTestTracker } from "./testing"

// Site code under test: it takes any `Tracker`, as a real backend would.
function upgradePlan(tracker: Tracker, userId: string) {
  tracker.track("subscription_started", { plan: "pro", seats: 3 }, { userId })
}

describe("createTestTracker", () => {
  test("records an event from code that takes a Tracker", () => {
    const tracker = createTestTracker()

    upgradePlan(tracker, "user_1")

    expect(tracker.events).toEqual([
      {
        name: "subscription_started",
        properties: { plan: "pro", seats: 3 },
        options: { userId: "user_1" },
      },
    ])
  })

  test("keeps properties as passed, unconverted", () => {
    const tracker = createTestTracker()

    tracker.track("purchase", {
      plan: "pro",
      trial: false,
      coupon: null,
      revenue: { amount: 4999, currency: "USD" },
    })

    expect(tracker.events[0]?.properties).toEqual({
      plan: "pro",
      trial: false,
      coupon: null,
      revenue: { amount: 4999, currency: "USD" },
    })
  })

  test("records an event with no properties and no options", () => {
    const tracker = createTestTracker()

    tracker.track("login")

    expect(tracker.events).toEqual([{ name: "login", properties: undefined, options: {} }])
  })

  test("returns the events with one name, oldest first", () => {
    const tracker = createTestTracker()

    tracker.track("signup", { plan: "free" })
    tracker.track("login")
    tracker.track("signup", { plan: "pro" })

    expect(tracker.getEvents("signup").map(event => event.properties)).toEqual([
      { plan: "free" },
      { plan: "pro" },
    ])
  })

  test("returns an empty list for a name never tracked", () => {
    const tracker = createTestTracker()

    tracker.track("login")

    expect(tracker.getEvents("signup")).toEqual([])
  })

  test("forgets every event on reset", () => {
    const tracker = createTestTracker()
    tracker.track("login")

    tracker.reset()

    expect(tracker.events).toEqual([])
  })

  test("makes no request", async () => {
    const tracker = createTestTracker()
    const original = globalThis.fetch
    let requests = 0
    globalThis.fetch = async () => {
      requests++
      return new Response()
    }

    try {
      tracker.track("login", undefined, { userId: "user_1" })
      await tracker.flush()
      await tracker.close()
    } finally {
      globalThis.fetch = original
    }

    expect(requests).toBe(0)
  })

  test("records nothing after close, until reset", async () => {
    const tracker = createTestTracker()

    await tracker.close({ timeout: 1000 })
    tracker.track("login")
    expect(tracker.events).toEqual([])

    tracker.reset()
    tracker.track("login")
    expect(tracker.events).toHaveLength(1)
  })

  test("keeps the record when the caller changes its object afterwards", () => {
    const tracker = createTestTracker()
    const properties = { plan: "pro", revenue: { amount: 4999, currency: "USD" } }

    tracker.track("purchase", properties)
    properties.plan = "free"
    properties.revenue.amount = 0

    expect(tracker.events[0]?.properties).toEqual({
      plan: "pro",
      revenue: { amount: 4999, currency: "USD" },
    })
  })

  test("keeps the options as they were at the call", () => {
    const tracker = createTestTracker()
    const options = { userId: "user_1" }

    tracker.track("login", undefined, options)
    options.userId = "user_2"

    expect(tracker.events[0]?.options).toEqual({ userId: "user_1" })
  })

  test("hands out a copy of the events, so a test cannot change the record", () => {
    const tracker = createTestTracker()
    tracker.track("login")

    tracker.events.length = 0

    expect(tracker.events).toHaveLength(1)
  })
})
