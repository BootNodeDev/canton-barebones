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

```bash
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

| Path | Written by | What it is |
| --- | --- | --- |
| `.generated/splice/<repo>/<tag>/…/localnet/` | `src/splice.js` | the downloaded Splice LocalNet files for the pinned version |
| `.generated/localnet.env` | `src/compose.js` | environment values that pass your config into Splice's compose files |
| `.generated/empty.env` | `src/compose.js` | an empty placeholder some compose files expect |

## Configuration

Run `npm run init` once to scaffold `canton-barebones.config.json`, then edit it. The scaffolded default is a **minimal working stack**: the SV plus the `appUser` validator running headless (its backend, no UIs); `appProvider` and all tools are off. You turn things on as you need them.

A Canton network here has three kinds of pieces:

- **SV** (Super Validator) — the node that runs the *global synchronizer*, the shared backbone all participants connect to. It is required infrastructure, so it always runs fully (backend + its web dashboards). It has nothing to configure.
- **Validators** — the participant nodes that run your apps. Splice's LocalNet ships two fixed slots, `appProvider` and `appUser`. Each has `enabled` (run its backend) and `ui` (also expose its web UIs).
- **Network tools** — utilities that work across the nodes: the Canton `console`, `multiSync` (adds a second, local synchronizer), and `swaggerUI` (API docs).

```jsonc
{
  "version": 1,
  "splice": { "repo": "canton-network/splice", "tag": "0.6.11" }, // which Splice version to download
  "composeProjectName": "canton-barebones",   // Docker Compose project name
  "dockerNetwork": "cantonBarebones",         // Docker network name
  "resourceConstraints": true,                 // apply Splice's CPU/memory limits
  "persistence": { "mode": "persistent" },     // "persistent" keeps volumes; "ephemeral" wipes on reset

  "validators": {
    "appProvider": { "enabled": false, "ui": false },  // enabled = backend; ui = also show its web UIs
    "appUser":     { "enabled": true,  "ui": false }   // default: backend on, UIs off (headless)
  },

  "networkTools": { "console": false, "multiSync": false, "swaggerUI": false }
}
```

Rules:

- `ui` needs the backend, so it can only be `true` when that validator's `enabled` is `true`.
- A validator's UIs come as one bundle (wallet + ANS): it is on-or-off per validator, not per individual UI. `enabled: true, ui: false` runs it **headless** — backend only, reached on its direct API ports.
- Config changes take effect on the next `start`.

### How your config becomes running services

`src/compose.js` translates the config into the Docker Compose invocation (see the module comment there for detail). Splice wires nginx to route to each participant's UIs as fixed upstreams and refuses to start if one is missing, which shapes the levers:

| Config | Effect |
| --- | --- |
| always | `--profile sv` runs the SV fully and, with it, the shared postgres/canton/splice/nginx |
| `validators.*.enabled` | switches that validator's backend on/off via an env var |
| `validators.*.ui` | on → also starts that validator's UIs; off (but enabled) → nginx is told to skip that validator so it runs headless |
| a `networkTools` flag on | starts that tool via its profile |

So the default config launches the SV plus a headless `appUser`, and each flag you flip adds more.

### How a headless validator works (the nginx override)

Running a validator with its backend on but its UIs off (`enabled: true, ui: false`) needs a small trick, because Splice couples the two through nginx:

1. The nginx image renders every `/etc/nginx/templates/*.template` file into `/etc/nginx/conf.d/` at startup.
2. Splice mounts each validator's routing config there (e.g. `app-user.conf` → `/etc/nginx/templates/app-user.conf.template`). That config proxies to the validator's UI containers as fixed upstreams, and nginx **refuses to start** if an upstream host does not exist.
3. Because the validator's backend is on, Splice renders its nginx config — so nginx would look for UI containers that we did not start, and crash.

The wrapper works around this without editing any Splice file. Docker Compose deduplicates volume mounts by their target path, and the **last `-f` wins**. So the wrapper writes a generated override (`.generated/service-overrides.yaml`, passed last) that mounts an **empty file** over that exact template path:

```
Splice:            conf/nginx/app-user.conf → /etc/nginx/templates/app-user.conf.template
Generated override: (empty file)            → /etc/nginx/templates/app-user.conf.template   ← wins

nginx renders an empty app-user.conf → no routes for it → starts fine.
```

The validator's backend still runs (it is driven by an env var, not nginx) and stays reachable on its direct API ports; only its web routing is dropped. See `templates/splice-localnet-overrides.yaml` and `src/compose.js` for the full detail.

## Commands

```bash
npm run init            # scaffold config and compose overrides into the project
npm run start           # start the stack (downloads Splice if missing or the pin changed)
npm run stop            # stop containers, keep Docker volumes
npm run reset           # stop containers and remove Docker volumes
npm run status          # show compose service status
npm run logs            # show compose logs
npm run validate        # validate config and resolved Splice paths
npm run compose:config  # print the resolved docker compose config
npm run setup           # optional: pre-download the pinned Splice source (e.g. CI cache warming)
```
