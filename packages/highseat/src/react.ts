"use client"

import { useEffect } from "react"
import { inject, type InjectOptions } from "./index"

export interface HighseatProps extends InjectOptions {}

/**
 * Loads the Highseat tracker. Render it once, in the root layout. It adds the script tag after
 * the page mounts and renders nothing; mounting it again adds no second tag, and the tracker
 * counts client-side navigation on its own.
 */
export function Highseat({ site, src, outbound, downloads, hashRouting }: HighseatProps): null {
  useEffect(() => {
    inject({ site, src, outbound, downloads, hashRouting })
  }, [site, src, outbound, downloads, hashRouting])

  return null
}
