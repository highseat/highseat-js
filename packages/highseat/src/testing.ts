import type { BuiltInEvents, TrackArgsOf } from "./index"
import type { ServerBuiltInEvents, ServerEventOptions, ServerTrackName, Tracker } from "./server"

/**
 * An in-memory tracker for a site's own tests. It fits wherever a `Tracker` from
 * `highseat/server` is expected, records each `track()` call as it was made, and sends nothing,
 * so a test checks the events an action sent without faking `fetch`.
 */

// The events the server's `track()` knows, whose properties a record is typed by.
type ServerEvents = BuiltInEvents & ServerBuiltInEvents

/** One `track()` call, as the test tracker recorded it. */
export interface TrackedEvent<Name extends ServerTrackName = ServerTrackName> {
  /** The event's name, as passed to `track()`. */
  name: Name
  /**
   * The properties as passed, typed by `Register`, before the conversion to strings that
   * Highseat stores. A copy taken at the call, so a later change to the object leaves the record
   * as it was. `undefined` when the call passed none.
   */
  properties: TrackArgsOf<ServerEvents, Name>[0]
  /**
   * The options passed with the event, such as `userId` or `request`. A copy taken at the call,
   * as the real tracker reads them then. An empty object when none.
   */
  options: ServerEventOptions
}

/** A `Tracker` that keeps every event in memory, with the helpers a test reads them through. */
export interface TestTracker extends Tracker {
  /** Every event recorded since the tracker was made or last reset, oldest first. A copy. */
  readonly events: TrackedEvent[]
  /** The events with this name, oldest first. An empty list when there are none. */
  getEvents: <Name extends ServerTrackName>(name: Name) => TrackedEvent<Name>[]
  /** Forgets every recorded event and reopens a closed tracker, as between two tests. */
  reset: () => void
}

// A property value is a primitive and `revenue` the one nested object, so this copy is deep.
function copyProperties(properties: unknown) {
  if (typeof properties !== "object" || properties === null) return properties
  const copy: Record<string, unknown> = { ...properties }
  if (typeof copy.revenue === "object" && copy.revenue !== null) copy.revenue = { ...copy.revenue }
  return copy
}

/**
 * Creates a tracker that records events in memory and makes no request. As with the real
 * tracker, `track()` after `close()` records nothing, until `reset()`.
 *
 * ```ts
 * const tracker = createTestTracker()
 * tracker.track("signup", { plan: "pro" }, { userId: "user_1" })
 * expect(tracker.getEvents("signup")).toEqual([
 *   { name: "signup", properties: { plan: "pro" }, options: { userId: "user_1" } },
 * ])
 * ```
 */
export function createTestTracker(): TestTracker {
  const recorded: TrackedEvent[] = []
  let closed = false

  function track(name: string, ...args: unknown[]) {
    if (closed) return
    const [properties, options] = args as [unknown, ServerEventOptions | undefined]
    recorded.push({
      name,
      properties: copyProperties(properties),
      options: { ...options },
    } as TrackedEvent)
  }

  function getEvents<Name extends ServerTrackName>(name: Name) {
    return recorded.filter(event => event.name === name) as TrackedEvent<Name>[]
  }

  function reset() {
    recorded.length = 0
    closed = false
  }

  return {
    track,
    flush: async () => {},
    close: async () => {
      closed = true
    },
    get events() {
      return [...recorded]
    },
    getEvents,
    reset,
  }
}
