import { getAttributionId, identify, inject, track } from "highseat"
import { withHighseat } from "highseat/next"
import type { HighseatProps as NextHighseatProps } from "highseat/next"
import { createProxy } from "highseat/proxy"
import type { HighseatProps } from "highseat/react"

declare module "highseat" {
  interface Register {
    events: {
      signup: { plan: "free" | "pro" }
      invite_sent: { role: "admin" | "member"; count?: number }
      newsletter_joined: {}
      settings_saved: { changes: { theme: string } }
    }
  }
}

// Built-in events.
track("login")
track("trial_started", { plan: "pro", seats: 3, trial: false, coupon: null })
track("purchase", { revenue: { amount: 4999, currency: "USD" }, plan: "pro" })
track("404")
track("file_download", { url: "https://example.com/guide.pdf" })

// A purchase a payment provider reports carries no revenue: the webhook records the money.
track("purchase", { checkout_id: "cs_1" })
track("purchase")

// A purchase no provider reports carries its revenue and the order it belongs to.
track("purchase", { revenue: { amount: 4900, currency: "USD" }, order_id: "o_1" })

// @ts-expect-error A revenue names its currency.
track("purchase", { revenue: { amount: 4900 }, order_id: "o_1" })

// @ts-expect-error A revenue amount is a number of minor units.
track("purchase", { revenue: { amount: "49.99", currency: "USD" } })

// @ts-expect-error A file download carries its url as a string.
track("file_download", { url: 42 })

// Registered events.
track("signup", { plan: "pro" })
track("invite_sent", { role: "admin" })
track("newsletter_joined")

// @ts-expect-error A registered event with a required property needs its properties.
track("signup")

// @ts-expect-error A registered property takes only its declared values.
track("signup", { plan: "enterprise" })

// @ts-expect-error A registered event takes only its declared properties.
track("invite_sent", { role: "member", source: "email" })

// @ts-expect-error A registered property has its declared type.
track("invite_sent", { role: "member", count: "3" })

// @ts-expect-error An event registered without properties takes none.
track("newsletter_joined", { source: "footer" })

// @ts-expect-error Properties are an object, not a string.
track("newsletter_joined", "footer")

// @ts-expect-error A registered property no event can carry, such as an object, cannot be sent.
track("settings_saved", { changes: { theme: "dark" } })

// Custom events, outside strict mode.
track("Signup")
track("video_played", { title: "Intro", seconds: 42, autoplay: false })
track("upgrade", { revenue: { amount: 1200, currency: "EUR" } })

const eventName: string = "from_a_variable"
track(eventName, { source: "cms" })

// @ts-expect-error An event name is a string.
track(42)

// @ts-expect-error A property value is a string, a number, a boolean or nullish.
track("video_played", { title: { text: "Intro" } })

// @ts-expect-error Properties are an object, not a string.
track("video_played", "Intro")

identify("user_1")
identify(42)
identify(null)
identify(undefined)

// @ts-expect-error A user id is required.
identify()

// @ts-expect-error A user id is a string or a number.
identify({ id: "user_1" })

void (getAttributionId() satisfies Promise<string | undefined>)
void getAttributionId({ timeout: 1000 })

inject({ site: "site_1" })
inject({ site: "site_1", src: "/3f9a0c1e2b", outbound: false, downloads: false, hashRouting: true })

// @ts-expect-error The site id is required.
inject({ src: "/3f9a0c1e2b" })

void ({ site: "site_1", src: "/3f9a0c1e2b" } satisfies HighseatProps)

// @ts-expect-error The React component needs the site id.
void ({ src: "/3f9a0c1e2b" } satisfies HighseatProps)

// The Next.js component reads the site id from the environment.
void ({} satisfies NextHighseatProps)
void ({ hashRouting: true } satisfies NextHighseatProps)

const proxy = createProxy({ secret: "hs_secret_1", clientIp: "vercel" })

// @ts-expect-error The client IP source is required: no header is safe on every host.
createProxy({ secret: "hs_secret_1" })

// @ts-expect-error The client IP preset names a supported host.
createProxy({ clientIp: "heroku" })

createProxy({ clientIp: request => request.headers.get("fly-client-ip") })

// A Worker's own fetch and a Pages Function's next both fit the fallback.
createProxy({ clientIp: "cloudflare", path: "/3f9a0c1e2b", fallback: fetch })

void (proxy(new Request("https://example.com/")) satisfies Promise<Response>)

// @ts-expect-error The handler takes a Request, not a URL string.
void proxy("https://example.com/")

// The config keeps its own type, so Next.js still checks every other field.
const config = withHighseat({ reactStrictMode: true, rewrites: async () => [] })
void (config.reactStrictMode satisfies boolean)
