import type { McpServer, ServerContext } from "@modelcontextprotocol/server"
import { beforeEach, describe, expect, test } from "vitest"
import { mcpLink, type ToolCallTracker, trackToolCalls } from "./mcp"

interface Recorded {
  name: string
  properties: Record<string, unknown>
  options: Record<string, unknown>
}

type Handler = (...args: unknown[]) => unknown

interface FakeServer {
  tools: Record<string, Handler>
  server: McpServer
}

let recorded: Recorded[] = []

const tracker = {
  track: (name: string, properties?: unknown, options?: unknown) => {
    recorded.push({
      name,
      properties: properties as Record<string, unknown>,
      options: (options ?? {}) as Record<string, unknown>,
    })
  },
} as ToolCallTracker

/** Stands in for an SDK `McpServer`: keeps each registered handler so a test can call it. */
function createServer(legacyClient?: { name: string; version: string }): FakeServer {
  const tools: Record<string, Handler> = {}
  const server = {
    _registeredTools: {},
    server: { getClientVersion: () => legacyClient },
    registerTool(name: string, _config: unknown, handler: Handler) {
      tools[name] = handler
      ;(this._registeredTools as Record<string, unknown>)[name] = {}
    },
  }
  return { tools, server: server as unknown as McpServer }
}

/**
 * Registers a tool through whatever `registerTool` the server holds now, wrapped or not. The SDK's
 * own overloads want real schemas and result types, which these fakes leave out.
 */
function registerTool(server: McpServer, name: string, config: object, handler: Handler) {
  const loose = server as unknown as {
    registerTool: (name: string, config: object, handler: Handler) => void
  }
  loose.registerTool(name, config, handler)
}

interface ContextOptions {
  clientInfo?: { name: string; version?: string }
  userAgent?: string
}

function createContext({ clientInfo, userAgent }: ContextOptions = {}) {
  const headers = new Headers(userAgent ? { "user-agent": userAgent } : {})
  return {
    mcpReq: {
      envelope: clientInfo ? { "io.modelcontextprotocol/clientInfo": clientInfo } : undefined,
    },
    // The SDK names the HTTP request `req`, a name this repo's lint keeps out of code.
    http: Object.fromEntries([["req", new Request("https://example.com/mcp", { headers })]]),
  } as unknown as ServerContext
}

function text(value: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(value) }] }
}

beforeEach(() => {
  recorded = []
})

describe("trackToolCalls", () => {
  test("records a call with the client a modern request declares", async () => {
    const { tools, server } = createServer()
    trackToolCalls(server, { tracker, server: "public", hostname: "example.com" })
    registerTool(server, "search", { annotations: { readOnlyHint: true } }, async () =>
      text({ tools: [1, 2, 3], total: 3 }),
    )

    const context = createContext({
      clientInfo: { name: "claude-ai", version: "0.1.0" },
      userAgent: "Claude-User/1.0",
    })
    await tools.search?.({ query: "crm" }, context)

    expect(recorded).toHaveLength(1)
    const [call] = recorded
    expect(call?.name).toBe("mcp_tool_call")
    expect(call?.properties).toEqual({
      tool: "search",
      server: "public",
      client: "claude-ai",
      client_version: "0.1.0",
      client_source: "client_info",
      status: "ok",
      results: 3,
      duration_ms: expect.any(Number) as number,
    })
    expect(call?.options).toEqual({ hostname: "example.com" })
  })

  test("never sends the tool's arguments, the IP or the user agent", async () => {
    const { tools, server } = createServer()
    trackToolCalls(server, { tracker })
    registerTool(server, "search", {}, async () => text([]))

    await tools.search?.({ query: "secret plans" }, createContext({ userAgent: "Claude-User/1.0" }))

    const sent = JSON.stringify(recorded)
    expect(sent).not.toContain("secret plans")
    expect(recorded[0]?.options).not.toHaveProperty("request")
    expect(recorded[0]?.options).not.toHaveProperty("ip")
    expect(recorded[0]?.options).not.toHaveProperty("userAgent")
  })

  test("falls back to the client a stateful server's handshake declared", async () => {
    const { tools, server } = createServer({ name: "Cursor", version: "1.2.0" })
    trackToolCalls(server, { tracker })
    registerTool(server, "search", {}, async () => text([]))

    await tools.search?.({}, createContext({ userAgent: "node" }))

    expect(recorded[0]?.properties).toMatchObject({
      client: "Cursor",
      client_version: "1.2.0",
      client_source: "client_info",
    })
  })

  test("names a legacy client by its User-Agent's product", async () => {
    const { tools, server } = createServer()
    trackToolCalls(server, { tracker })
    registerTool(server, "search", {}, async () => text([]))

    await tools.search?.({}, createContext({ userAgent: "Claude-User (claude.ai)" }))

    expect(recorded[0]?.properties).toMatchObject({
      client: "Claude-User",
      client_source: "user_agent",
    })
    expect(recorded[0]?.properties).not.toHaveProperty("client_version")
  })

  test("records an unknown client when nothing names it", async () => {
    const { tools, server } = createServer()
    trackToolCalls(server, { tracker })
    registerTool(server, "search", {}, async () => text([]))

    await tools.search?.({}, createContext())

    expect(recorded[0]?.properties).toMatchObject({ client: "unknown", client_source: "none" })
  })

  test("passes the context to a tool without an input schema", async () => {
    const { tools, server } = createServer()
    trackToolCalls(server, { tracker })
    registerTool(server, "ping", {}, async (...args: unknown[]) => {
      expect(args).toHaveLength(1)
      return text("pong")
    })

    await tools.ping?.(createContext({ clientInfo: { name: "vscode" } }))

    expect(recorded[0]?.properties).toMatchObject({ tool: "ping", client: "vscode", status: "ok" })
  })

  describe("results", () => {
    async function callReadOnly(result: unknown, readOnlyHint = true) {
      const { tools, server } = createServer()
      trackToolCalls(server, { tracker })
      registerTool(server, "read", { annotations: { readOnlyHint } }, async () => result)
      await tools.read?.({}, createContext())
      return recorded.at(-1)?.properties
    }

    test("counts a list", async () => {
      expect(await callReadOnly(text([1, 2]))).toHaveProperty("results", 2)
    })

    test("counts an empty list as zero", async () => {
      expect(await callReadOnly(text({ data: [], nextCursor: null }))).toHaveProperty("results", 0)
    })

    test("counts the one list an object holds", async () => {
      expect(await callReadOnly(text({ data: [1, 2, 3], meta: {} }))).toHaveProperty("results", 3)
    })

    test("prefers structured content", async () => {
      const result = { content: [{ type: "text", text: "3 tools" }], structuredContent: [1] }
      expect(await callReadOnly(result)).toHaveProperty("results", 1)
    })

    test("leaves out an object with several lists", async () => {
      expect(await callReadOnly(text({ a: [1], b: [2] }))).not.toHaveProperty("results")
    })

    test("leaves out a result that is not a list", async () => {
      expect(await callReadOnly(text({ name: "Acme" }))).not.toHaveProperty("results")
    })

    test("leaves out text that is not JSON", async () => {
      const result = { content: [{ type: "text", text: "Found three tools." }] }
      expect(await callReadOnly(result)).not.toHaveProperty("results")
    })

    test("leaves out a tool that is not read-only", async () => {
      expect(await callReadOnly(text([1, 2]), false)).not.toHaveProperty("results")
    })
  })

  describe("status", () => {
    test("reads the code an error result starts with", async () => {
      const { tools, server } = createServer()
      trackToolCalls(server, { tracker })
      registerTool(server, "get", {}, async () => ({
        isError: true,
        content: [{ type: "text", text: "NOT_FOUND: No tool has that slug." }],
      }))

      await tools.get?.({ slug: "x" }, createContext())

      expect(recorded[0]?.properties).toMatchObject({ status: "NOT_FOUND" })
      expect(recorded[0]?.properties).not.toHaveProperty("results")
    })

    test("records an error result without a code as a tool error", async () => {
      const { tools, server } = createServer()
      trackToolCalls(server, { tracker })
      registerTool(server, "get", {}, async () => ({
        isError: true,
        content: [{ type: "text", text: "Something went wrong." }],
      }))

      await tools.get?.({}, createContext())

      expect(recorded[0]?.properties).toMatchObject({ status: "TOOL_ERROR" })
    })

    test("records a thrown error's code and rethrows it", async () => {
      const { tools, server } = createServer()
      trackToolCalls(server, { tracker })
      const error = Object.assign(new Error("Too many calls"), { code: "RATE_LIMITED" })
      registerTool(server, "get", {}, async () => {
        throw error
      })

      await expect(tools.get?.({}, createContext())).rejects.toBe(error)
      expect(recorded[0]?.properties).toMatchObject({ status: "RATE_LIMITED" })
    })

    test("records a thrown error without a code as an internal error", async () => {
      const { tools, server } = createServer()
      trackToolCalls(server, { tracker })
      registerTool(server, "get", {}, async () => {
        throw new Error("boom")
      })

      await expect(tools.get?.({}, createContext())).rejects.toThrow("boom")
      expect(recorded[0]?.properties).toMatchObject({ status: "INTERNAL_SERVER_ERROR" })
    })
  })

  test("records nothing while a call waits for input from the client", async () => {
    const { tools, server } = createServer()
    trackToolCalls(server, { tracker })
    registerTool(server, "confirm", {}, async () => ({ resultType: "input_required" }))

    await tools.confirm?.({}, createContext())

    expect(recorded).toHaveLength(0)
  })

  test("throws when the server already has tools", () => {
    const { server } = createServer()
    registerTool(server, "early", {}, async () => text([]))

    expect(() => trackToolCalls(server, { tracker })).toThrow(/before registering any tool/)
  })

  test("wraps a server once", async () => {
    const { tools, server } = createServer()
    trackToolCalls(server, { tracker })
    trackToolCalls(server, { tracker })
    registerTool(server, "search", {}, async () => text([]))

    await tools.search?.({}, createContext())

    expect(recorded).toHaveLength(1)
  })
})

describe("mcpLink", () => {
  test("tags a link with the client a wrapped call recorded", async () => {
    const { tools, server } = createServer()
    trackToolCalls(server, { tracker })
    let link = ""
    registerTool(server, "get", {}, async (_args: unknown, context: unknown) => {
      link = mcpLink("https://example.com/tools/acme?ref=list", context as ServerContext)
      return text(link)
    })

    await tools.get?.({}, createContext({ clientInfo: { name: "claude-ai" } }))

    expect(link).toBe("https://example.com/tools/acme?ref=list&utm_source=claude-ai&utm_medium=mcp")
  })

  test("reads the client itself outside a wrapped call", () => {
    const link = mcpLink("https://example.com/", createContext({ userAgent: "ChatGPT-User/1.0" }))

    expect(link).toBe("https://example.com/?utm_source=ChatGPT-User&utm_medium=mcp")
  })

  test("tags an unknown client's link with mcp as its source", () => {
    expect(mcpLink("https://example.com/", createContext())).toBe(
      "https://example.com/?utm_source=mcp&utm_medium=mcp",
    )
  })

  test("keeps a link that already names its source", () => {
    const url = "https://example.com/?utm_source=newsletter"
    expect(mcpLink(url, createContext({ clientInfo: { name: "claude-ai" } }))).toBe(url)
  })
})
