import { type EventName, track, type TrackArgs } from "highseat"
import type { ComponentProps } from "react"

interface TrackedLinkProps<Name extends EventName> extends ComponentProps<"a"> {
  event: [name: Name, ...args: TrackArgs<Name>]
}

export function TrackedLink<Name extends EventName>({
  event,
  href,
  onClick,
  ...props
}: TrackedLinkProps<Name>) {
  const [name, ...args] = event

  return (
    <a
      href={href}
      {...props}
      onClick={clickEvent => {
        track(name, ...args)
        onClick?.(clickEvent)
      }}
    />
  )
}

export const PRICING_LINK = (
  <TrackedLink href="/pricing" event={["signup", { plan: "pro" }]}>
    Start free
  </TrackedLink>
)

// @ts-expect-error The properties must match the event they are paired with.
export const WRONG_PROPERTIES = <TrackedLink event={["signup", { role: "admin" }]} />

// @ts-expect-error An event whose properties are required cannot leave them out.
export const MISSING_PROPERTIES = <TrackedLink event={["invite_sent"]} />

// @ts-expect-error A misspelt name is not an event in strict mode.
export const MISSPELT_NAME = <TrackedLink event={["singup", { plan: "pro" }]} />
