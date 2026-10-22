import { spawn, spawnSync, type SpawnSyncOptions } from "node:child_process"
import { renameSync, rmSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Builds the Next.js App Router app in `fixtures/next-app` against the packed package, the
 * tarball npm would receive. Its root layout renders `<Highseat />` from `highseat/next` with
 * Cache Components on, and a client component calls `useIdentify`, so `next build` prerenders
 * both across the client boundary.
 *
 * Each build, with Turbopack and with webpack, gets `HIGHSEAT_PATH`, and the server it starts
 * does not, as in a Docker image that takes the path as a build argument. A page rendered at
 * request time must still load the tracker from the path. Run after `build`.
 */

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const DIST = path.join(PACKAGE_ROOT, "dist")
const FIXTURE = path.join(PACKAGE_ROOT, "fixtures/next-app")
const PROXY_PATH = "/3f9a0c1e2b"
const PORT = "6390"

function run(command: string, args: string[], options: SpawnSyncOptions): string {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: "pipe", ...options })
  const output = `${result.stdout?.toString() ?? ""}${result.stderr?.toString() ?? ""}`

  if (result.status !== 0) {
    console.error(output)
    process.exit(result.status ?? 1)
  }
  return output
}

/** The HTML of `pathname` from `next start`, with `HIGHSEAT_PATH` dropped from its env. */
async function fetchWithoutPath(pathname: string): Promise<string> {
  // The server gets its own process group, so killing the group stops Next.js as well as Bun.
  const server = spawn("env", ["-u", "HIGHSEAT_PATH", "bun", "run", "start", "--port", PORT], {
    cwd: FIXTURE,
    detached: true,
    stdio: "ignore",
  })

  try {
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        return await (await fetch(`http://localhost:${PORT}${pathname}`)).text()
      } catch {
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    }
    throw new Error("next start never answered")
  } finally {
    if (server.pid) process.kill(-server.pid)
  }
}

const tarball = run("npm", ["pack", "--silent", "--pack-destination", FIXTURE], { cwd: DIST })
renameSync(path.join(FIXTURE, tarball.trim()), path.join(FIXTURE, "highseat.tgz"))

// Every pack has the same name and version, so `--force` stops Bun reusing a cached one. The
// lockfile is deleted too, since Bun installs the hash it pins.
rmSync(path.join(FIXTURE, "bun.lock"), { force: true })
run("bun", ["install", "--force"], { cwd: FIXTURE })

for (const bundler of ["--turbopack", "--webpack"]) {
  // Webpack's cache keys a package by its version, which every pack shares, so a kept cache
  // builds the previous pack.
  rmSync(path.join(FIXTURE, ".next"), { force: true, recursive: true })

  // The fixture's `.env.production` sets the site id. The proxy path is set for the build alone.
  console.log(
    run("env", [`HIGHSEAT_PATH=${PROXY_PATH}`, "bun", "run", "build", bundler], { cwd: FIXTURE }),
  )

  // The RSC payload in the HTML escapes its quotes, so the props are matched loosely.
  const props = (await fetchWithoutPath("/dynamic")).match(/site_request_time[^}]*/)?.[0]

  if (!props?.includes(PROXY_PATH)) {
    console.error(`check-next: ${bundler} rendered no proxy src at request time: ${props}`)
    process.exit(1)
  }
}
