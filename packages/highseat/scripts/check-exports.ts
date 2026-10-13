import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

/**
 * Checks the built package: every subpath loads on its own in a fresh Node process, and its
 * import graph reaches no package outside the frameworks that subpath names. A site that never
 * installs React must be able to import `highseat` and `highseat/proxy`. Run after `build`.
 */

interface PackageManifest {
  exports: Record<string, string>
}

// The packages each subpath may import. A new subpath fails the check until it is listed here.
const ALLOWED_IMPORTS: Record<string, string[]> = {
  ".": [],
  "./next": ["next", "react"],
  "./proxy": [],
  "./react": ["react"],
}

const IMPORT_PATTERN =
  /(?:^|[;\s])(?:import|export)\s*(?:[\w*{}\s,]*?\sfrom\s*)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const DIST = path.join(PACKAGE_ROOT, "dist")

function getPackageName(specifier: string): string {
  const parts = specifier.split("/")
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier)
}

function getDistFile(sourcePath: string): string {
  return path.join(DIST, `${path.basename(sourcePath).replace(/\.tsx?$/, "")}.js`)
}

// Follows relative imports through the built files and collects every other specifier.
function collectImports(entry: string): Set<string> {
  const packages = new Set<string>()
  const visited = new Set<string>()
  const queue = [entry]

  while (queue.length > 0) {
    const file = queue.pop()
    if (!file || visited.has(file)) continue
    visited.add(file)

    for (const match of readFileSync(file, "utf8").matchAll(IMPORT_PATTERN)) {
      const specifier = match[1] ?? match[2]
      if (!specifier) continue

      if (specifier.startsWith(".")) {
        queue.push(path.resolve(path.dirname(file), specifier))
      } else {
        packages.add(specifier.startsWith("node:") ? specifier : getPackageName(specifier))
      }
    }
  }

  return packages
}

function findLoadError(file: string): string | undefined {
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", `await import(${JSON.stringify(pathToFileURL(file).href)})`],
    { encoding: "utf8" },
  )

  if (result.status === 0) return
  return result.stderr.trim()
}

const manifest = JSON.parse(
  readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"),
) as PackageManifest
const failures: string[] = []

for (const [subpath, sourcePath] of Object.entries(manifest.exports)) {
  const allowed = ALLOWED_IMPORTS[subpath]
  const file = getDistFile(sourcePath)

  if (!allowed) {
    failures.push(`${subpath}: not listed in ALLOWED_IMPORTS`)
    continue
  }

  for (const specifier of collectImports(file)) {
    if (!allowed.includes(specifier)) failures.push(`${subpath}: imports "${specifier}"`)
  }

  const error = findLoadError(file)
  if (error) failures.push(`${subpath}: does not load on its own\n${error}`)
}

if (failures.length > 0) {
  console.error(failures.join("\n"))
  process.exit(1)
}

console.log(`${Object.keys(manifest.exports).length} subpaths load on their own`)
