"use client"

import { useEffect, useRef } from "react"
import { syncIdentity } from "./identity"
import { inject, setBeforeSend, type BeforeSend, type InjectOptions, type UserId } from "./index"

export interface HighseatProps extends InjectOptions {
  /**
   * The signed-in user's id from your own system, never an email or other personal data. Pass
   * `null` once the visitor is signed out, and `undefined` while the session is still loading.
   * See {@link useIdentify}.
   */
  userId?: UserId
}

/**
 * Keeps the visitor's user id in step with a session. Each new value is passed to `identify`
 * once: an id identifies the visitor, `null` clears the id at sign-out or session expiry, and
 * `undefined`, a session still loading, changes nothing. Works in any client component, with or
 * without `<Highseat />` on the page, and before the tracker has loaded.
 *
 * Tell loading apart from signed out: `useIdentify(session?.user.id)` passes `undefined` after
 * sign-out too, so it never clears the id.
 *
 * ```tsx
 * const { data, isPending } = useSession()
 * useIdentify(isPending ? undefined : (data?.user.id ?? null))
 * ```
 */
export function useIdentify(userId: UserId): void {
  // The id this component identified last. A ref survives Strict Mode's second effect run, so
  // the same id is never sent twice.
  const identified = useRef<UserId>(undefined)

  useEffect(() => {
    identified.current = syncIdentity(identified.current, userId)
  }, [userId])
}

/**
 * Sets the {@link BeforeSend} hook while the component is mounted, and clears it on unmount.
 * `undefined` leaves the current hook alone. Use it in a client component when the tracker loads
 * from a server component, such as `<Highseat />` in a Next.js App Router layout, where a
 * function cannot be passed as a prop. Effects run before the tracker's script loads, so the
 * first page view already passes through the hook.
 *
 * ```tsx
 * "use client"
 * export function Redact() {
 *   useBeforeSend(event => (event.url.includes("/admin/") ? null : event))
 *   return null
 * }
 * ```
 */
export function useBeforeSend(beforeSend: BeforeSend | undefined): void {
  useEffect(() => {
    if (!beforeSend) return
    setBeforeSend(beforeSend)
    return () => {
      // Another component may have set its own hook since.
      if (window.highseat?.beforeSend === beforeSend) setBeforeSend(undefined)
    }
  }, [beforeSend])
}

/**
 * Loads the Highseat tracker. Render it once, in the root layout. It adds the script tag after
 * the page mounts and renders nothing; mounting it again adds no second tag, and the tracker
 * counts client-side navigation on its own. With `userId`, it also identifies the visitor, as
 * {@link useIdentify} does, and with `beforeSend` it sets the hook, as {@link useBeforeSend} does.
 */
export function Highseat({
  site,
  src,
  outbound,
  downloads,
  hashRouting,
  beforeSend,
  debug,
  userId,
}: HighseatProps): null {
  // Declared first, so its effect sets the hook before the next one adds the script tag.
  useBeforeSend(beforeSend)

  useEffect(() => {
    inject({ site, src, outbound, downloads, hashRouting, debug })
  }, [site, src, outbound, downloads, hashRouting, debug])

  useIdentify(userId)

  return null
}
