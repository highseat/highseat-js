import { OPERATIONS, type operations, type paths } from "./api.gen"

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
  : Route extends { requestBody?: { content: { "application/json": infer Body } } }
    ? { body?: Body }
    : { body?: undefined }

/** What every call may add. */
interface CallOptions {
  /**
   * Makes a `POST` safe to retry: a repeat within 24 hours replays the first answer. A `POST`
   * without one gets a generated key, which covers the client's own retry. Pass your own to
   * cover a retry of the whole call, such as a job that runs again.
   */
  idempotencyKey?: string
  /** Cancels the call. */
  signal?: AbortSignal
}

type Options<Route> = PathOptions<Route> & QueryOptions<Route> & BodyOptions<Route> & CallOptions

type OptionalArgument<Value> = object extends Value ? [options?: Value] : [options: Value]

type Arguments<Route> = OptionalArgument<Options<Route>>

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

/** An operation of the API, named by its operation id. */
type OperationId = keyof operations

/** The values of one kind of parameter, flattened into a named method's options. */
type ValuesOf<Route, Kind extends "path" | "query"> = Route extends {
  parameters: { [Key in Kind]?: infer Values }
}
  ? [NonNullable<Values>] extends [never]
    ? unknown
    : NonNullable<Values>
  : unknown

/** A named method's options: path and query parameters side by side, then the body. */
type NamedOptions<Route> = ValuesOf<Route, "path"> &
  ValuesOf<Route, "query"> &
  BodyOptions<Route> &
  CallOptions

/** One operation, called by its id. */
type NamedCall<Route> = (
  ...options: OptionalArgument<NamedOptions<Route>>
) => Promise<ResultOf<Route>>

/** One method per operation of the API, named by its operation id. */
type NamedMethods = {
  [Id in OperationId]: NamedCall<operations[Id]>
}

/** The row of a list that pages with a cursor, or `never` for any other operation. */
type RowOf<Route> =
  ValuesOf<Route, "query"> extends { cursor?: unknown }
    ? ResultOf<Route> extends { data: (infer Row)[]; nextCursor: unknown }
      ? Row
      : never
    : never

/** The rows of every page of a list, read one page at a time as the loop asks for them. */
export interface PageIterator<Row> extends AsyncIterable<Row> {
  /** Reads every page and answers all their rows, in order. */
  toArray(): Promise<Row[]>
}

/** One iterator per operation that answers a list in cursor pages. */
type PaginateMethods = {
  [Id in OperationId as [RowOf<operations[Id]>] extends [never] ? never : Id]: (
    ...options: OptionalArgument<Omit<NamedOptions<operations[Id]>, "cursor">>
  ) => PageIterator<RowOf<operations[Id]>>
}

/** What a call to a path answers, for naming it in your own code. */
export type ApiResult<Path extends keyof paths, Name extends Method = "get"> = ResultOf<
  Operation<Path, Name>
>

/**
 * A client of the Highseat API. Each operation is a method named by its operation id, such as
 * `getOverview()` or `createNote()`, and `get`, `post`, `patch` and `delete` call any path.
 */
export interface HighseatApi extends NamedMethods {
  /** Calls a path with `GET`. */
  get: Call<"get">
  /** Calls a path with `POST`. */
  post: Call<"post">
  /** Calls a path with `PATCH`. */
  patch: Call<"patch">
  /** Calls a path with `DELETE`. */
  delete: Call<"delete">
  /**
   * Walks a list across its cursor pages, as in
   * `for await (const row of api.paginate.getPages({ site }))`.
   */
  paginate: PaginateMethods
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

/** The options a named method was called with, before they are split. */
type NamedValues = Record<string, unknown>

/** The options a call carries, whichever route it went to. */
interface RawOptions extends CallOptions {
  path?: object
  query?: object
  body?: unknown
}

const DEFAULT_BASE_URL = "https://api.highseat.com/v1"

/** The longest `Retry-After` a refused call waits out before its one retry. */
const MAX_RETRY_WAIT_MS = 5000

/** The wait before retrying `TOO_MANY_CONCURRENT_REQUESTS` when it names none. */
const CONCURRENT_RETRY_WAIT_MS = 1000

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

/** Milliseconds a `Retry-After` header asks for, in seconds or as an HTTP date. */
function parseRetryAfter(value: string | null) {
  if (!value) return

  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)

  const date = Date.parse(value)
  if (Number.isFinite(date)) return Math.max(0, date - Date.now())
}

/**
 * How long to wait before retrying a refused call, or `undefined` when it is not worth one. Both
 * `429` refusals, `RATE_LIMITED` and `TOO_MANY_CONCURRENT_REQUESTS`, send a `Retry-After`. The
 * second is retried even without one, since a running call frees its slot within seconds.
 */
function findRetryWait(response: Response, failure: ApiFailure) {
  const milliseconds =
    parseRetryAfter(response.headers.get("Retry-After")) ??
    (failure.code === "TOO_MANY_CONCURRENT_REQUESTS" ? CONCURRENT_RETRY_WAIT_MS : undefined)

  if (milliseconds !== undefined && milliseconds <= MAX_RETRY_WAIT_MS) return milliseconds
}

/** Waits, unless the call is cancelled first. */
function wait(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)

    const timer = setTimeout(resolve, milliseconds)
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}

/** Splits a named method's options into the path's values, the query and the rest. */
function splitOptions(path: string, options: NamedValues = {}): RawOptions {
  const { body, idempotencyKey, signal, ...values } = options
  const pathValues: NamedValues = {}
  const query: NamedValues = {}

  for (const [name, value] of Object.entries(values)) {
    if (path.includes(`{${name}}`)) pathValues[name] = value
    else query[name] = value
  }

  return {
    path: pathValues,
    query,
    body,
    idempotencyKey: idempotencyKey as string | undefined,
    signal: signal as AbortSignal | undefined,
  }
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
 * Creates a client of the Highseat API. Operations, parameters and answers are typed from the
 * API's OpenAPI document, and a refused call throws {@link HighseatApiError}.
 *
 * A `429` whose `Retry-After` is 5 seconds or less is retried once, after that wait, and so is
 * `TOO_MANY_CONCURRENT_REQUESTS`. A `POST` without an `idempotencyKey` gets a generated one, so
 * its retry writes once.
 *
 * @example
 * ```ts
 * import { createApi } from "highseat/api"
 *
 * const api = createApi({ token: process.env.HIGHSEAT_API_KEY })
 * const { data } = await api.getOverview({ site: "example.com", period: "30d" })
 *
 * for await (const row of api.paginate.getPages({ site: "example.com" })) {
 *   console.log(row.path, row.visitors)
 * }
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

    // A generated key makes the retry below, or the caller's own, write once.
    const idempotencyKey =
      options.idempotencyKey ?? (method === "POST" ? crypto.randomUUID() : undefined)

    if (options.body !== undefined) headers.set("Content-Type", "application/json")
    if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey)

    const url = `${baseUrl}${fillPath(path, options.path)}${formatQuery(options.query)}`
    const init: RequestInit = {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    }

    let response = await fetch(url, init)

    if (response.status === 429) {
      const failure = await parseFailure(response)
      const retryWait = findRetryWait(response, failure)
      if (retryWait === undefined) throw new HighseatApiError(response.status, failure)

      await wait(retryWait, options.signal)
      response = await fetch(url, init)
    }

    if (!response.ok) throw new HighseatApiError(response.status, await parseFailure(response))
    if (response.status === 204) return

    return response.json()
  }

  function createCall(method: string) {
    return (path: string, options?: RawOptions) => send(method, path, options)
  }

  function callOperation(id: OperationId, options?: NamedValues) {
    const [method, path] = OPERATIONS[id]
    return send(method, path, splitOptions(path, options))
  }

  async function* walk(id: OperationId, options: NamedValues = {}) {
    let cursor: string | undefined

    do {
      const page = (await callOperation(id, { ...options, cursor })) as {
        data: unknown[]
        nextCursor: string | null
      }

      yield* page.data
      cursor = page.nextCursor ?? undefined
    } while (cursor)
  }

  function paginate(id: OperationId, options?: NamedValues) {
    return {
      [Symbol.asyncIterator]: () => walk(id, options),
      async toArray() {
        const rows: unknown[] = []
        for await (const row of walk(id, options)) rows.push(row)
        return rows
      },
    }
  }

  /** One function per operation id, each running `run` with its id. */
  function mapOperations(run: (id: OperationId, options?: NamedValues) => unknown) {
    const ids = Object.keys(OPERATIONS) as OperationId[]
    return Object.fromEntries(ids.map(id => [id, (options?: NamedValues) => run(id, options)]))
  }

  // The named methods are built from `OPERATIONS` at run time, so their types come from the cast.
  return {
    ...mapOperations(callOperation),
    get: createCall("GET"),
    post: createCall("POST"),
    patch: createCall("PATCH"),
    delete: createCall("DELETE"),
    paginate: mapOperations(paginate),
  } as unknown as HighseatApi
}
