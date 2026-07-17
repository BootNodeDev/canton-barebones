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

Run `npm run init` once to scaffold `canton-barebones.config.json`, then edit it. It pins the Splice version and selects which parts of the stack to run. The current baseline pins `canton-network/splice@0.6.11`.

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
