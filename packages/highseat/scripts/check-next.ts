import { spawnSync, type SpawnSyncOptions } from "node:child_process"
import { renameSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Builds the Next.js App Router app in `fixtures/next-app` against the packed package, the
 * tarball npm would receive. Its root layout renders `<Highseat />` from `highseat/next` with
 * Cache Components on, and a client component calls `useIdentify`, so `next build` prerenders
 * both across the client boundary. Run after `build`.
 */

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const DIST = path.join(PACKAGE_ROOT, "dist")
const FIXTURE = path.join(PACKAGE_ROOT, "fixtures/next-app")

function run(command: string, args: string[], options: SpawnSyncOptions): string {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: "pipe", ...options })
  const output = `${result.stdout?.toString() ?? ""}${result.stderr?.toString() ?? ""}`

  if (result.status !== 0) {
    console.error(output)
    process.exit(result.status ?? 1)
  }
  return output
}

const tarball = run("npm", ["pack", "--silent", "--pack-destination", FIXTURE], { cwd: DIST })
renameSync(path.join(FIXTURE, tarball.trim()), path.join(FIXTURE, "highseat.tgz"))

// Every pack has the same name and version, so `--force` stops Bun reusing a cached one.
run("bun", ["install", "--force"], { cwd: FIXTURE })

// The fixture's `.env.production` sets the site and the proxy path.
console.log(run("bun", ["run", "build"], { cwd: FIXTURE }))
