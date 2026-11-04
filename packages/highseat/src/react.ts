"use client"

import {
  createElement,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type IframeHTMLAttributes,
  type ReactElement,
} from "react"
import {
  EMBED_CREDIT_TEXT,
  EMBED_CREDIT_URL,
  EMBED_FALLBACK_HEIGHT,
  findEmbedHeight,
  formatEmbedSrc,
  getFrameColorScheme,
  WIDGET_FALLBACK_HEIGHTS,
  type EmbedBackground,
  type EmbedTheme,
  type EmbedWidget,
} from "./embed"
import { syncIdentity } from "./identity"
import { inject, setBeforeSend, type BeforeSend, type InjectOptions, type UserId } from "./index"

export type { EmbedBackground, EmbedTheme, EmbedWidget } from "./embed"

const CREDIT_STYLE: CSSProperties = {
  display: "block",
  width: "fit-content",
  marginTop: 8,
  fontSize: 12,
}

function subscribeToNothing() {
  return () => {}
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

export interface HighseatProps extends InjectOptions {
  /**
   * The signed-in user's id from your own system, never an email or other personal data. Pass
   * `null` once the visitor is signed out, and `undefined` while the session is still loading.
   * See {@link useIdentify}.
   */
  userId?: UserId
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

/**
 * The props of `<Embed />`. Attributes it does not name, such as `id` or `loading`, go to the
 * frame, while `className` and `style` go to the box around the frame and the credit link.
 */
export interface EmbedProps extends Omit<
  IframeHTMLAttributes<HTMLIFrameElement>,
  "children" | "className" | "height" | "src" | "srcDoc" | "style" | "title" | "width"
> {
  /** The token of a share link or a widget, the last part of its embed code's `/share/` URL. */
  token: string
  /** The frame's accessible name, which a screen reader announces. */
  title: string
  /**
   * The embed's theme. Leave it out for `system`, which follows the reader's own setting. Pass
   * the page's theme when the page has its own switch, or the frame can disagree with the page.
   * Pass `null` while that theme is still unknown after mount: the slot stays empty until then,
   * so the frame loads once.
   */
  theme?: EmbedTheme | null
  /**
   * The embed's background. `transparent`, the default for a widget, lets your page's background
   * show through. `default`, the default for a whole board, keeps the board's own.
   */
  background?: EmbedBackground
  /** The kind of widget the token shows, which sets the height held before the frame loads. */
  widget?: EmbedWidget
  /** The height in pixels to hold until the embed reports its own. */
  height?: number
  /** Whether to show the "Analytics by Highseat" link under the frame. It is yours to remove. */
  credit?: boolean
  /** A class for the credit link. It replaces the link's default spacing and size. */
  creditClassName?: string
  /** A class for the box around the frame and the credit link. */
  className?: string
  /** A style for the box around the frame and the credit link. */
  style?: CSSProperties
}

/**
 * Shows a Highseat share link or widget in a frame that fits its content, with a followed credit
 * link under it. Needs no script tag: the component listens for the embed's height itself.
 *
 * The frame renders only after mount, so the page's theme can come from a client-only source such
 * as `next-themes` with no hydration mismatch. Until then, an empty box holds the frame's height,
 * and the credit link is already in the server's HTML.
 *
 * ```tsx
 * <Embed token="YOUR_WIDGET_TOKEN" title="Visitors" widget="chart" theme="dark" />
 * ```
 */
export function Embed({
  token,
  title,
  theme,
  background,
  widget,
  height,
  credit = true,
  creditClassName,
  className,
  style,
  ...frameProps
}: EmbedProps): ReactElement {
  // React reads the last snapshot on the server and during hydration, so both render the slot.
  const isMounted = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  )
  const [frame, setFrame] = useState<HTMLIFrameElement | null>(null)
  const [reportedHeight, setReportedHeight] = useState<number>()

  // The listener starts as the frame enters the page, before its page can load and post, so the
  // first height is heard and no `highseat:embed-request` is needed.
  useEffect(() => {
    if (!frame) return

    function onMessage(event: MessageEvent) {
      const nextHeight = findEmbedHeight(event, frame?.contentWindow)
      if (nextHeight !== undefined) setReportedHeight(nextHeight)
    }

    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [frame])

  const look = {
    theme: theme ?? "system",
    background: background ?? (widget ? "transparent" : "default"),
  } as const
  const fallbackHeight = widget ? WIDGET_FALLBACK_HEIGHTS[widget] : EMBED_FALLBACK_HEIGHT
  const frameHeight = reportedHeight ?? height ?? fallbackHeight
  const src = formatEmbedSrc(token, look)

  return createElement(
    "div",
    { className, style },
    isMounted && theme !== null
      ? createElement("iframe", {
          loading: "lazy",
          ...frameProps,
          // A new element per URL: changing `src` on a live frame would add a history entry, so
          // the host page's back button would step through the reader's theme changes.
          key: src,
          ref: setFrame,
          src,
          title,
          style: {
            display: "block",
            width: "100%",
            height: frameHeight,
            border: 0,
            // A widget's page is see-through around its card whatever the background.
            ...((look.background === "transparent" || widget) && {
              colorScheme: getFrameColorScheme(look.theme),
            }),
          },
        })
      : createElement("div", { style: { height: frameHeight } }),
    credit &&
      createElement(
        "a",
        {
          href: EMBED_CREDIT_URL,
          target: "_blank",
          rel: "noopener",
          className: creditClassName,
          style: creditClassName ? undefined : CREDIT_STYLE,
        },
        EMBED_CREDIT_TEXT,
      ),
  )
}
