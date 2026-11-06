import { type ApiResult, createApi } from "highseat/api"

const api = createApi({ token: "hs_live_key" })

export async function readsTypedAnswers(): Promise<void> {
  const { data } = await api.get("/sites/{site}/realtime", { path: { site: "example.com" } })
  const visitors: number = data.visitors
  const credential: ApiResult<"/credential"> = await api.get("/credential")

  console.log(visitors, credential)
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
}
