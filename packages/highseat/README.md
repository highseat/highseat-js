# highseat

Highseat analytics for JavaScript: typed tracking, a first-party proxy and framework components.

> **Pre-release.** The `alpha` versions publish the package's shape so the release pipeline can be tested end to end. The functions are placeholders and do nothing yet. Use the script tag from your site's Installation settings until a stable version ships.

## Install

```bash
npm install highseat@alpha
```

## Entry points

| Import | Contents | Needs |
| --- | --- | --- |
| `highseat` | `track()` and `identify()` | Nothing |
| `highseat/react` | `<Highseat />` | React |
| `highseat/next` | `<Highseat />` and `createProxy()` for Next.js | Next.js |
| `highseat/proxy` | `createProxy()`, a first-party proxy for any runtime with `fetch` | Nothing |

Each entry point loads on its own and imports no framework it does not name, so `highseat/proxy` runs in a Cloudflare Worker without React installed.

## Support

Report a problem to [support@highseat.com](mailto:support@highseat.com). The source on GitHub, [highseat/highseat-js](https://github.com/highseat/highseat-js), is a read-only mirror and takes no issues or pull requests.
