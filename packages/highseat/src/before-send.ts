import type { BeforeSend, BeforeSendEvent, HighseatGlobal } from "./index"

/**
 * The hook on `window.highseat.beforeSend`, which the tracker reads on every event. With
 * `allowParams`, the hook there is a filter that trims each event's URLs first and then hands
 * the event to the site's own hook. A filter, not the site's hook alone, so a hook set later
 * with `setBeforeSend` or `useBeforeSend` runs behind it rather than replacing it.
 */

interface PageHooks {
  /** The site's own hook, which runs on the trimmed event. */
  hook?: BeforeSend
  /** The query params `allowParams` keeps. Unset, URLs go unchanged. */
  allowed?: ReadonlySet<string>
  /** Whether the hash carries the route, as `hashRouting` says. */
  hashRouting: boolean
  /** The filter set on the page, one per page so its identity can be compared. */
  filter: BeforeSend
}

/**
 * The query params ingest reads off the page URL into fields of its own: the campaign tags,
 * their `ref` and `source` shorthand, and the ad click ids. Whoever made the link wrote them, not
 * the visitor, so `allowParams` keeps them and a campaign still counts.
 */
export const CAMPAIGN_PARAMS: ReadonlySet<string> = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "ref",
  "source",
  "gclid",
  "fbclid",
  "msclkid",
  "ttclid",
  "li_fat_id",
  "twclid",
  "gclsrc",
  "wbraid",
  "gbraid",
  "yclid",
  "igshid",
])

// A route in the hash, as the tracker reads one under hash routing: `#/…` or `#!…`, up to its
// own query.
const HASH_ROUTE = /^#[/!][^?]*/

// Kept per window, because a test replaces the global window for each case, and each is a page.
const pages = new WeakMap<object, PageHooks>()

function findGlobal(): HighseatGlobal | undefined {
  if (typeof window === "undefined") return
  return (window.highseat ??= {})
}

function getPage(): PageHooks {
  const found = pages.get(window)
  if (found) return found

  const page: PageHooks = {
    hashRouting: false,
    filter: event => {
      const trimmed = page.allowed ? trimEvent(event, page.allowed, page.hashRouting) : event
      if (!trimmed) return null
      return page.hook ? page.hook(trimmed) : trimmed
    },
  }
  pages.set(window, page)
  return page
}

/** A URL with only the allowed and campaign params, and no hash but a route under hash routing. */
function trimUrl(href: string, allowed: ReadonlySet<string>, hashRouting: boolean) {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return
  }

  // A copy of the keys: deleting from the params while iterating them skips entries.
  for (const key of Array.from(url.searchParams.keys())) {
    if (!allowed.has(key) && !CAMPAIGN_PARAMS.has(key)) url.searchParams.delete(key)
  }
  url.hash = hashRouting ? (HASH_ROUTE.exec(url.hash)?.[0] ?? "") : ""
  return url.href
}

/**
 * The event with its URL and referrer trimmed to the allowed params. An event whose URL cannot
 * be read is dropped, and an unreadable referrer is left out: what cannot be read cannot be
 * shown to hold nothing personal.
 */
function trimEvent(
  event: BeforeSendEvent,
  allowed: ReadonlySet<string>,
  hashRouting: boolean,
): BeforeSendEvent | null {
  const url = trimUrl(event.url, allowed, hashRouting)
  if (!url) return null

  const referrer = event.referrer ? trimUrl(event.referrer, allowed, hashRouting) : event.referrer
  return { ...event, url, referrer }
}

/** Writes the page's hook: the filter with `allowParams`, the site's hook alone without it. */
function installHook(page: PageHooks) {
  const api = findGlobal()
  if (api) api.beforeSend = page.allowed ? page.filter : page.hook
}

/** Sets the site's own hook, or clears it with `undefined`. */
export function setSiteHook(hook: BeforeSend | undefined): void {
  if (typeof window === "undefined") return
  const page = getPage()
  page.hook = hook
  installHook(page)
}

/**
 * Clears the site's hook if it is still `hook`, and leaves one set since, by this package or by
 * the site writing `window.highseat.beforeSend`, alone.
 */
export function clearSiteHook(hook: BeforeSend): void {
  if (typeof window === "undefined") return
  const page = getPage()
  const current = window.highseat?.beforeSend
  const isOurs = current === hook || (current === page.filter && page.hook === hook)
  if (isOurs) setSiteHook(undefined)
}

/** Turns the `allowParams` filter on for the page. */
export function setAllowParams(names: readonly string[], hashRouting: boolean): void {
  if (typeof window === "undefined") return
  const page = getPage()
  page.allowed = new Set(names)
  page.hashRouting = hashRouting
  installHook(page)
}
