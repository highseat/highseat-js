import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

/**
 * Checks the built package: every subpath loads on its own in a fresh Node process, through
 * `import` and through `require`, and its import graph reaches no package outside the frameworks
 * that subpath names. A site that never installs React must be able to import `highseat` and
 * `highseat/proxy`, and Next.js loads `next.config.ts` with `require`. Run after `build`.
 */

interface PackageManifest {
  exports: Record<string, { default?: string }>
}

// The packages each subpath may import. A new subpath fails the check until it is listed here.
const ALLOWED_IMPORTS: Record<string, string[]> = {
  ".": [],
  "./next": ["next", "react"],
  "./proxy": [],
  "./react": ["react"],
  "./server": [],
  "./mcp": [],
}

// The subpaths whose built file must open with "use client", so a React Server Components app
// renders them on the client.
const CLIENT_ENTRIES = new Set(["./react"])

// The server entries that render a client component, and the client file they must import it
// from. Importing the component from any other built file skips its "use client" boundary.
const CLIENT_IMPORTS: Record<string, string> = { "./next": "./react.js" }

// The built files keep the JSDoc, whose usage examples import from the package itself.
const BLOCK_COMMENT_PATTERN = /\/\*[\s\S]*?\*\//g

const IMPORT_PATTERN =
  /(?:^|[;\s])(?:import|export)\s*(?:[\w*{}\s,]*?\sfrom\s*)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const DIST = path.join(PACKAGE_ROOT, "dist")

function getPackageName(specifier: string): string {
  const parts = specifier.split("/")
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier)
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

    for (const match of readFileSync(file, "utf8")
      .replace(BLOCK_COMMENT_PATTERN, "")
      .matchAll(IMPORT_PATTERN)) {
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

function findLoadError(file: string, loader: "import" | "require"): string | undefined {
  const source =
    loader === "import"
      ? `await import(${JSON.stringify(pathToFileURL(file).href)})`
      : `import { createRequire } from "node:module"; createRequire(import.meta.url)(${JSON.stringify(file)})`
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    encoding: "utf8",
  })

  if (result.status === 0) return
  return result.stderr.trim()
}

// The manifest npm receives, whose `default` condition is what both `import` and `require` reach.
const manifest = JSON.parse(
  readFileSync(path.join(DIST, "package.json"), "utf8"),
) as PackageManifest
const failures: string[] = []

for (const [subpath, conditions] of Object.entries(manifest.exports)) {
  const allowed = ALLOWED_IMPORTS[subpath]

  if (!allowed) {
    failures.push(`${subpath}: not listed in ALLOWED_IMPORTS`)
    continue
  }

  if (!conditions.default) {
    failures.push(`${subpath}: no "default" condition, so \`require\` cannot resolve it`)
    continue
  }

  const file = path.join(DIST, conditions.default)
  const source = readFileSync(file, "utf8")

  for (const specifier of collectImports(file)) {
    if (!allowed.includes(specifier)) failures.push(`${subpath}: imports "${specifier}"`)
  }

  if (CLIENT_ENTRIES.has(subpath) && !source.startsWith('"use client"')) {
    failures.push(`${subpath}: lost its "use client" directive`)
  }

  const clientImport = CLIENT_IMPORTS[subpath]
  if (clientImport && !source.includes(`from "${clientImport}"`)) {
    failures.push(`${subpath}: does not import its client component from ${clientImport}`)
  }

  for (const loader of ["import", "require"] as const) {
    const error = findLoadError(file, loader)
    if (error) failures.push(`${subpath}: does not load on its own through ${loader}\n${error}`)
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"))
  process.exit(1)
}

console.log(`${Object.keys(manifest.exports).length} subpaths load on their own`)
