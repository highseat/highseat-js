import type { EmbedProps } from "highseat/react"

export const WIDGET: EmbedProps = {
  token: "abc",
  title: "Visitors",
  widget: "chart",
  theme: "dark",
  background: "transparent",
  credit: false,
  loading: "eager",
}

export const PENDING_THEME: EmbedProps = { token: "abc", title: "Visitors", theme: null }

// @ts-expect-error A frame needs an accessible name.
export const NO_TITLE: EmbedProps = { token: "abc" }

// @ts-expect-error An embed has no sepia theme.
export const UNKNOWN_THEME: EmbedProps = { token: "abc", title: "Visitors", theme: "sepia" }

// @ts-expect-error The token decides the frame's URL.
export const OWN_SRC: EmbedProps = { token: "abc", title: "Visitors", src: "https://example.com" }
