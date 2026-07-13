# Canton Barebones

Minimal local Canton stack for developer workflows.

This repository currently wraps Splice LocalNet from a fixed GitHub tag and starts a small baseline stack. We will evolve the configuration and generated services incrementally in future PRs.

## Requirements

- Node.js 22+
- Git
- Docker Compose v2

## Configuration

The stack is configured in `canton-barebones.config.json`.

The current baseline pins Splice to `canton-network/splice@0.6.11` and starts only the `sv` LocalNet profile.

Generated files and downloaded Splice sources are stored under `.generated/`.

## Commands

```bash
npm run setup
npm run validate
npm run compose:config
npm run start
npm run status
npm run logs
npm run stop
npm run reset
```

`stop` keeps Docker volumes. `reset` removes Docker volumes.

## Current Scope

This first iteration provides the repo structure, config loading, pinned Splice fetch, generated Compose env file, and Docker Compose wrapper commands.
