# AGENTS.md

Operating instructions for AI agents working in this repo. Human docs live in [README.md](./README.md); this file covers what an agent needs to work here safely and points into the README for the rest.

## What this project is

A thin wrapper around [Splice](https://github.com/hyperledger-labs/splice) LocalNet: one config file (`canton-barebones.config.json`) plus a small CLI (`init`, `start`, `stop`, …) that downloads a pinned Splice version and drives it via Docker Compose. It does **not** fork or copy Splice. See [README → What this is](./README.md#what-this-is).

## Commands

- `npm test` — unit tests (`node --test`), no Docker. **Run after any change.**
- `npm run test:e2e` — resolves the default config and drives the full compose model. Needs Docker + a Splice checkout.
- `npm run validate -- --json` — resolve a config to its compose plan **without starting anything**. Fastest way to see the effect of a config change.
- Passing a flag through an `npm run` script requires `--` first (e.g. `npm run validate -- --json`).

## Architecture

Two locations matter (see `src/paths.js`): **the package** (installed tool, bundled defaults) and **the project** (the folder commands run from, holding config, overrides, and `.generated/`).

Config-reading commands flow through `loadConfig()` → `ensureSpliceCheckout()` → `runDockerCompose()`. For the per-file responsibilities, see [README → Source layout](./README.md#source-layout). Do not restate that table here — read it there.

## Gotchas

Non-obvious behavior that will mislead an agent (fuller list in [README → Operational notes](./README.md#operational-notes)):

- **No per-validator backend container.** `sv`/`app-provider`/`app-user` backends are multiplexed into the shared `canton` and `splice` containers via `*_PROFILE` env vars. `docker ps` never shows an `app-user` service — do not conclude a participant is missing from its absence.
- **A bound port ≠ a live backend.** Ports are published statically while the shared containers run, even for disabled participants. Use `readyz` as the source of truth (see [README → Verifying the stack](./README.md#verifying-the-stack)).
- **`.generated/` is disposable.** Never edit downloaded Splice files or anything else under it — it is git-ignored and rebuilt on the next `start`. Changes belong in config, templates, or `src/`.
- **Config applies on next `start`.** Nothing reacts to the config file while the stack is running.
- **`reset` deletes all stack data** (removes volumes). Never run it to "clean up" without explicit intent.
