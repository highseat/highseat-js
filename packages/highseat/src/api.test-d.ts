import { type ApiResult, createApi, type PageIterator } from "highseat/api"

/** True only when both types are the same, optional members included. */
type Equal<Left, Right> =
  (<Type>() => Type extends Left ? 1 : 2) extends <Type>() => Type extends Right ? 1 : 2
    ? true
    : false

interface Figures {
  pageviews: number
  visitors: number
  sessions: number
  bounceRate: number | null
  avgDuration: number | null
  events: number
  revenue: number
  buyers?: number
  purchaserRate?: number
  revenuePerVisitor?: number
  importedExcluded?: boolean
  importedPartial?: boolean
}

interface OverviewFigures extends Figures {
  hasRevenue: boolean
  previous?: Figures
}

interface Range {
  from: string
  to: string
}

/** The overview's answer as the snapshot states it, so any change to it fails this file. */
interface OverviewAnswer {
  data: OverviewFigures
  meta: { timezone: string; currency: string; range: Range | null; compare: Range | null }
}

const api = createApi({ token: "hs_live_key" })

export async function readsTypedAnswers(): Promise<void> {
  const { data } = await api.get("/sites/{site}/realtime", { path: { site: "example.com" } })
  const visitors: number = data.visitors
  const credential: ApiResult<"/credential"> = await api.get("/credential")

  console.log(visitors, credential)
}

export async function callsOperationsByName(): Promise<void> {
  const overview = await api.getOverview({ site: "example.com", period: "30d" })
  const pageviews: number = overview.data.pageviews
  const pinned: Equal<typeof overview, OverviewAnswer> = true
  const sameAnswer: ApiResult<"/sites/{site}/overview"> = overview

  const note = await api.createNote({
    site: "example.com",
    body: { date: "2026-11-09", text: "Launch" },
  })
  const noteId: string = note.data.id
  const credential = await api.getCredential()

  console.log(pageviews, pinned, sameAnswer, noteId, credential)
}

export async function walksPages(): Promise<void> {
  const pages: PageIterator<{ path: string; visitors: number }> = api.paginate.getPages({
    site: "example.com",
    period: "30d",
  })

  for await (const row of pages) console.log(row.path)

  const notes = await api.paginate.listNotes({ site: "example.com" }).toArray()
  console.log(notes.map(note => note.text))
}

export async function refusesMistakes(): Promise<void> {
  // @ts-expect-error A path the API does not have.
  await api.get("/nothing")

  // @ts-expect-error A route with a path parameter needs it.
  await api.get("/sites/{site}/realtime")

  // @ts-expect-error `/credential` takes no POST.
  await api.post("/credential")

  await api.get("/sites/{site}/overview", {
    path: { site: "example.com" },
    // @ts-expect-error A query parameter the route does not take.
    query: { nothing: "1" },
  })

  // @ts-expect-error A named method needs its path parameter.
  await api.getOverview({ period: "30d" })

  // @ts-expect-error A query parameter the operation does not take.
  await api.getOverview({ site: "example.com", nothing: "1" })

  // @ts-expect-error A write needs its body.
  await api.createNote({ site: "example.com" })

  const overview = await api.getOverview({ site: "example.com" })
  // @ts-expect-error The overview answers no rows.
  console.log(overview.data.path)

  // @ts-expect-error The overview is not a list, so it has no iterator.
  api.paginate.getOverview({ site: "example.com" })

  // @ts-expect-error The iterator walks the cursor itself.
  api.paginate.getPages({ site: "example.com", cursor: "next" })
}
