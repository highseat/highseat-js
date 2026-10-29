import type {
  CallToolResult,
  Implementation,
  McpServer,
  ServerContext,
  ToolAnnotations,
} from "@modelcontextprotocol/server"
import { type ServerBuiltInEvents, type ServerEventOptions, track, type WaitUntil } from "./server"

/**
 * MCP tool calls, recorded from your own MCP server built on the MCP TypeScript SDK v2: one
 * `mcp_tool_call` event per call, with the tool, the client, the outcome and the time it took.
 * The tool's arguments, the caller's IP and its user agent are never sent: assistant directories
 * forbid collecting conversation data, and the caller is the assistant's server, not a person.
 */

type ToolCall = ServerBuiltInEvents["mcp_tool_call"]

/** What the event records about the client behind a call. */
type ToolClient = Pick<ToolCall, "client" | "client_version" | "client_source">

/** What tool calls are sent with: a tracker from `createTracker()`, or any `track()` like its. */
export interface ToolCallTracker {
  track: (name: "mcp_tool_call", properties: ToolCall, options?: ServerEventOptions) => void
}

export interface TrackToolCallsOptions {
  /** The tracker events are sent with. Defaults to the one `track()` from `highseat/server` uses. */
  tracker?: ToolCallTracker
  /** A label for this MCP server, such as `public` or `admin`, when the site runs more than one. */
  server?: string
  /** The site hostname every call is filed under. Defaults to the tracker's `hostname`. */
  hostname?: string
  /**
   * Keeps a serverless function alive until each event is sent: `after` from `next/server`, or
   * `ctx.waitUntil` in a Cloudflare Worker, bound to its object.
   */
  waitUntil?: WaitUntil
}

/** The parts of a tool's registration the wrapper reads. */
interface ToolConfig {
  annotations?: ToolAnnotations
}

type ToolHandler = (...args: unknown[]) => unknown

type RegisterTool = (name: string, config: ToolConfig, handler: ToolHandler) => unknown

/** How a call ended, as the event records it. */
interface ToolOutcome {
  status: string
  results?: number
}

// The `_meta` key a client of the 2026-07-28 protocol names itself under on every request. The
// SDK exports it as `CLIENT_INFO_META_KEY`; it is written out so this module loads no SDK code.
const CLIENT_INFO_KEY = "io.modelcontextprotocol/clientInfo"

// An error code as the agent sees it, such as `NOT_FOUND` or `RATE_LIMITED`.
const ERROR_CODE = /^[A-Z][A-Z0-9_]{1,63}$/
const ERROR_CODE_PREFIX = /^([A-Z][A-Z0-9_]{1,63}):/

// A text result is parsed for its count only below this length, so a large page is never parsed
// a second time.
const MAX_PARSED_LENGTH = 256 * 1024

const wrapped = new WeakSet<McpServer>()

// The client each call was recorded under, so `mcpLink()` tags a link with the same name.
const callClients = new WeakMap<ServerContext, ToolClient>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function toClient(info: Implementation | undefined): ToolClient | undefined {
  if (!info?.name) return
  return {
    client: info.name,
    ...(info.version ? { client_version: info.version } : {}),
    client_source: "client_info",
  }
}

/**
 * The client behind a call. A client of the 2026-07-28 protocol names itself on every request. A
 * 2025-era client names itself only in its `initialize` handshake, which a stateful server
 * remembers and a stateless one never sees again, so its User-Agent's product name stands in.
 */
function readClient(context: ServerContext, server?: McpServer): ToolClient {
  const envelope: unknown = context.mcpReq.envelope
  const declared = isRecord(envelope) ? envelope[CLIENT_INFO_KEY] : undefined

  const client =
    toClient(isRecord(declared) ? (declared as Implementation) : undefined) ??
    toClient(server?.server.getClientVersion())
  if (client) return client

  const product = context.http?.req?.headers.get("user-agent")?.split(/[\s/]/)[0]
  return product
    ? { client: product, client_source: "user_agent" }
    : { client: "unknown", client_source: "none" }
}

/**
 * How many items a result holds: the length of a list, or of the one list a result object holds,
 * such as `data` in a page of rows. A result with no list, or with several, has no count.
 */
function countItems(data: unknown): number | undefined {
  if (Array.isArray(data)) return data.length
  if (!isRecord(data)) return

  const lists = Object.values(data).filter(Array.isArray)
  return lists.length === 1 ? lists[0]?.length : undefined
}

/** The structured data a result carries, or the JSON of its one text block. */
function readData(result: CallToolResult): unknown {
  if (result.structuredContent !== undefined) return result.structuredContent

  const [block, ...rest] = result.content
  if (rest.length > 0 || block?.type !== "text" || block.text.length > MAX_PARSED_LENGTH) return

  try {
    return JSON.parse(block.text) as unknown
  } catch {
    return
  }
}

/** The error code a failed result starts its text with, such as `NOT_FOUND: …`. */
function readErrorCode(result: CallToolResult) {
  const block = result.content.find(content => content.type === "text")
  return block?.type === "text" ? block.text.match(ERROR_CODE_PREFIX)?.[1] : undefined
}

function readOutcome(result: CallToolResult, isReadOnly: boolean): ToolOutcome {
  if (result.isError) return { status: readErrorCode(result) ?? "TOOL_ERROR" }

  const results = isReadOnly ? countItems(readData(result)) : undefined
  return { status: "ok", ...(results === undefined ? {} : { results }) }
}

/** The code a thrown error carries, such as an `ORPCError`'s, or a generic one. */
function readThrownCode(error: unknown) {
  const code = isRecord(error) ? error.code : undefined
  return typeof code === "string" && ERROR_CODE.test(code) ? code : "INTERNAL_SERVER_ERROR"
}

function isCallToolResult(value: unknown): value is CallToolResult {
  return isRecord(value) && Array.isArray(value.content)
}

/**
 * Records every tool call on an MCP server built with the MCP TypeScript SDK v2. Call it once,
 * right after creating the server and before registering any tool: it wraps `registerTool`, so a
 * tool registered earlier would go unrecorded, and it throws when the server already has tools.
 *
 * ```ts
 * const server = new McpServer({ name: "Acme", version: "1.0.0" })
 * trackToolCalls(server, { server: "public" })
 * server.registerTool("search", config, handler)
 * ```
 *
 * Each call sends `mcp_tool_call` with the tool, the client, the status, the time it took and,
 * for a read-only tool whose result is a list, how many items it returned. The tool's arguments,
 * the caller's IP and its user agent are never sent. A call still waiting for input from the
 * client is recorded once it ends. Failures to send never reach the tool: they go to the
 * tracker's `onError`.
 */
export function trackToolCalls(server: McpServer, options: TrackToolCallsOptions = {}): void {
  if (wrapped.has(server)) return

  // The SDK keeps its tools in a private record. Reading it is the only way to tell that some
  // were registered before this call, and a version without it skips the check.
  const registered = (server as unknown as { _registeredTools?: Record<string, unknown> })
    ._registeredTools
  if (registered && Object.keys(registered).length > 0) {
    throw new Error(
      "highseat/mcp: call trackToolCalls() before registering any tool, or those tools go unrecorded.",
    )
  }

  wrapped.add(server)

  const { tracker = { track }, server: label, hostname, waitUntil } = options
  const register = server.registerTool.bind(server) as RegisterTool

  function send(tool: string, client: ToolClient, outcome: ToolOutcome, startedAt: number) {
    tracker.track(
      "mcp_tool_call",
      {
        tool,
        ...(label ? { server: label } : {}),
        ...client,
        ...outcome,
        duration_ms: Math.round(performance.now() - startedAt),
      },
      { ...(hostname ? { hostname } : {}), ...(waitUntil ? { waitUntil } : {}) },
    )
  }

  function registerTracked(name: string, config: ToolConfig, handler: ToolHandler) {
    const isReadOnly = config.annotations?.readOnlyHint === true

    return register(name, config, async (...args: unknown[]) => {
      // The context is the handler's last argument: a tool with an input schema gets its
      // arguments first.
      const context = args.at(-1) as ServerContext
      const client = readClient(context, server)
      callClients.set(context, client)
      const startedAt = performance.now()

      let result: unknown
      try {
        result = await handler(...args)
      } catch (error) {
        send(name, client, { status: readThrownCode(error) }, startedAt)
        throw error
      }

      if (isCallToolResult(result)) send(name, client, readOutcome(result, isReadOnly), startedAt)
      return result
    })
  }

  server.registerTool = registerTracked as McpServer["registerTool"]
}

/**
 * Tags a link a tool returns, so the visit it brings reads as the assistant that showed it:
 * `utm_source` names the client and `utm_medium` is `mcp`, which Highseat reads as the AI
 * channel. A link that already has a `utm_source` is returned as it is. Pass the tool handler's
 * context.
 *
 * ```ts
 * server.registerTool("get_product", config, async ({ slug }, context) => ({
 *   content: [{ type: "text", text: mcpLink(`https://acme.com/products/${slug}`, context) }],
 * }))
 * ```
 */
export function mcpLink(url: string, context: ServerContext): string {
  const link = new URL(url)
  if (link.searchParams.has("utm_source")) return url

  const { client, client_source } = callClients.get(context) ?? readClient(context)
  link.searchParams.set("utm_source", client_source === "none" ? "mcp" : client)
  link.searchParams.set("utm_medium", "mcp")
  return link.href
}
