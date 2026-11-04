/**
 * What `<Embed />` knows about a Highseat embed frame: its URL, its message and the credit link.
 * The dashboard's own copy lives in the monorepo, which this package cannot import because it
 * builds alone in the public mirror. `scripts/embed-mirror.test.ts` at the monorepo's root fails
 * when the two differ.
 */

/** The theme of an embed: `system` follows the reader's own light or dark setting. */
export type EmbedTheme = "system" | "light" | "dark"

/** The background of an embed: `transparent` lets the host page's own show through. */
export type EmbedBackground = "default" | "transparent"

/** The kind of widget a token shows. */
export type EmbedWidget = "chart" | "figure"

interface EmbedLook {
  theme: EmbedTheme
  background: EmbedBackground
}

/** The part of a `MessageEvent` a resize message is judged on. */
type FrameMessage = Pick<MessageEvent, "data" | "origin" | "source">

/** The origin that serves every embed page, and so the only one a resize message can come from. */
export const EMBED_ORIGIN = "https://app.highseat.com"

/** The `type` of the message an embed posts to its parent whenever its height changes. */
export const EMBED_RESIZE_MESSAGE = "highseat:embed-resize"

/** The height of a whole board's frame before the board reports its own. */
export const EMBED_FALLBACK_HEIGHT = 1600

/** The height of a widget's frame before the widget reports its own, close to its usual one. */
export const WIDGET_FALLBACK_HEIGHTS: Record<EmbedWidget, number> = {
  figure: 80,
  chart: 360,
}

/** Where the link under an embed goes, tagged so the visits it sends are attributed. */
export const EMBED_CREDIT_URL = "https://highseat.com/?ref=embed"

/** The text of the link under an embed. */
export const EMBED_CREDIT_TEXT = "Analytics by Highseat"

/** An embeddable page's URL with the keys that frame it: `embed=1` and the chosen look. */
export function formatEmbedUrl(pageUrl: string, { theme, background }: EmbedLook): string {
  const params = new URLSearchParams({ embed: "1" })
  if (theme !== "system") params.set("theme", theme)
  if (background !== "default") params.set("background", background)
  return `${pageUrl}?${params}`
}

/** The URL of the embed page a token opens. */
export function formatEmbedSrc(token: string, look: EmbedLook): string {
  return formatEmbedUrl(`${EMBED_ORIGIN}/share/${encodeURIComponent(token)}`, look)
}

/**
 * The colour scheme a see-through frame declares. A browser paints an opaque backdrop behind a
 * frame whose scheme differs from the frame element's, so the element takes the page's scheme.
 */
export function getFrameColorScheme(theme: EmbedTheme): string {
  return theme === "system" ? "light dark" : theme
}

/**
 * The height a message asks `frameWindow` to take, rounded up. Any page or frame can post to the
 * host page, so a message counts only from the embed origin and from that exact frame. Without
 * the source check, a second embed on the page would resize this one.
 */
export function findEmbedHeight(
  { data, origin, source }: FrameMessage,
  frameWindow: Window | null | undefined,
): number | undefined {
  if (origin !== EMBED_ORIGIN || !frameWindow || source !== frameWindow) return
  if (data?.type !== EMBED_RESIZE_MESSAGE) return
  if (!Number.isFinite(data.height) || data.height <= 0) return
  return Math.ceil(data.height)
}
