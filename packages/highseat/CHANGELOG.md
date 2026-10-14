# highseat

## 0.1.0

### Minor Changes

- First stable release. `npm install highseat` now installs the working package instead of the empty `0.0.2` placeholder.

  - `track()`, `identify()` and `getAttributionId()` from `highseat` talk to the hosted tracker and queue calls made before it loads. `track()` is typed: built-in events such as `file_download` check their properties, and a site declares its own events, and an optional strict mode, through the `Register` interface.
  - `<Highseat />` from `highseat/react` and `highseat/next`, and `inject()` from `highseat`, load the tracker from Highseat or from the site's proxy path.
  - `createProxy()` from `highseat/proxy` is a first-party proxy for any runtime with `fetch`. On the site's proxy path, a `GET` serves the tracker and a `POST` forwards its events, with the site secret and the visitor's IP read from the host you name in `clientIp` (`"vercel"`, `"cloudflare"`, `"netlify"`, `"nginx"` or a function). The path and the secret default to the `HIGHSEAT_PATH` and `HIGHSEAT_SECRET` environment variables. The proxy is optional: without a path or a secret it warns once, then passes every request to its `fallback`, or answers the proxy path with a `503` naming the missing variable.
  - `withHighseat()` from `highseat/next` rewrites the proxy path to your route handler, so a Next.js app keeps one route file whatever the path is. Without `HIGHSEAT_PATH` it warns once and leaves the rewrite out.

  Every entry point resolves through `import` and `require`, and the package requires Node 20.19 or 22.12 and later. Until 1.0, a breaking change ships as a minor version, which a `^0.1.0` range does not install.

### Patch Changes

- The README covers TanStack Start: the proxy in a custom server entry, the Vite `define` that gives the browser `HIGHSEAT_PATH`, and the route an app takes when it needs the server entry's options.

## 0.1.0-alpha.2

### Patch Changes

- The proxy is optional, and a missing variable no longer stops a build or a server. `withHighseat()` never throws: without `HIGHSEAT_PATH` it warns once and leaves the rewrite out, so `next typegen`, `next dev` and `next build` all run, and `<Highseat />` loads the tracker from Highseat's host. `createProxy()` no longer throws at creation without a path or a secret: with a `fallback` it passes every request through, and without one it answers the proxy path with a `503` whose JSON `error` names the missing variable. Both warn once. A secret with no known prefix still throws. A request on any other path now gets a `404` with a JSON `error`, so `curl -i` tells it apart from Highseat's own answer.

  `getAttributionId()` finds a tracker script whose site id is a UUID, as older sites have, when the script loads from a proxy path or from Highseat's host. It used to resolve `undefined` at once on such a page.

  The hosted tracker, which every version loads, now counts a 404 once per page path. A not-found page's `track("404")` queued before the tracker loads no longer adds a second `404` to the tracker's own, so remove any workaround that skips the call on a hard 404 landing. Each `404` is now sent at once.

## 0.1.0-alpha.1

### Minor Changes

- `createProxy()` from `highseat/proxy` is a working first-party proxy for any runtime with `fetch`. On the site's proxy path, a `GET` serves the tracker and a `POST` forwards its events, with the site secret and the visitor's IP read from the host you name in `clientIp` (`"vercel"`, `"cloudflare"`, `"netlify"`, `"nginx"` or a function). The path and the secret default to the `HIGHSEAT_PATH` and `HIGHSEAT_SECRET` environment variables, so rotating either is an environment change and a redeploy. A path written without its leading slash works, and a secret minted under the older `hs_proxy_` or `ana_proxy_` prefix keeps working. `clientIp` is now required, and the handler warns once when the header it names is empty.

  `withHighseat()` from `highseat/next` rewrites the proxy path to your route handler, so a Next.js app keeps one route file whatever the path is. Without `HIGHSEAT_PATH`, `next build` fails and `next dev` warns and runs without the proxy. Every entry point now resolves through `require` as well as `import`, which `next.config.ts` needs. The package now requires Node 20.19 or 22.12 and later, the versions that `require` an ES module without a flag.
- `track()`, `identify()` and `getAttributionId()` now talk to the hosted tracker, queueing calls made before it loads. `track()` is typed: built-in events such as `file_download` check their properties, and a site declares its own events, and an optional strict mode, through the `Register` interface. `<Highseat />` from `highseat/react` and `highseat/next`, and `inject()` from `highseat`, load the tracker from Highseat or the site's proxy path.

## 0.1.0-alpha.0

### Minor Changes

- First alpha: the `highseat`, `highseat/react`, `highseat/next` and `highseat/proxy` entry points, with placeholder functions. Use the script tag until a stable version ships.
