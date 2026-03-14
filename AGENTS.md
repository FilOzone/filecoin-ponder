# filecoin-ponder

This repository is a fork of [Ponder](https://github.com/ponder-sh/ponder), patched to index Filecoin mainnet (chain 314) and calibnet (314159). It is upstream `main` plus one commit of Filecoin fixes, published to npm as `@filoz/ponder`; [foc-observer](https://github.com/FilOzone/foc-observer) consumes it as `"ponder": "npm:@filoz/ponder@<version>"`. Upstream declined the patches ([ponder-sh/ponder#2282](https://github.com/ponder-sh/ponder/pull/2282)). This section covers the fork. Upstream's guide follows, from `# AGENTS.md` down, and applies unchanged except where noted here.

## How Filecoin differs

- **Null rounds.** An epoch (30 seconds) can produce no block. Lotus answers `eth_getBlockByNumber` for one with RPC error code 12 (`requested epoch was a null round`), not `null`, and the answer never changes. A reorg can change which heights are null, so two versions of the chain needn't have blocks at the same heights.
- **Saturated logs bloom.** The FVM sets every `logsBloom` bit, so bloom checks can't skip blocks and "non-zero bloom implies logs" is false.
- **Gateway lookback.** A Lotus gateway serves limited history; old blocks can fail with a lookback error.
- **`eth_getLogs` range limit.** Lotus rejects ranges wider than `MaxFilterHeightRange` (default 2880) in an error format `@ponder/utils` doesn't parse.

## The patches

Under `packages/core/src/`:

- **Null rounds.** `isNullRoundError()` (`rpc/actions.ts`), never retried by `shouldRetry()` (`rpc/index.ts`); historical and realtime sync skip null heights. `reconcileReorg()` (`sync-realtime/index.ts`) matches the common ancestor by the remote parent's hash, never by position, and realtime finality takes the highest local block at or below its target. `eth_getBlockAtOrBelow()` fetches the finalized block at startup (`build/config.ts`) and backfill cutover (`runtime/historical.ts`), stepping down past null rounds.
- **Bloom.** `validateLogsAndBlock()` skips its bloom check when `isFilecoinChain(chainId)` (`utils/finality.ts`, which also sets 900-block finality for both chains).
- **Lookback.** `fetchStartBlock()` (`runtime/index.ts`) substitutes a placeholder block when the start block is beyond the gateway's lookback.
- **`eth_getLogs` ranges.** `utils/getLogsRetryHelper.ts` chunks requests to the range Lotus's error states.
- **RPC timeouts.** 20 seconds, not 10 (`rpc/index.ts`, `rpc/http.ts`).

## Working on the fork

- **Keep the delta small.** Every rebase replays the fork commit onto new upstream code, so change as few upstream lines as a fix needs, and put Filecoin tests in new files (`sync-realtime/null-rounds.test.ts`).
- **Assume nothing about heights.** Code that fetches a block by number must handle a null round; code that walks or compares chains by position breaks when null rounds move. Match blocks by hash, and take the nearest block at or below a height.
- **Leave other chains alone.** Patches are no-ops where every height holds a block, or gated on `isFilecoinChain()`.
- **Upstream's tests can't produce null rounds** (Anvil), so Filecoin cases use a stub RPC. A stub must return a fresh object per call, because Ponder mutates the blocks it receives.
- **Not in the fork:** changesets, `packages/core/CHANGELOG.md` edits and changes to `packages/utils`. The changelog is upstream's, and `@ponder/utils` comes from upstream's npm releases. `packages/core` publishes as `@filoz/ponder`, not `ponder`; `pnpm --filter ponder` still selects it, as pnpm allows omitting an unambiguous scope.
- **Releases and rebases:** see `README.md`. After a rebase, recheck the patches against upstream rewrites of realtime reorg handling, finality, the finalized-block fetch and `eth_getLogs` request merging.
- Write code comments year-zero, describing the code as it is; history belongs in the commit message. Report vulnerabilities privately as the [FilOzone security policy](https://github.com/FilOzone/.github/blob/main/SECURITY.md) describes.
- `CLAUDE.md` contains only `@AGENTS.md`, because Claude Code skips `AGENTS.md` when a `CLAUDE.md` exists. Keep content here, and keep this section accurate with the code.

# AGENTS.md

## Repository Shape
- This is a pnpm `11.0.0` workspace; install with `pnpm install --frozen-lockfile` to match CI. Node must be `>=22`; CI currently uses Node `24.8` and a pinned Foundry nightly.
- Workspace packages are `packages/*`, `docs`, `examples/**`, `simulation-test`, and `benchmark`.
- `packages/core` publishes the `ponder` npm package. Public exports start in `packages/core/src/index.ts`; the CLI bin starts in `packages/core/src/bin/ponder.ts`.
- `packages/core` and `packages/react` build with custom `build.ts` scripts. `packages/client`, `packages/utils`, and `packages/create-ponder` build with tsup.
- Core source uses `@/*` path aliases. The core build rewrites these aliases in `dist/esm` and `dist/types`, so do not replace source aliases just to satisfy package output.

## Commands
- Build publishable packages: `pnpm build`.
- Lint and format use Biome: `pnpm lint`, `pnpm format`, `pnpm lint:fix`.
- Root typecheck covers `packages/**` only: `pnpm typecheck`.
- Focused package checks: `pnpm --filter ponder typecheck`, `pnpm --filter @ponder/client typecheck`, `pnpm --filter @ponder/utils typecheck`, `pnpm --filter create-ponder typecheck`.
- Focused tests: `CI=1 pnpm --filter ponder test src/path.test.ts`, `CI=1 pnpm --filter @ponder/client test src/index.test.ts`, `pnpm --filter create-ponder test`.
- Type-level Vitest suites use separate scripts where present: `pnpm --filter ponder test:typecheck`, `pnpm --filter @ponder/client test:typecheck`, `pnpm --filter @ponder/react test:typecheck`.
- `pnpm test` runs all workspace test scripts in parallel with `--no-bail`; several package scripts are plain `vitest`, so set `CI=1` for one-shot local runs and prefer `--filter` to avoid unrelated network-heavy suites.

## Tests And Environment
- Core Vitest setup (`packages/core/vite.config.ts`) caps threads at 4, loads `packages/core/src/_test/setup.ts`, and runs `packages/core/src/_test/globalSetup.ts`.
- Core global setup generates `packages/core/src/_test/generated.ts` with `pnpm wagmi generate` if missing, then starts an Anvil proxy. Foundry/Anvil must be installed for core tests.
- Core database tests default to in-memory PGlite. Set `DATABASE_URL` in `packages/core/.env.local` only when intentionally testing Postgres; tests create and drop `vitest_*` databases/roles.
- `packages/utils/src/_test/*` contains live RPC-provider tests that require `RPC_URL_*` values from `packages/utils/.env.example`; avoid broad utils/root test runs unless those env vars and network access are intended.
- `simulation-test` and `benchmark` use Bun scripts and external Postgres/RPC env from their `.env.example` files. Their `DATABASE_URL` should omit a database name; scripts append app-specific database names.

## Memory Profiling
- Profile memory while running an example app, such as `feature-multichain`. Run it for several minutes so finalization occurs; temporarily comment out chains when necessary to keep the workload practical.
- Expose V8 garbage collection with `NODE_OPTIONS=--expose-gc`. Call `global.gc()` immediately before every reading so the measurement compares retained objects rather than differences in GC timing.
- Print `process.memoryUsage()` values for `rss`, `heapUsed`, `heapTotal`, and `external`, plus `v8.getHeapStatistics().heap_size_limit`. Report values in MiB, for example: `[memory] rss=...MiB heapUsed=...MiB heapTotal=...MiB heapLimit=...MiB external=...MiB`.
- Keep profiling code temporary and rebuild `packages/core` after removing it so ignored `dist/` artifacts do not retain stale instrumentation. Never commit RPC or database credentials from local profiling environments.

## Generated Or Copied Files
- `packages/core/src/_test/generated.ts` is generated by Wagmi from Foundry contracts under `packages/core/src/_test/contracts/` and is ignored by Biome.
- `packages/create-ponder` build copies root `examples/` into `packages/create-ponder/templates`, excludes multi-app examples (`with-nextjs`, `with-foundry`, `with-trpc`, `with-client`, `with-offchain`), renames dotfiles, and blanks RPC URLs in generated `_dot_env.local` files.
- Biome intentionally ignores `docs/`, `dist/`, generated folders, `.ponder`, cache/out directories, Solidity files, and `pnpm-lock.yaml`.

## Docs, Examples, Releases
- Docs are a Vocs app in `docs`; use `pnpm --filter ponder-docs dev` or `pnpm --filter ponder-docs build`.
- CI separately verifies the Next.js frontend example with `pnpm --filter ponder-examples-with-nextjs-frontend build` after `pnpm build`.

## Changesets
- Changesets are fixed for `ponder`, `create-ponder`, `eslint-config-ponder`, `@ponder/client`, and `@ponder/react`; docs/examples are ignored. Create changesets with `pnpm changeset`. Public API or bug-fix PRs normally need a patch changeset.
- Changesets has a bug for fixed packages at pre-`1.0.0` versions with a minor component of `10` or greater: a `minor` changeset incorrectly produces `1.0.0`. Manually correct the generated release PR to the next `0.x` minor version (for example, `0.16.10` to `0.17.0`) before merging.
- Write changesets in the same voice as `packages/core/CHANGELOG.md`: concise, user-facing, past tense, and focused on observable behavior.
- Start with the outcome, not the implementation. Prefer phrasing like "Fixed a bug that caused...", "Fixed a regression introduced in `v0.16.0` that caused...", "Improved...", "Added...", "Updated...", or "Removed...".
- Include concrete symptoms when helpful, especially exact error messages in backticks. Use patterns like "Fixed the error `...`" or "that caused `...`".
- Name affected APIs, config fields, commands, packages, and options with backticks, such as `ponder.config.ts`, `context.client`, `context.db`, `@ponder/client`, `p.bytes()`, `ordering: "omnichain"`, and `ponder db list`.
- Use repository vocabulary consistently: Ponder, GraphQL, JSON-RPC, RPC, Postgres, PGlite, backfill, live, crash recovery, factory, and rpc cache.
- Avoid implementation details, internal refactors, PR narration, and vague language unless the detail explains user impact. Do not write "this PR", "we", "users may notice", "various fixes", or "some improvements".
- Keep each changeset entry narrow. If a PR includes unrelated user-facing changes, use multiple changesets or multiple short paragraphs so each changelog bullet is easy to scan.
- For dependency-only updates, only write a custom changeset if there is a user-facing reason, such as a security patch or a fixed runtime error.
