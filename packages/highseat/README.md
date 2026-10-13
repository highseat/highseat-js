# highseat

Highseat analytics for JavaScript: typed tracking, a first-party proxy and framework components.

> **Pre-release.** The `alpha` versions can change shape between releases.

## Install

```bash
npm install highseat@alpha
```

## Entry points

| Import | Contents | Needs |
| --- | --- | --- |
| `highseat` | `track()`, `identify()`, `getAttributionId()` and `inject()` | Nothing |
| `highseat/react` | `<Highseat />` | React |
| `highseat/next` | `<Highseat />`, `createProxy()` and `withHighseat()` for Next.js | Next.js |
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

## First-party proxy

The proxy serves the tracker and forwards its events from your own domain, on the site's own path, so a filter list that blocks Highseat's host does not block your site. A `GET` on the path serves the script and a `POST` forwards events. The proxy sends the visitor's IP under your site secret, which a rewrite or a redirect rule cannot do: without it, every visitor would get your server's country.

Set two environment variables from your site's Installation settings:

```bash
HIGHSEAT_PATH=/3f9a0c1e2b        # the site's proxy path
HIGHSEAT_SECRET=hs_secret_...    # the site secret
```

Then load the tracker from the path. In Next.js, `<Highseat />` reads `HIGHSEAT_PATH` itself. Elsewhere, pass `src="/3f9a0c1e2b"` to `<Highseat />` or `inject()`, or use the script tag from Installation settings.

To rotate the path, rotate it in Installation settings, update `HIGHSEAT_PATH` and the snippet, and redeploy. On a host whose route is a file or a config entry (Netlify, Vercel without Next.js, Astro), move that route too.

### Options

`createProxy(options)` returns a `(request: Request) => Promise<Response>` handler.

| Option | Default | |
| --- | --- | --- |
| `clientIp` | Required | Where the visitor's IP comes from: `"vercel"`, `"cloudflare"`, `"netlify"`, `"nginx"` (the `X-Real-IP` header your nginx sets), or a function `(request) => string`. The outermost proxy that sets the header decides the preset: behind a proxied Cloudflare record, use `"cloudflare"` on any origin (Next.js, TanStack Start, a Node server, with or without Traefik or nginx in between), whose `X-Real-IP` holds a Cloudflare edge address. A visitor can write any header the host does not overwrite, so there is no default and no fallback to `X-Forwarded-For`. |
| `path` | `HIGHSEAT_PATH` | The proxy path. Any other path answers 404, or goes to `fallback`. Leave it unset where your router already sends only the proxy path to the handler. |
| `secret` | `HIGHSEAT_SECRET` | The site secret. An older secret that starts `hs_proxy_` or `ana_proxy_` works too. `createProxy()` throws without one. |
| `upstream` | `https://cdn.highseat.com` | The Highseat ingest origin. |
| `fallback` | None | Answers every other path, for a handler that sees every request on the site. |

### Next.js

```ts
// app/api/highseat/route.ts
import { createProxy } from "highseat/next"

const proxy = createProxy({ clientIp: "vercel" })

export { proxy as GET, proxy as POST }
```

```ts
// next.config.ts
import { withHighseat } from "highseat/next"

export default withHighseat({
  // Your own config.
})
```

Next.js loads `next.config.ts` with `require`, and the package is ES modules only, so the config needs Node 20.19 or 22.12 and later, the versions that `require` an ES module without a flag.

`withHighseat()` rewrites `HIGHSEAT_PATH` to the route handler inside the app, so the visitor's IP survives and the route file never moves. Pass `{ route: "/stats" }` for a handler elsewhere. Without `HIGHSEAT_PATH`, `next build` fails, while `next dev` warns once and runs without the proxy. Off Vercel, the outermost proxy that sets the header decides the preset: `"cloudflare"` behind a proxied Cloudflare record, even with nginx or Traefik in between, and `"nginx"` behind nginx alone.

### Cloudflare Worker

```ts
import { createProxy } from "highseat/proxy"

interface Env {
  HIGHSEAT_PATH: string
  HIGHSEAT_SECRET: string
}

export default {
  fetch(request: Request, env: Env) {
    const proxy = createProxy({
      path: env.HIGHSEAT_PATH,
      secret: env.HIGHSEAT_SECRET,
      clientIp: "cloudflare",
      fallback: fetch,
    })
    return proxy(request)
  },
}
```

Route the Worker on `yoursite.com/*`: `fallback: fetch` passes every other request on to your origin. Set the secret with `wrangler secret put HIGHSEAT_SECRET`.

### Cloudflare Pages

```ts
// functions/[path].ts
import { createProxy } from "highseat/proxy"

interface Env {
  HIGHSEAT_PATH: string
  HIGHSEAT_SECRET: string
}

export const onRequest: PagesFunction<Env> = ({ request, env, next }) => {
  const proxy = createProxy({
    path: env.HIGHSEAT_PATH,
    secret: env.HIGHSEAT_SECRET,
    clientIp: "cloudflare",
    fallback: next,
  })
  return proxy(request)
}
```

The function sees each one-segment path, and `next` serves your site for every path but the proxy's. Add both variables in the Pages project's settings.

### Netlify

```ts
// netlify/functions/highseat.ts
import { createProxy } from "highseat/proxy"

export const config = { path: "/3f9a0c1e2b" }

export default createProxy({ clientIp: "netlify" })
```

Netlify reads `config.path` from the source, so it cannot come from an environment variable. Set only `HIGHSEAT_SECRET`.

### Vercel without Next.js

```ts
// api/highseat.ts
import { createProxy } from "highseat/proxy"

const proxy = createProxy({ clientIp: "vercel" })

export { proxy as GET, proxy as POST }
```

```json
// vercel.json
{ "rewrites": [{ "source": "/3f9a0c1e2b", "destination": "/api/highseat" }] }
```

The rewrite carries the path, so set only `HIGHSEAT_SECRET`.

### Astro

```ts
// src/pages/3f9a0c1e2b.ts
import type { APIRoute } from "astro"
import { createProxy } from "highseat/proxy"

export const prerender = false

export const ALL: APIRoute = ({ request, clientAddress }) =>
  createProxy({ clientIp: () => clientAddress })(request)
```

Needs a server adapter. The file name carries the path, so set only `HIGHSEAT_SECRET`. On the Cloudflare adapter, pass `secret: locals.runtime.env.HIGHSEAT_SECRET`.

### Hono

```ts
import { Hono } from "hono"
import { createProxy } from "highseat/proxy"

const proxy = createProxy({ clientIp: "nginx" })
const app = new Hono()

app.all(process.env.HIGHSEAT_PATH!, context => proxy(context.req.raw))
```

The outermost proxy that sets the header decides the preset: `"cloudflare"` behind a proxied Cloudflare record, `"nginx"` behind nginx alone, or a function for a server facing visitors directly.

### nginx

For a host without functions, nginx forwards the same two headers. It reads no environment variables, so the secret is written into the config: keep the file out of version control.

```nginx
# A GET on the path loads the script; a POST goes to the events location below.
location = /3f9a0c1e2b {
    if ($request_method = POST) {
        rewrite ^ /3f9a0c1e2b/events last;
    }
    proxy_pass https://cdn.highseat.com/script.js;
    include highseat-proxy.conf;
}

location = /3f9a0c1e2b/events {
    internal;
    proxy_pass https://cdn.highseat.com/api/event;
    include highseat-proxy.conf;
}
```

```nginx
# highseat-proxy.conf
proxy_set_header Host cdn.highseat.com;
proxy_ssl_server_name on;
proxy_set_header X-Hs-Secret "hs_secret_...";
# Behind Cloudflare or another edge, use $http_cf_connecting_ip instead.
proxy_set_header X-Hs-Client-Ip $remote_addr;
# An empty value keeps the visitor's own header from reaching Highseat.
proxy_set_header Cookie "";
proxy_set_header Authorization "";
proxy_set_header Referer "";
```

A host with no functions and no server of its own, such as GitHub Pages or S3, loads the script from Highseat's host instead.

## Support

Report a problem to [support@highseat.com](mailto:support@highseat.com). The source on GitHub, [highseat/highseat-js](https://github.com/highseat/highseat-js), is a read-only mirror and takes no issues or pull requests.
