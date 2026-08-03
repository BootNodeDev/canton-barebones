# @bootnodedev/cbn

## 0.2.1

### Patch Changes

- a210900: `stop` no longer requires a fully valid config: it reads only `composeProjectName` and tears the stack down by Compose project label (`docker compose -p <name> down --remove-orphans`), so a broken config can still stop a running stack. If `composeProjectName` itself is missing or invalid, `stop` fails with the usual config error. All other Docker commands still validate the full config.

## 0.2.0

### Minor Changes

- f637315: Add per-UI `sv` config flags (`scanUI`, `svUI`, `walletUI`) to toggle the SV-facing web UIs. A static override shipped with the package (`templates/runtime-overrides.yaml`) pins each disabled UI to 0 replicas and aliases its hostname onto nginx — driven purely by env vars — so the stack stays healthy and the SV's API routes keep working either way.

### Patch Changes

- 95acdda: Headless validators are now driven by the static `templates/runtime-overrides.yaml` via env vars: each validator's nginx route template is mounted from `${*_NGINX_ROUTES}`, pointing at Splice's real routing config when the UI is on or at an empty file when it is off. `writeGeneratedOverride` and the generated `.generated/service-overrides.yaml` are gone — no YAML is generated from JS anymore.

## 0.1.3

### Patch Changes

- 333675b: Fix the `bin` path in package.json (`./bin/…` → `bin/…`) so npm 11 no longer strips the `canton-barebones` executable when publishing.

## 0.1.2

### Patch Changes

- ab1d41a: Add instructions when the init command completes successfully.
