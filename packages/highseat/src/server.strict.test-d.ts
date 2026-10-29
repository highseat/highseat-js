import { track } from "highseat"
import { createTracker } from "highseat/server"

// Compiles with `index.strict.test-d.ts`, whose `Register` turns strict mode on and declares no
// MCP event: the server knows it anyway.
const tracker = createTracker()

tracker.track("mcp_tool_call", {
  tool: "search_tools",
  client: "claude-ai",
  client_source: "client_info",
  status: "ok",
  results: 0,
  duration_ms: 84,
})

// @ts-expect-error The browser never sends a tool call, so strict mode turns the name away.
track("mcp_tool_call", { tool: "search_tools" })
