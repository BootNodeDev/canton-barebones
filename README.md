# Canton Barebones

Minimal local Canton stack for developer workflows.

## What this is

[Canton](https://www.canton.network/) is the blockchain network; [Splice](https://github.com/hyperledger-labs/splice) is the application stack that runs on it and ships a ready-made **LocalNet** — a set of Docker Compose files for running a whole Canton network on your machine.

Splice LocalNet is powerful but has many moving parts and knobs. This tool is a thin wrapper around it: you get a single small config file and a handful of commands (`init`, `start`, `stop`, ...), and it takes care of downloading Splice, translating your config into the right Docker Compose invocation, and running it. It does **not** fork or copy Splice — it fetches a pinned version and drives it as-is.

## Requirements

- Node.js 22+
- Git
- Docker Compose v2

## Getting started

### From npm

> The npm package name is **TBD** (not published yet) — replace `<package>` below once it is published.

```bash
npx <package> init     # scaffold the config file into the current folder (run once)
npx <package> start    # download Splice if needed, then start the stack
```

`npx` pulls the runtime dependencies automatically, so there is no separate install step.

### From a cloned repo

```bash
npm install     # install dependencies (run once)
npm run init    # scaffold the config file into your project (run once)
npm run start   # download Splice if needed, then start the stack
```

## How it works

There are two locations to keep in mind (see `src/paths.js`):

- **the package** — where this tool is installed; holds the bundled default files.
- **the project** — the folder you run commands from; holds your config, your overrides, and everything under `.generated/`.

The lifecycle:

```
npm run init
  └─ copies bundled templates into your project (once):
       canton-barebones.config.json      ← the stack config you edit
       splice-localnet-overrides.yaml    ← local Docker Compose tweaks

npm run start   (and stop / status / logs / validate — anything that reads config)
  └─ loadConfig()                         (src/config.js)  reads + validates your config
       ├─ ensureSpliceCheckout()          (src/splice.js)  downloads Splice on first run
       └─ runDockerCompose()              (src/compose.js) generates runtime files, runs compose
```

`init` only copies files. Nothing is downloaded and nothing runs until `start` (or any other config-reading command).

## The `.generated/` folder

Created lazily by the first command that reads your config (not by `init`). It is disposable and git-ignored — delete it and it is rebuilt on the next `start`.

| Path                                         | Written by       | What it is                                                           |
| -------------------------------------------- | ---------------- | -------------------------------------------------------------------- |
| `.generated/splice/<repo>/<tag>/…/localnet/` | `src/splice.js`  | the downloaded Splice LocalNet files for the pinned version          |
| `.generated/localnet.env`                    | `src/compose.js` | environment values that pass your config into Splice's compose files |
| `.generated/empty.env`                       | `src/compose.js` | an empty placeholder some compose files expect                       |

## Configuration

Run `npm run init` once to scaffold `canton-barebones.config.json`, then edit it. The scaffolded default is a **minimal working stack**: the SV plus the `appUser` validator running headless (its backend, no UIs); `appProvider` and all tools are off. You turn things on as you need them.

A Canton network here has three kinds of pieces:

- **SV** (Super Validator) — the node that runs the _global synchronizer_, the shared backbone all participants connect to. It is required infrastructure, so it always runs fully (backend + its web dashboards). It has nothing to configure.
- **Validators** — the participant nodes that run your apps. Splice's LocalNet ships two fixed slots, `appProvider` and `appUser`. Each has `enabled` (run its backend) and `ui` (also expose its web UIs).
- **Network tools** — utilities that work across the nodes: the Canton `console`, `multiSync` (adds a second, local synchronizer), and `swaggerUI` (API docs).

```jsonc
{
  "version": 1,
  "splice": { "repo": "canton-network/splice", "tag": "0.6.11" }, // which Splice version to download
  "composeProjectName": "canton-barebones", // Docker Compose project name
  "dockerNetwork": "cantonBarebones", // Docker network name
  "persistence": { "mode": "persistent" }, // "persistent" keeps volumes; "ephemeral" wipes on reset

  "validators": {
    "appProvider": { "enabled": false, "ui": false }, // enabled = backend; ui = also show its web UIs
    "appUser": { "enabled": true, "ui": false }, // default: backend on, UIs off (headless)
  },

  "networkTools": { "console": false, "multiSync": false, "swaggerUI": false },
}
```

Rules:

- `ui` needs the backend, so it can only be `true` when that validator's `enabled` is `true`.
- A validator's UIs come as one bundle (wallet + ANS): it is on-or-off per validator, not per individual UI. `enabled: true, ui: false` runs it **headless** — backend only, reached on its direct API ports.
- Config changes take effect on the next `start`.

### How your config becomes running services

`src/compose.js` translates the config into the Docker Compose invocation (see the module comment there for detail). Splice wires nginx to route to each participant's UIs as fixed upstreams and refuses to start if one is missing, which shapes the levers:

| Config                   | Effect                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| always                   | `--profile sv` runs the SV fully and, with it, the shared postgres/canton/splice/nginx                              |
| `validators.*.enabled`   | switches that validator's backend on/off via an env var                                                             |
| `validators.*.ui`        | on → also starts that validator's UIs; off (but enabled) → nginx is told to skip that validator so it runs headless |
| a `networkTools` flag on | starts that tool via its profile                                                                                    |

So the default config launches the SV plus a headless `appUser`, and each flag you flip adds more. (For _why_ a headless validator needs special handling, see [Design notes](#design-notes).)

## UIs and endpoints

Assuming every flag is on, this is everything the stack exposes. Each participant gets its own nginx port (`sv` 4000, `app-provider` 3000, `app-user` 2000), and its web UIs and ledger APIs are reached through hostnames on that port. A validator's routes only appear when its `ui: true`; the SV is always on. All `*.localhost` names resolve to `127.0.0.1` automatically.

> In **headless** mode (`enabled: true, ui: false`) a validator's nginx routes below are not exposed. Reach its ledger API on the direct participant ports instead: JSON on `<prefix>975`, gRPC on `<prefix>901`, where the prefix is `2`/`3`/`4` — e.g. `localhost:2975` (JSON) and `localhost:2901` (gRPC) for app-user.

### SV (port 4000, always on)

| Surface                 | URL                                       |
| ----------------------- | ----------------------------------------- |
| SV operations dashboard | http://sv.localhost:4000                  |
| Scan (network explorer) | http://scan.localhost:4000                |
| Wallet                  | http://wallet.localhost:4000              |
| JSON Ledger API         | http://canton.localhost:4000/v2           |
| OpenAPI spec            | http://canton.localhost:4000/docs/openapi |

### app-user (port 2000, requires `validators.appUser.ui: true`)

| Surface            | URL                                                                     |
| ------------------ | ----------------------------------------------------------------------- |
| Wallet             | http://wallet.localhost:2000                                            |
| ANS (name service) | http://ans.localhost:2000                                               |
| JSON Ledger API    | http://json-ledger-api.localhost:2000 (or http://canton.localhost:2000) |
| gRPC Ledger API    | grpc-ledger-api.localhost:2000 (http2)                                  |
| OpenAPI spec       | http://canton.localhost:2000/docs/openapi                               |

### app-provider (port 3000, requires `validators.appProvider.ui: true`)

| Surface            | URL                                                                     |
| ------------------ | ----------------------------------------------------------------------- |
| Wallet             | http://wallet.localhost:3000                                            |
| ANS (name service) | http://ans.localhost:3000                                               |
| JSON Ledger API    | http://json-ledger-api.localhost:3000 (or http://canton.localhost:3000) |
| gRPC Ledger API    | grpc-ledger-api.localhost:3000 (http2)                                  |
| OpenAPI spec       | http://canton.localhost:3000/docs/openapi                               |

### Network tools

| Tool                             | URL / access                                               | Requires                 |
| -------------------------------- | ---------------------------------------------------------- | ------------------------ |
| Swagger UI (aggregated API docs) | http://localhost:9090                                      | `networkTools.swaggerUI` |
| Canton console                   | interactive container, no web UI (`docker attach console`) | `networkTools.console`   |
| Multi-sync                       | no UI (adds a second local synchronizer)                   | `networkTools.multiSync` |

## CLI reference

The binary is `canton-barebones <command>`; the `npm run <command>` scripts wrap it. To pass a flag through npm, add `--` first (e.g. `npm run validate -- --json`).

| Command           | What it does                                                                                                    | Side effects                                                                                                             | Docker |
| ----------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------ |
| `init [--force]`  | Scaffold the config and compose override into the project                                                       | Writes `canton-barebones.config.json` and `splice-localnet-overrides.yaml` (existing files are skipped unless `--force`) | no     |
| `setup`           | Download the pinned Splice LocalNet source                                                                      | Writes `.generated/splice/…` on first run                                                                                | no     |
| `validate`        | Validate the config and resolved Splice paths                                                                   | Writes `.generated/localnet.env`; downloads Splice on first run                                                          | no     |
| `start`           | Start the stack (`docker compose up -d`)                                                                        | Starts containers, creates volumes and the Docker network                                                                | yes    |
| `stop`            | Stop containers, keep volumes (`docker compose down`)                                                           | Removes containers; data volumes are preserved                                                                           | yes    |
| `reset`           | Stop containers and remove volumes (`docker compose down -v`)                                                   | **Deletes all stack data**                                                                                               | yes    |
| `status`          | Show service status (`docker compose ps`)                                                                       | none                                                                                                                     | yes    |
| `logs [args…]`    | Show logs (`docker compose logs`); extra args pass through                                                      | none                                                                                                                     | yes    |
| `compose <args…>` | Run docker compose with the configured LocalNet files; **no args prints the computed docker command** (dry run) | depends on the args                                                                                                      | yes    |

**Exit codes & output.** Every command exits `0` on success and `1` on failure, printing the error message to stderr.

**`--json`** (on `validate`, `setup`, `status`) switches to machine-readable output: success goes to stdout, and on failure a `{ "ok": false, "error": "…" }` object goes to stderr, still exiting `1`. Use `validate --json` to see exactly what a config resolves to **without starting anything** — its `plan` field lists the compose profiles, headless validators, and participant env:

```bash
canton-barebones validate --json
# { "ok": true, "plan": { "upProfiles": ["sv","app-user"], "headlessValidators": [], "nodeEnv": {…} }, … }

canton-barebones status --json    # one JSON object per service, straight from docker compose
```

## Verifying the stack

`status` (or `status --json`) shows containers, but a container being up is not the same as a participant serving. To confirm a participant's backend is actually live, hit its `readyz` — the same probe Splice uses internally. Each participant has a port prefix: **`2` app-user, `3` app-provider, `4` sv**.

```bash
curl -sf http://localhost:2903/api/validator/readyz && echo "app-user ready"   # 3903 = app-provider, 4903 = sv
docker exec splice ls /app/app-user/                                           # → "on" when that participant is active
```

For UIs, request them through nginx by hostname (see [UIs and endpoints](#uis-and-endpoints)), e.g. `curl -sI -H 'Host: wallet.localhost' http://localhost:2000/`.

## Operational notes

Non-obvious behaviors worth knowing before automating against the stack:

- **No per-validator backend container.** The `sv`, `app-provider`, and `app-user` backends are multiplexed into the shared `canton` and `splice` containers, selected by the `*_PROFILE` env vars — not separate containers. Only the UIs and network tools run as their own containers, so `docker ps` never shows an `app-user` service.
- **Ports are published statically.** Each participant's ports (prefix `2`/`3`/`4`) are always bound while the shared containers run, even for disabled participants. A bound port does **not** mean something is answering — use `readyz` as the source of truth.
- **UIs go through nginx**, published on ports `2000`/`3000`/`4000`, not as per-UI host ports. `*.localhost` hostnames resolve to `127.0.0.1` automatically.
- **Config changes apply on the next `start`** — nothing reacts to the file while the stack is running.

## Troubleshooting

| Symptom                                              | Cause                                                                        | Fix                                                              |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `Config version N is not compatible …`               | The config predates the current schema                                       | `init --force` to get the new defaults, then re-apply your edits |
| `Invalid canton-barebones.config.json: …`            | A field is missing, mistyped, or the wrong type (the message names the path) | Fix the named field and re-run                                   |
| `docker is required to run the stack`                | Docker is not installed or not running                                       | Install / start Docker, then retry                               |
| Port already in use (e.g. `2000`, `4903`, `5432`)    | Another stack (or the same one) is already up on that port                   | `stop` the running stack, or free the port                       |
| Containers are up but a participant does not respond | A bound port is not the same as a live backend                               | Check `readyz` (see [Verifying the stack](#verifying-the-stack)) |
| Stale or corrupted state after config churn          | Volumes hold old data                                                        | `reset` to wipe volumes, then `start`                            |
| Anything under `.generated/` looks wrong             | It is disposable                                                             | Delete `.generated/` — it is rebuilt on the next `start`         |

## Development

### Source layout

| File                      | Responsibility                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| `bin/canton-barebones.js` | CLI entry point: parses the command and `--json`, dispatches to `src/*`                              |
| `src/config.js`           | Loads and zod-validates the config; resolves runtime paths and the pinned Splice checkout            |
| `src/compose.js`          | Turns the config into the Docker Compose invocation (profiles, env, generated overrides) and runs it |
| `src/splice.js`           | Downloads and pins the Splice LocalNet source into `.generated/`                                     |
| `src/init.js`             | Scaffolds the bundled templates into the project (`init`)                                            |
| `src/output.js`           | Centralizes CLI output: human text vs `--json`, stdout vs stderr                                     |
| `src/paths.js`            | Resolves paths against the package (bundled files) vs the project (your files)                       |

### Testing

| Command            | What it runs                                                                                                             | Needs Docker              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| `npm test`         | Unit tests (`node --test` over `scripts/**/*.test.js`) — config schema validation and the runtime plan                   | no                        |
| `npm run test:e2e` | Smoke test (`scripts/smoke.js`) — resolves the default config (SV + headless `appUser`) and drives a valid compose model | yes (+ a Splice checkout) |

Run `npm test` for a fast check without Docker; run `npm run test:e2e` to exercise the full compose model end to end.

## Design notes

Deeper mechanics, not needed for day-to-day use.

### How a headless validator works (the nginx override)

Running a validator with its backend on but its UIs off (`enabled: true, ui: false`) needs a small trick, because Splice couples the two through nginx:

1. The nginx image renders every `/etc/nginx/templates/*.template` file into `/etc/nginx/conf.d/` at startup.
2. Splice mounts each validator's routing config there (e.g. `app-user.conf` → `/etc/nginx/templates/app-user.conf.template`). That config proxies to the validator's UI containers as fixed upstreams, and nginx **refuses to start** if an upstream host does not exist.
3. Because the validator's backend is on, Splice renders its nginx config — so nginx would look for UI containers that we did not start, and crash.

CantonBarebones works around this without editing any Splice file. Docker Compose deduplicates volume mounts by their target path, and the **last `-f` wins**. So the wrapper writes a generated override (`.generated/service-overrides.yaml`, passed last) that mounts an **empty file** over that exact template path:

```
Splice:            conf/nginx/app-user.conf → /etc/nginx/templates/app-user.conf.template
Generated override: (empty file)            → /etc/nginx/templates/app-user.conf.template   ← wins

nginx renders an empty app-user.conf → no routes for it → starts fine.
```

The validator's backend still runs (it is driven by an env var, not nginx) and stays reachable on its direct API ports; only its web routing is dropped. See `templates/splice-localnet-overrides.yaml` and `src/compose.js` for the full detail.
