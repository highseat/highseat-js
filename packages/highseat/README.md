# highseat

Highseat analytics for JavaScript: typed tracking, a first-party proxy and framework components.

> **Pre-release.** The `alpha` versions can change shape between releases. `createProxy()` is a placeholder and does nothing yet; use the proxy handler from your site's Installation settings.

## Install

```bash
npm install highseat@alpha
```

## Entry points

| Import | Contents | Needs |
| --- | --- | --- |
| `highseat` | `track()`, `identify()`, `getAttributionId()` and `inject()` | Nothing |
| `highseat/react` | `<Highseat />` | React |
| `highseat/next` | `<Highseat />` and `createProxy()` for Next.js | Next.js |
| `highseat/proxy` | `createProxy()`, a first-party proxy for any runtime with `fetch` | Nothing |

Each entry point loads on its own and imports no framework it does not name, so `highseat/proxy` runs in a Cloudflare Worker without React installed.

The package loads the tracker from Highseat, or from your site's proxy path, rather than bundling it. A call made before the tracker has loaded waits for it, and no call ever throws: on a server, with the tracker blocked, or with tracking off, it does nothing.

## Next.js

Set the site id from your site's Installation settings, and the proxy path if the site has one:

```bash
NEXT_PUBLIC_HIGHSEAT_SITE=site_…
HIGHSEAT_PATH=/3f9a0c1e2b
```

Then render `<Highseat />` once, in the root layout:

```tsx
// app/layout.tsx
import { Highseat } from "highseat/next"

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Highseat />
      </body>
    </html>
  )
}
```

The tracker counts each client-side navigation as one page view on its own.

## React

```tsx
import { Highseat } from "highseat/react"

<Highseat site="site_…" />
```

`src` takes the site's proxy path (`/3f9a0c1e2b`) for first-party delivery. `outbound={false}` and `downloads={false}` turn off the automatic link and download events, and `hashRouting` counts `#/route` changes as page views.

Without React, `inject({ site })` from `highseat` adds the same script tag.

## Events

```ts
import { identify, track } from "highseat"

track("signup")
track("purchase", { revenue: { amount: 4999, currency: "USD" }, order_id: order.id })
identify(user.id)
```

`revenue.amount` is an integer in the currency's smallest unit: 4999 is $49.99. With a payment provider connected, send `purchase` without `revenue`: the provider's webhook records the money, and revenue sent from the page as well would count the sale twice. Send `revenue` only for a checkout no provider reports, with an `order_id`, so a provider sale added later for the same order is not counted again. Event names are stored exactly as written, so `Purchase` and `purchase` are two events.

A few names are built in, with typed properties: `signup`, `login`, `purchase`, `subscription_started`, `trial_started`, `file_download`, `outbound_link_click` and `404`. Declare your own, and make a misspelt name a type error, by augmenting `Register` in any file your compiler sees:

```ts
declare module "highseat" {
  interface Register {
    events: {
      signup: { plan: "free" | "pro" }
      invite_sent: { role: "admin" | "member" }
    }
    strict: true
  }
}
```

Without `strict: true`, any other name still compiles as a custom event. The declarations are types only and add nothing to your bundle.

## Revenue attribution

`getAttributionId()` resolves to the id that joins a payment to the visit. Pass it to your checkout as `attribution_id` metadata. It resolves to `undefined` if the tracker has not loaded within three seconds, so a checkout that awaits it never hangs.

```ts
const attributionId = await getAttributionId()
await createCheckout({ metadata: { attribution_id: attributionId } })
```

## Support

Report a problem to [support@highseat.com](mailto:support@highseat.com). The source on GitHub, [highseat/highseat-js](https://github.com/highseat/highseat-js), is a read-only mirror and takes no issues or pull requests.
