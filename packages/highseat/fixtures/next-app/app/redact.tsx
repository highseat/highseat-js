"use client"

import { useBeforeSend } from "highseat/next"

export function Redact() {
  useBeforeSend(event => {
    const url = new URL(event.url)
    if (url.pathname.startsWith("/admin/")) return null
    url.searchParams.delete("email")
    return { ...event, url: url.href }
  })
  return null
}
