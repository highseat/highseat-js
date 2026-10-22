import { Highseat } from "highseat/next"
import { connection } from "next/server"
import { Suspense } from "react"

// Renders at request time, where the server has no HIGHSEAT_PATH, so the script's src can only
// come from the path the build wrote.
async function RequestTimeHighseat() {
  await connection()
  return <Highseat site="site_request_time" />
}

export default function Page() {
  return (
    <Suspense>
      <RequestTimeHighseat />
    </Suspense>
  )
}
