# Canton Barebones

Minimal local Canton stack for developer workflows.

This repository currently wraps Splice LocalNet from a fixed GitHub tag and starts a small baseline stack. We will evolve the configuration and generated services incrementally in future PRs.

## Requirements

- Node.js 22+
- Git
- Docker Compose v2

## Configuration

Run `npm run init` once to scaffold `canton-barebones.config.json`, then edit that file to configure the stack.

The current baseline pins Splice to `canton-network/splice@0.6.11` and starts only the `sv` LocalNet profile.

Generated files and downloaded Splice sources are stored under `.generated/`.

## Getting started

Scaffold the config once, then start the stack. `start` fetches the pinned Splice
source automatically on first run (and whenever the pin changes), so no separate
setup step is required.

```bash
npm run init    # scaffold canton-barebones.config.json (once)
npm run start   # fetch Splice if needed, then start the stack
```

## Commands

```bash
npm run init            # scaffold config and compose overrides into the project
npm run start           # start the stack (fetches Splice if missing or the pin changed)
npm run stop            # stop containers, keep Docker volumes
npm run reset           # stop containers and remove Docker volumes
npm run status          # show compose service status
npm run logs            # show compose logs
npm run validate        # validate config and resolved Splice paths
npm run compose:config  # print the resolved docker compose config
npm run setup           # optional: pre-fetch the pinned Splice source (e.g. CI cache warming)
```

## Current Scope

This first iteration provides the repo structure, config loading, pinned Splice fetch, generated Compose env file, and Docker Compose wrapper commands.
