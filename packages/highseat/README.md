# highseat

Highseat analytics for JavaScript: typed tracking, a first-party proxy and framework components.

## Install

```bash
npm install highseat
```

## Entry points

| Import | Contents | Needs |
| --- | --- | --- |
| `highseat` | `track()`, `identify()`, `getAttributionId()`, `inject()` and `setBeforeSend()` | Nothing |
| `highseat/react` | `<Highseat />`, `useIdentify()` and `useBeforeSend()` | React |
| `highseat/next` | `<Highseat />`, `useIdentify()`, `useBeforeSend()`, `createProxy()` and `withHighseat()` for Next.js | Next.js |
| `highseat/proxy` | `createProxy()`, a first-party proxy for any runtime with `fetch` | Nothing |
| `highseat/server` | `track()`, `flush()`, `close()` and `createTracker()`, for events sent from your backend | Nothing |

Each entry point loads on its own and imports no framework it does not name, so `highseat/proxy` and `highseat/server` run in a Cloudflare Worker without React installed.

The package loads the tracker from Highseat, or from your site's proxy path, rather than bundling it. A call made before the tracker has loaded waits for it, and no call ever throws: on a server, with the tracker blocked, or with tracking off, it does nothing.

## Next.js

Render `<Highseat />` once, in the root layout, with the site id from your site's Installation settings:

```tsx
// app/layout.tsx
import { Highseat } from "highseat/next"

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Highseat site="site_…" />
      </body>
    </html>
  )
}
```

To keep the site id out of the code, leave `site` out and set it for the build, with the proxy path for first-party delivery:

```bash
NEXT_PUBLIC_HIGHSEAT_SITE=site_…
HIGHSEAT_PATH=/3f9a0c1e2b
```

Without `HIGHSEAT_PATH`, `<Highseat />` loads the tracker from Highseat's host. The tracker counts each client-side navigation as one page view on its own. With the Pages Router, render it in `pages/_app.tsx` instead.

## React

Render `<Highseat />` once, beside your root component:

```tsx
import { Highseat } from "highseat/react"

<Highseat site="site_…" />
```

With Vite, `site={import.meta.env.VITE_HIGHSEAT_SITE}` reads the site id from the environment instead; with another bundler, read it from that bundler's public variable. `src` takes the site's proxy path (`/3f9a0c1e2b`) for first-party delivery. `outbound={false}` and `downloads={false}` turn off the automatic link and download events, and `hashRouting` counts `#/route` changes as page views.

Without React, `inject({ site })` from `highseat` adds the same script tag.

## TanStack Start

Render `<Highseat />` once, inside `<body>` in the root route's component:

```tsx
// src/routes/__root.tsx
import { Highseat } from "highseat/react"

<Highseat site="site_…" />
```

To serve the tracker from your own domain, see TanStack Start under [First-party proxy](#first-party-proxy).

## Astro

Add the tracker's tag to the `<head>` of your layout. `is:inline` keeps Astro from bundling it, so the tracker starts before any page script:

```astro
<!-- src/layouts/Layout.astro -->
<script is:inline defer src="https://cdn.highseat.com/script.js" data-site="site_…"></script>
```

## Any other site

A site without a bundler, or a website builder such as Webflow or Shopify, needs no package. Add the tag to the `<head>` of every page, in the builder's head code field:

```html
<script defer src="https://cdn.highseat.com/script.js" data-site="site_…"></script>
```

## Debugging

In development, the package logs every `track()` and `identify()` call to the console, with its properties or id, and says whether the call went to the tracker or waits in the queue for it to load. It also warns once per page when nothing can reach Highseat: the page has no tracker script, or the script failed to load, as one an ad blocker stopped does.

Logging is on when `process.env.NODE_ENV` is `development`, so a production build logs nothing. Pass `debug={false}` to `<Highseat />` to turn it off, or `debug` to turn it on in any build. `inject({ site, debug })` takes the same option.

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

### Identify users

`identify()` links the visitor to a user id from your own system, on every later event and across visits. Pass your own database id, never an email or other personal data. `identify(null)` clears the id, and an empty or `undefined` id changes nothing.

Most sites never call `identify()` directly. They pass the signed-in user's id instead, and the package calls `identify()` each time the value changes. A string or a number identifies the visitor. `null` means signed out, so a sign-out or an expired session clears the id. A sign-out in another tab clears it too once your auth library updates the session in this tab. `undefined` means the session is still loading, and changes nothing. The same id on every render calls `identify()` once.

When the server already knows the user, pass the id to `<Highseat />`:

```tsx
<Highseat site="site_…" userId={user?.id ?? null} />
```

When the session comes from a client hook, call `useIdentify()` in any client component. It needs no `<Highseat />` nearby, so a Next.js App Router site keeps `<Highseat />` in its server layout and every page static. `highseat/next` and `highseat/react` both export it:

```tsx
"use client"

import { useIdentify } from "highseat/next"
import { useSession } from "~/lib/auth-client"

export function IdentifyUser() {
  const { data, isPending } = useSession()
  useIdentify(isPending ? undefined : (data?.user.id ?? null))
  return null
}
```

The value has to tell loading apart from signed out. `useIdentify(session?.user.id)` passes `undefined` after sign-out too, so it never clears the id. `useIdentify(session?.user.id ?? null)` clears the id while the session loads, so the first page view has no user. Each auth library marks loading its own way:

| Library | Hook | Value |
| --- | --- | --- |
| Better Auth | `const { data, isPending } = useSession()` | `isPending ? undefined : (data?.user.id ?? null)` |
| Auth.js (NextAuth) | `const { data, status } = useSession()` | `status === "loading" ? undefined : (data?.user?.id ?? null)` |
| Clerk | `const { user, isLoaded } = useUser()` | `isLoaded ? (user?.id ?? null) : undefined` |

Without React, call `identify()` from `highseat` after each sign-in and sign-out.

## Redact or drop events

A page URL can carry a secret: a password-reset token in the path, an email address in the query. A `beforeSend` hook runs in the browser on every event before the tracker sends it, page views from client-side navigation included. Return the event, changed or not, or `null` to drop it. The hook can change the URL, the referrer and the properties, and the page path follows the URL it returns. It cannot change the site or the user id.

```ts
import type { BeforeSendEvent } from "highseat"

// Strips `email` from the query and templates the reset token, in the URL and the referrer.
function redact(value: string) {
  const url = new URL(value)
  url.searchParams.delete("email")
  url.pathname = url.pathname.replace(/^\/reset\/[^/]+/, "/reset/:token")
  return url.href
}

export function beforeSend(event: BeforeSendEvent) {
  // Drops every event on the admin pages, so an in-app navigation there sends nothing.
  if (new URL(event.url).pathname.startsWith("/admin/")) return null
  return { ...event, url: redact(event.url), referrer: event.referrer && redact(event.referrer) }
}
```

A hook that throws drops the event, since sending it unchanged would leak what the hook was there to remove. The error still reaches the console. Returning nothing drops the event too.

A function cannot pass from a server component to the browser, so in a Next.js App Router layout, set the hook with `useBeforeSend()` in a client component rendered beside `<Highseat />`:

```tsx
"use client"

import { useBeforeSend } from "highseat/next"
import { beforeSend } from "~/lib/analytics"

export function Redact() {
  useBeforeSend(beforeSend)
  return null
}
```

`highseat/react` takes the hook as a prop, `<Highseat site="site_…" beforeSend={beforeSend} />`, and `inject({ site, beforeSend })` takes it as an option. `setBeforeSend()` from `highseat` sets or clears it at any time. Each of them works before the tracker has loaded, and the first page view already passes through the hook.

A site with only the script tag sets the hook on `window.highseat` in a script before the tracker's tag:

```html
<script>
  window.highseat = {
    beforeSend(event) {
      return new URL(event.url).pathname.startsWith("/admin/") ? null : event
    },
  }
</script>
<script defer src="https://cdn.highseat.com/script.js" data-site="site_…"></script>
```

## Revenue attribution

`getAttributionId()` resolves to the id that joins a payment to the visit. Pass it to your checkout as `attribution_id` metadata. It resolves to `undefined` if the tracker has not loaded within three seconds, so a checkout that awaits it never hangs.

```ts
const attributionId = await getAttributionId()
await createCheckout({ metadata: { attribution_id: attributionId } })
```

## Server-side events

`highseat/server` records an event from your own backend: a server action, a route handler, a webhook handler or a job. It sends with the site secret, so set both variables from your site's Installation settings on the server:

```bash
HIGHSEAT_SITE=site_…              # NEXT_PUBLIC_HIGHSEAT_SITE works too
HIGHSEAT_SECRET=hs_secret_...
```

Pass the request you are handling, and the event takes the visitor's IP, user agent and hostname from it, so it gets their country and device:

```ts
import { track } from "highseat/server"

export async function POST(request: Request) {
  const user = await createAccount(request)
  track("signup", { plan: "pro" }, { request, userId: user.id })
  return Response.json(user)
}
```

In a Next.js server action, pass the headers instead:

```ts
"use server"

import { headers } from "next/headers"
import { track } from "highseat/server"

export async function subscribe(plan: string) {
  track("subscription_started", { plan }, { headers: await headers() })
}
```

`track()` takes the same names and properties as in the browser, checked by the same `Register`. It returns at once and never throws. Events wait up to a second to share a request, at most 25 to one, and go one request at a time. A batch Highseat answers `429` or `5xx`, or never answers, is retried with backoff, honoring `Retry-After`, and the events behind it wait. Every event gets a UUID, so a retried batch is stored once. Up to 1000 events wait during an outage. A newer one is reported to `onError` and not kept.

An event no visitor caused, from a job or a webhook, leaves the request out. With a `userId` it counts as that user, and without one as a visitor of its own:

```ts
track("invoice_paid", { plan: "pro" }, { userId: customer.id, eventId: stripeEvent.id, hostname: "example.com" })
```

Pass an id your system already holds as `eventId` (a job id, a webhook event id), and a retry of the same event within three days is stored once. `timestamp` dates an event that happened earlier, up to a day ago.

### Serverless functions

A serverless function can stop as soon as it answers, before a batch leaves. Pass `waitUntil`, and the event is sent at once while the function stays alive until it lands:

```ts
import { waitUntil } from "@vercel/functions"

track("signup", undefined, { request, userId: user.id, waitUntil })
```

In a Cloudflare Worker, pass `waitUntil: promise => ctx.waitUntil(promise)`, and in a Netlify function `context.waitUntil`. A script or a test that exits on its own awaits `flush()` first. A long-running server calls `close()` at shutdown, which sends what is queued. During an outage that can take minutes of retries, so give it a deadline inside your shutdown's grace period:

```ts
process.on("SIGTERM", async () => {
  await close({ timeout: 5000 })
  process.exit(0)
})
```

Past the deadline, `close()` stops sending, reports the events not confirmed sent to `onError`, and resolves.

### Your own tracker

`createTracker(options)` returns a tracker with its own `track()`, `flush()` and `close()`, for credentials or a `fetch` of your own, or several sites in one process:

```ts
import { createTracker } from "highseat/server"

const tracker = createTracker({
  hostname: "example.com",
  onError: error => logger.warn(error.message, { events: error.events }),
})

tracker.track("tier_created", { tier: "gold" }, { userId: publisher.id, ip, userAgent })
```

| Option | Default | |
| --- | --- | --- |
| `site` | `HIGHSEAT_SITE`, then `NEXT_PUBLIC_HIGHSEAT_SITE` | The site id. |
| `secret` | `HIGHSEAT_SECRET` | The site secret. A value that is not one throws. Without the site or the secret, the tracker warns once and sends nothing. |
| `hostname` | The request's host | The hostname events are filed under. An event's own `hostname` wins. |
| `clientIp` | `"cloudflare"` in a Worker, `"vercel"` on Vercel, `"netlify"` on Netlify | Where the visitor's IP is read from a request, as for `createProxy()`. Those three hosts overwrite their header, so a visitor cannot forge it. Anywhere else, set it or pass `ip` with each event: without either, an event carries no IP and no country. |
| `waitUntil` | None | Sends every event at once, as above. |
| `onError` | `console.warn` | Receives each failure. `type` is `"rejected"` for events Highseat refused as invalid, `"dropped"` for events it accepted but did not store (a hostname that is not the site's, a bot, excluded traffic), each with its `reason`, or `"failed"` for events that never landed, were refused whole (a wrong secret), or were left at `close()`'s deadline. A retry Highseat recognised as already stored is not a failure. |
| `fetch` | The global `fetch` | The `fetch` events are sent with, such as a mock in tests. |
| `upstream` | `https://cdn.highseat.com` | The Highseat ingest origin. |
| `flushInterval` | `1000` | Milliseconds an event waits for others to share its request. |
| `maxRetries` | `4` | Retries of a batch before it is reported as failed. |
| `timeout` | `10000` | Milliseconds one request may take. |

Each event takes `request` or `headers`, then `ip`, `userAgent`, `userId`, `hostname`, `url`, `referrer`, `eventId`, `timestamp` and `waitUntil`. An explicit `ip` or `userAgent` wins over the request's. A `pageview` takes its `url` and `referrer` from the request too.

### Without the package

Any language can send the same request. `POST https://cdn.highseat.com/api/event` with `x-site-id` and `x-hs-secret` headers and a JSON array of up to 25 events. Each event names `event_name`, `hostname` (or a `page_url`), and optionally `event_id`, `user_id`, `ip`, `user_agent`, `page_url`, `referrer`, `properties` (string values) and `revenue`. The answer lists each refused event in `rejections` and each event it did not store in `dropped`, by its index in the batch.

## First-party proxy

The proxy serves the tracker and forwards its events from your own domain, on the site's own path, so a filter list that blocks Highseat's host does not block your site. A `GET` on the path serves the script and a `POST` forwards events. The proxy sends the visitor's IP under your site secret, which a rewrite or a redirect rule cannot do: without it, every visitor would get your server's country.

Set two environment variables from your site's Installation settings:

```bash
HIGHSEAT_PATH=/3f9a0c1e2b        # the site's proxy path
HIGHSEAT_SECRET=hs_secret_...    # the site secret
```

A missing variable never stops the site. Without the secret, or without the path on a handler with a `fallback`, `createProxy()` warns once and turns the proxy off: with a `fallback`, every request goes to it, and without one the proxy path answers `503` with a JSON `error` naming the variable. A local server without the variables therefore still starts and serves the site.

Then load the tracker from the path. In Next.js, `<Highseat />` reads `HIGHSEAT_PATH` itself. Elsewhere, pass `src="/3f9a0c1e2b"` to `<Highseat />` or `inject()`, or load it with a script tag in the `<head>` of every page:

```html
<script defer src="/3f9a0c1e2b" data-site="site_…"></script>
```

To rotate the path, rotate it in Installation settings, update `HIGHSEAT_PATH` and the snippet, and redeploy. On a host whose route is a file or a config entry (Netlify, Vercel without Next.js, Astro), move that route too.

### Options

`createProxy(options)` returns a `(request: Request) => Promise<Response>` handler.

| Option | Default | |
| --- | --- | --- |
| `clientIp` | Required | Where the visitor's IP comes from: `"vercel"`, `"cloudflare"`, `"netlify"`, `"nginx"` (the `X-Real-IP` header your nginx sets), or a function `(request) => string`. The outermost proxy that sets the header decides the preset: behind a proxied Cloudflare record, use `"cloudflare"` on any origin (Next.js, TanStack Start, a Node server, with or without Traefik or nginx in between), whose `X-Real-IP` holds a Cloudflare edge address. A visitor can write any header the host does not overwrite, so there is no default and no fallback to `X-Forwarded-For`. |
| `path` | `HIGHSEAT_PATH` | The proxy path. Any other path answers 404, or goes to `fallback`. Leave it unset where your router already sends only the proxy path to the handler. |
| `secret` | `HIGHSEAT_SECRET` | The site secret. An older secret that starts `hs_proxy_` or `ana_proxy_` works too. A value with neither prefix throws. |
| `upstream` | `https://cdn.highseat.com` | The Highseat ingest origin. |
| `fallback` | None | Answers every other path, for a handler that sees every request on the site. Needs `path`. |

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

Then render `<Highseat />` in the root layout without `site` or `src`, in place of whatever loads the tracker now. It reads the site id from `NEXT_PUBLIC_HIGHSEAT_SITE` and the path from `HIGHSEAT_PATH`, and a `src` prop would outrank the path:

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

Next.js loads `next.config.ts` with `require`, and the package is ES modules only, so the config needs Node 20.19 or 22.12 and later, the versions that `require` an ES module without a flag.

`withHighseat()` rewrites `HIGHSEAT_PATH` to the route handler inside the app, so the visitor's IP survives and the route file never moves. Pass `{ route: "/stats" }` for a handler elsewhere. Without `HIGHSEAT_PATH`, `next dev` and `next build` warn once and leave the rewrite out, and `next typegen` runs as usual. Set the variable for the build, as a build argument in a Docker build. `withHighseat()` writes the build's value into the rewrite and into the bundled code of `<Highseat />` and `createProxy()`, so the running App Router server needs only `HIGHSEAT_SECRET`. Off Vercel, the outermost proxy that sets the header decides the preset: `"cloudflare"` behind a proxied Cloudflare record, even with nginx or Traefik in between, and `"nginx"` behind nginx alone.

### TanStack Start

```ts
// src/server.ts
import handler, { createServerEntry } from "@tanstack/react-start/server-entry"
import { createProxy } from "highseat/proxy"

const proxy = createProxy({
  clientIp: "cloudflare",
  fallback: request => handler.fetch(request),
})

export default createServerEntry({ fetch: request => proxy(request) })
```

```ts
// vite.config.ts
import { defineConfig, loadEnv } from "vite"

export default defineConfig(({ mode }) => ({
  // Loads HIGHSEAT_PATH alone, so the site secret beside it never reaches the bundle.
  define: {
    "import.meta.env.HIGHSEAT_PATH": JSON.stringify(
      loadEnv(mode, process.cwd(), "HIGHSEAT_PATH").HIGHSEAT_PATH,
    ),
  },
  // Your own config.
}))
```

```tsx
// src/routes/__root.tsx
<Highseat site={import.meta.env.VITE_HIGHSEAT_SITE} src={import.meta.env.HIGHSEAT_PATH} />
```

The server entry answers `HIGHSEAT_PATH` with the proxy and hands every other request to the app. A file route named after the path does not work: a catch-all route such as `$id` matches it first. The `define` gives the browser the same path, so set `HIGHSEAT_PATH` for the build as well as the server, as a build argument in a Docker build. Pick the preset for the outermost proxy that sets the header, as for Next.js.

`fallback` receives the request alone, so the app loses the options the server entry was called with. An app that reads them routes the path itself, with a proxy created without `fallback`:

```ts
export default createServerEntry({
  fetch: (request, options) =>
    new URL(request.url).pathname === process.env.HIGHSEAT_PATH
      ? proxy(request)
      : handler.fetch(request, options),
})
```

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

A Worker that serves the site's static assets has no origin: pass `fallback: request => env.ASSETS.fetch(request)`, and leave `not_found_handling` out of your Wrangler config. With `not_found_handling` set, the assets answer every path that has no file, the proxy path included, so list the path in `run_worker_first`.

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

```json
// public/_routes.json
{ "version": 1, "include": ["/3f9a0c1e2b"], "exclude": [] }
```

`_routes.json` runs the function on the proxy path alone, so every page stays a static asset; without it the function runs on every one-segment path, and `next` serves your site for each one but the proxy's. Put it in the folder your build copies to its output as is, such as `public/`. Add both variables in the Pages project's settings.

Pages ignores `functions/` when the build ships a `_worker.js`, as the Astro, SvelteKit and Remix adapters do, and the proxy path then answers with your site's 404. Remove the adapter from a static site, or use the adapter's own endpoint instead.

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

Then load the tracker from the path in your layout:

```astro
<!-- src/layouts/Layout.astro -->
<script is:inline defer src="/3f9a0c1e2b" data-site={import.meta.env.PUBLIC_HIGHSEAT_SITE}></script>
```

Needs a server adapter. The file name carries the path, so set only `HIGHSEAT_SECRET`, and `PUBLIC_HIGHSEAT_SITE` for the site id. On the Cloudflare adapter, pass `secret: locals.runtime.env.HIGHSEAT_SECRET`. `clientAddress` is the address that connected, so behind a proxied Cloudflare record, use `"cloudflare"` instead.

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
