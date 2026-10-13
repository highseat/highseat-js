import { identify, track } from "highseat"
import type { HighseatProps } from "highseat/next"
import { createProxy } from "highseat/proxy"

track("signup")
track("purchase", { plan: "pro", seats: 3, trial: false })

// @ts-expect-error An event name is a string.
track(42)

// @ts-expect-error A property value is a string, a number or a boolean.
track("signup", { plan: { name: "pro" } })

identify("user_1")

// @ts-expect-error A user id is required.
identify()

void ({ site: "site_1", src: "/stats.js" } satisfies HighseatProps)

// @ts-expect-error The site id is required.
void ({ src: "/stats.js" } satisfies HighseatProps)

const proxy = createProxy({ secret: "hs_secret_1" })

void (proxy(new Request("https://example.com/")) satisfies Promise<Response>)

// @ts-expect-error The handler takes a Request, not a URL string.
void proxy("https://example.com/")
