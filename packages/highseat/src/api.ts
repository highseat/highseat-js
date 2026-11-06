import type { paths } from "./api.gen"

type Method = "get" | "post" | "patch" | "delete"

/** A path of the API that answers a method. */
type PathOf<Name extends Method> = {
  [Path in keyof paths]: paths[Path] extends Record<Name, object> ? Path : never
}[keyof paths]

type Operation<Path extends keyof paths, Name extends Method> = paths[Path][Name &
  keyof paths[Path]]

type PathOptions<Route> = Route extends { parameters: { path: infer Values } }
  ? { path: Values }
  : { path?: undefined }

type QueryOptions<Route> = Route extends { parameters: { query: infer Values } }
  ? { query: Values }
  : Route extends { parameters: { query?: infer Values } }
    ? { query?: Values }
    : { query?: undefined }

type BodyOptions<Route> = Route extends {
  requestBody: { content: { "application/json": infer Body } }
}
  ? { body: Body }
  : { body?: undefined }

/** What every call may add. */
interface CallOptions {
  /** Makes a `POST` safe to retry: a repeat within 24 hours replays the first answer. */
  idempotencyKey?: string
  /** Cancels the call. */
  signal?: AbortSignal
}

type Options<Route> = PathOptions<Route> & QueryOptions<Route> & BodyOptions<Route> & CallOptions

type Arguments<Route> =
  object extends Options<Route> ? [options?: Options<Route>] : [options: Options<Route>]

type JsonOf<Response> = Response extends { content: { "application/json": infer Body } }
  ? Body
  : undefined

type ResultOf<Route> = Route extends { responses: infer Responses }
  ? JsonOf<Responses[Extract<keyof Responses, 200 | 201 | 202 | 204>]>
  : never

type Call<Name extends Method> = <Path extends PathOf<Name>>(
  path: Path,
  ...options: Arguments<Operation<Path, Name>>
) => Promise<ResultOf<Operation<Path, Name>>>

/** What a call to a path answers, for naming it in your own code. */
export type ApiResult<Path extends keyof paths, Name extends Method = "get"> = ResultOf<
  Operation<Path, Name>
>

/** A client of the Highseat API, with one typed function per HTTP method. */
export interface HighseatApi {
  get: Call<"get">
  post: Call<"post">
  patch: Call<"patch">
  delete: Call<"delete">
}

/** How to reach the API. */
export interface ApiOptions {
  /**
   * An API key or an OAuth access token. Pass a function when the token changes, as an OAuth
   * token does when it is refreshed: it runs before every call.
   */
  token: string | (() => string | Promise<string>)
  /** The API's address, with its version. Defaults to `https://api.highseat.com/v1`. */
  baseUrl?: string
  /** Replaces the global `fetch`. */
  fetch?: typeof globalThis.fetch
}

/** One invalid parameter of a refused call. */
export interface ApiIssue {
  /** The parameter at fault, such as `["filter", 1]` for the second filter. */
  path: (string | number)[]
  message: string
}

interface ApiFailure {
  code?: string
  message?: string
  requestId?: string
  id?: string
  issues?: ApiIssue[]
}

/** The options a call carries, whichever route it went to. */
interface RawOptions extends CallOptions {
  path?: object
  query?: object
  body?: unknown
}

const DEFAULT_BASE_URL = "https://api.highseat.com/v1"

/** A failure that carries no error body, such as an answer from a proxy in front of the API. */
const UNKNOWN_CODE = "INTERNAL_SERVER_ERROR"

/** A call the API refused. Branch on `code`, which is stable. */
export class HighseatApiError extends Error {
  /** The HTTP status. */
  readonly status: number
  /** Stable and machine-readable, such as `RATE_LIMITED`. */
  readonly code: string
  /** Names the request. Quote it to support. */
  readonly requestId?: string
  /** On a conflict, the existing row's id. */
  readonly id?: string
  /** One entry per invalid parameter. */
  readonly issues?: ApiIssue[]

  constructor(status: number, failure: ApiFailure) {
    super(failure.message ?? `The Highseat API answered ${status}.`)
    this.name = "HighseatApiError"
    this.status = status
    this.code = failure.code ?? UNKNOWN_CODE
    this.requestId = failure.requestId
    this.id = failure.id
    this.issues = failure.issues
  }
}

function fillPath(path: string, values: object = {}) {
  return Object.entries(values).reduce(
    (filled, [name, value]) => filled.replace(`{${name}}`, encodeURIComponent(String(value))),
    path,
  )
}

/** The query string of a call. A list repeats its parameter, and an absent value is left out. */
function formatQuery(query: object = {}) {
  const params = new URLSearchParams()

  for (const [name, value] of Object.entries(query)) {
    for (const item of [value].flat()) {
      if (item !== undefined && item !== null) params.append(name, String(item))
    }
  }

  const text = params.toString()
  return text && `?${text}`
}

async function parseFailure(response: Response): Promise<ApiFailure> {
  try {
    const body = (await response.json()) as { error?: ApiFailure }
    return body.error ?? {}
  } catch {
    return {}
  }
}

/**
 * Creates a client of the Highseat API. Paths, parameters and answers are typed from the API's
 * OpenAPI document, and a refused call throws {@link HighseatApiError}.
 *
 * @example
 * ```ts
 * import { createApi } from "highseat/api"
 *
 * const api = createApi({ token: process.env.HIGHSEAT_API_KEY })
 * const { data } = await api.get("/sites/{site}/realtime", { path: { site: "example.com" } })
 * ```
 */
export function createApi({
  token,
  baseUrl = DEFAULT_BASE_URL,
  fetch = globalThis.fetch,
}: ApiOptions): HighseatApi {
  async function send(method: string, path: string, options: RawOptions = {}) {
    const headers = new Headers({
      Authorization: `Bearer ${typeof token === "function" ? await token() : token}`,
    })

    if (options.body !== undefined) headers.set("Content-Type", "application/json")
    if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey)

    const url = `${baseUrl}${fillPath(path, options.path)}${formatQuery(options.query)}`
    const response = await fetch(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    })

    if (!response.ok) throw new HighseatApiError(response.status, await parseFailure(response))
    if (response.status === 204) return

    return response.json()
  }

  function createCall(method: string) {
    return (path: string, options?: RawOptions) => send(method, path, options)
  }

  return {
    get: createCall("GET"),
    post: createCall("POST"),
    patch: createCall("PATCH"),
    delete: createCall("DELETE"),
  } as HighseatApi
}
