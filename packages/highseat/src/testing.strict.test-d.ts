import type { Tracker } from "highseat/server"
import { createTestTracker } from "highseat/testing"

// Compiles with `index.strict.test-d.ts`, whose `Register` turns strict mode on and declares
// `signup` with a `plan`.
const tracker = createTestTracker()
const asTracker: Tracker = tracker

asTracker.track("signup", { plan: "pro" })

// @ts-expect-error A misspelt event name is not an event in strict mode, on the test tracker too.
tracker.track("singup", { plan: "pro" })

// @ts-expect-error A misspelt name passed to `getEvents` fails as well, so an assertion cannot read a name never sent.
tracker.getEvents("singup")

// The recorded properties take the registered shape.
const plan: "free" | "pro" | undefined = tracker.getEvents("signup")[0]?.properties.plan

// The server's own built-in event is known without a `Register` entry.
tracker.getEvents("mcp_tool_call")
void plan
