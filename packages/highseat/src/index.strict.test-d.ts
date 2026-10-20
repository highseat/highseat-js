import { track } from "highseat"

// Strict mode is a property of the whole program, so this file compiles on its own, through
// `tsconfig.strict.json`, apart from the rest of the suite.
declare module "highseat" {
  interface Register {
    events: {
      signup: { plan: "free" | "pro" }
      invite_sent: { role: "admin" | "member" }
      [name: `view_${string}`]: { variant: string }
    }
    strict: true
  }
}

track("signup", { plan: "pro" })
track("login")
track("purchase", { revenue: { amount: 4999, currency: "USD" } })

// @ts-expect-error A misspelt registered name is not an event in strict mode.
track("singup", { plan: "pro" })

// @ts-expect-error A misspelt built-in name is not an event in strict mode.
track("purchse", { revenue: { amount: 4999, currency: "USD" } })

// @ts-expect-error Names are case-sensitive, so `Login` is not `login`.
track("Login")

const eventName: string = "from_a_variable"

// @ts-expect-error A plain string could be any name, so strict mode turns it away.
track(eventName)

declare const slug: string

// A template-literal key covers every name it matches, built at run time.
track(`view_${slug}`, { variant: "b" })

// @ts-expect-error A name the template matches still needs its properties.
track(`view_${slug}`)

// @ts-expect-error A name outside the template is not an event in strict mode.
track(`open_${slug}`, { variant: "b" })
