import { describe, expect, test } from "vitest"
import { identify, track } from "./index"

describe("track", () => {
  test("accepts an event without properties", () => {
    expect(track("signup")).toBeUndefined()
  })

  test("accepts an event with properties", () => {
    expect(track("purchase", { plan: "pro", seats: 3, trial: false })).toBeUndefined()
  })
})

describe("identify", () => {
  test("accepts a user id", () => {
    expect(identify("user_1")).toBeUndefined()
  })
})
