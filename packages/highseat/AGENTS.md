# `highseat`: agent guidelines

The one public npm package. Everything else in this monorepo is private and unversioned. Customers install it, so its names, subpaths and option shapes are a contract: a rename is a breaking release, not a refactor.

## Shape

- One unscoped package with subpath exports: `highseat`, `highseat/react`, `highseat/next`, `highseat/proxy`. A new subpath gets an `exports` entry, a `tsdown.config.ts` entry, and a line in `ALLOWED_IMPORTS` in `scripts/check-exports.ts`.
- Frameworks are optional peers (`peerDependenciesMeta`). A subpath imports only the frameworks it names: `highseat` and `highseat/proxy` import none, so they run in a Worker without React installed. `bun run check-exports` (after `bun run build`) walks each subpath's built import graph and loads it alone in a fresh Node process.
- No internal dependency: no `@highseat/*` import, no shared tsconfig. The package builds alone in the public mirror, which holds nothing else.
- `package.json` points each `exports` entry at `./src/*.ts` under `types` and `default`, so the workspace reads the source. The condition is `default`, never `import`: Next.js loads `next.config.ts` through `require`, which an `import`-only entry refuses with `ERR_PACKAGE_PATH_NOT_EXPORTED`, so `withHighseat()` could not be imported. `check-exports` loads each subpath through both. The build is ES modules only, and `require` loads an ES module without a flag from Node 20.19 and 22.12, which is why `engines` starts there. Lowering it means a CommonJS build beside the ESM one, plus a `require` condition that `kodeks prepare-package` does not write today. The build writes `dist`, which is what npm receives: tsdown emits the code and declarations, then `kodeks prepare-package` writes `dist/package.json` with `exports` pointing at the built files.
- **`NEXT_PHASE` is unset when Next.js loads `next.config.ts`**: it hands the phase only to a config written as a function, and sets the variable in the build's route workers alone. So `createProxy()` reads `NEXT_PHASE` (it runs in those workers), while `withHighseat()` tells `next build` from `next dev` inside `rewrites()`, which the build calls in production mode, dev in development, and `next start` never.
- Document the public API with `/** */` above each export and each interface member. A trailing `//` comment, which the repo allows on type members elsewhere, is dropped from the published `.d.ts`, so a customer's editor never shows it.

## Tests

- `src/<module>.test.ts` imports from `vitest`. The same files run on three runtimes: `bun run test:node`, `bun run test:bun` (Bun reads the `vitest` imports natively) and `bun run test:workerd` (inside workerd through Miniflare). CI runs all three; a green Node run says nothing about a Worker.
- Type-level tests live in `src/<module>.test-d.ts`, importing from `highseat` as a customer would. Each `@ts-expect-error` names the mistake it pins. `bun run check-types` runs them, and an expected error that stops occurring fails it.
- Augmenting `Register` changes every file in the same program, so the strict-mode tests sit in `src/index.strict.test-d.ts` and compile alone through `tsconfig.strict.json`, which `check-types` runs second.

## Releasing

The monorepo is private, and npm attests provenance only for a package published from a public repository. So the package is versioned here and published from the public mirror, [`highseat/highseat-js`](https://github.com/highseat/highseat-js). The commands and the reusable workflows come from `@dirstack/kodeks`.

1. **A PR that changes what the package ships carries a changeset**: `bunx changeset`, pick `highseat`, choose the bump, and write the entry for customers (it lands in the public changelog). A test, a comment or a CI change needs none. Only `highseat` is versioned: `privatePackages` keeps every private workspace out.
2. **`version.yml`** opens or updates the "Version Packages" PR while changesets are pending. Merging it bumps the version, writes `CHANGELOG.md` and refreshes `bun.lock`.
3. **`sync-public.yml`** copies `packages/highseat` and the mirror's root files from `.github/mirror/` into the mirror on every push to `main` that touches them, with the `MIRROR_DEPLOY_KEY` deploy key.
4. **The mirror's `release.yml`** builds and runs `kodeks publish`: every version not yet on npm goes out with provenance through npm trusted publishing, under the dist-tag its prerelease names (`0.1.0-alpha.0` under `alpha`, a plain version under `latest`). A version already on npm is skipped, so a re-run publishes nothing.

Rules:

- **Never publish from here.** No `npm publish`, no `NPM_TOKEN`, in any workflow or by hand. A version published outside the mirror has no provenance, and the mirror's next run skips it as already published.
- **Never edit the mirror.** Every sync replaces its `packages` directory, and its root files come from `.github/mirror/` here. Change them here, including the mirror's `release.yml`. The mirror keeps its own `bun.lock`, which the sync refreshes and the release installs from with `--frozen-lockfile`.
- **Kodeks is pinned exactly.** `version.yml`, `sync-public.yml` and the mirror's `release.yml` call its workflows at the SHA of a kodeks release, and the root, `.github/mirror/package.json` and this package take its exact version, never a range. The sync receives the deploy key and the release can publish, and the mirror's `bun.lock` is written by the sync, not reviewed in a PR, so a range would let an unreviewed kodeks run with the publish credential. Bump all six together.
- **The mirror's `release.yml` keeps its name.** npm trusts that file by name (package `highseat`, Settings, Trusted publishing: owner `highseat`, repository `highseat-js`, workflow `release.yml`). Renaming it breaks publishing until the trusted publisher is updated on npmjs.com.
- **Prereleases**: `.changeset/pre.json` keeps the repository in `alpha` pre mode, so every bump is `x.y.z-alpha.N` and `latest` keeps pointing at the last stable version. `bunx changeset pre exit` in a PR returns to stable versions.
- **Preview builds**: the `package` workflow attaches the packed tarball to every run on a PR that touches the package, with the install line in the run's summary.
