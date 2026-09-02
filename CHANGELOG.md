# @bootnodedev/canton-barebones

## 0.5.0

### Minor Changes

- 51c708a: Update Splice to 0.7.5

## 0.4.0

### Minor Changes

- d38613b: `validate` now checks that the pinned Splice release still defines everything the
  wrapper's compose overrides address by name, and fails naming the mismatch. This
  turns a Splice upgrade from a guess into a check: raise `splice.tag`, run
  `validate`, and a renamed service or a moved nginx route template is reported
  instead of silently producing a stack that starts and misbehaves.

## 0.3.0

### Minor Changes

- d89682f: Add a dpm distribution channel: the CLI is now also published as a dpm component
  (`oci://ghcr.io/bootnodedev/canton-barebones`) with self-contained binaries for
  linux/darwin/windows — no Node required. Install it by declaring the component in
  `daml.yaml` and running `dpm install package`, then use `dpm canton-barebones <cmd>`
  (alias `dpm cbn`). The npm channel is unchanged.

## 0.2.2

### Patch Changes

- 17059ef: Rename the npm package from `@bootnodedev/cbn` to `@bootnodedev/canton-barebones` to match the repository name. The CLI binary is still `canton-barebones`; `@bootnodedev/cbn` is deprecated on npm and will receive no further releases.

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
