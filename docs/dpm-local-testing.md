# Testing the dpm component locally

End-to-end test of the dpm distribution channel without publishing anything to a real
registry: build the component, publish it to a throwaway local OCI registry, and consume
it exactly like a user would. The whole flow runs on one machine and was how the channel
was originally validated.

Requirements: Docker, [Bun](https://bun.sh) (compiles the binaries), and
[dpm](https://github.com/digital-asset/dpm) >= 1.0.21 (`add component` does not exist in
older versions).

## 1. Build and publish to a local registry

From the repo root:

```bash
npm run build:component

# Port 5001 because macOS often occupies 5000 (AirPlay).
docker run -d --name cb-registry -p 5001:5000 registry:2

dpm publish component 'oci://localhost:5001/bootnodedev/canton-barebones:0.0.1' \
  -p linux/amd64=dist/dpm-component/linux-amd64 \
  -p linux/arm64=dist/dpm-component/linux-arm64 \
  -p darwin/amd64=dist/dpm-component/darwin-amd64 \
  -p darwin/arm64=dist/dpm-component/darwin-arm64 \
  -p windows/amd64=dist/dpm-component/windows-amd64 \
  --insecure
```

The version tag must be strict semver (dpm rejects anything else). Republishing the same
tag overwrites it, which is fine for local iteration.

## 2. Consume it like a user

```bash
export DPM_INSECURE_REGISTRY=true   # see quirks below

mkdir /tmp/cb-demo && cd /tmp/cb-demo
printf 'name: demo\nversion: 0.1.0\n' > daml.yaml   # dpm add requires a project manifest

dpm add component oci://localhost:5001/bootnodedev/canton-barebones:0.0.1 --insecure

dpm canton-barebones init
dpm canton-barebones validate
dpm canton-barebones start
dpm cbn status                      # the alias works too
dpm canton-barebones reset
```

`dpm add component` pins the component by sha256 in `daml.yaml`; from then on dpm runs
the cached binary directly (inheriting your cwd, so config and `.generated/` land in the
project, same as the npm channel).

## 3. Clean up

```bash
dpm canton-barebones reset          # tears down the stack and removes volumes
docker rm -f cb-registry
rm -rf /tmp/cb-demo
unset DPM_INSECURE_REGISTRY         # it overrides your real dpm registry config
```

## Quirks worth knowing (they cost us time)

- **`DPM_INSECURE_REGISTRY=true` is required for http registries.** The `--insecure`
  flag covers the resolve step but not the pull, which still insists on https
  (dpm 1.0.21). Both are only needed against `localhost` — the real ghcr channel uses
  https and needs neither.
- **`dpm add component` requires a `daml.yaml`** (or `multi-package.yaml`) — it records
  the component there. A two-line stub is enough outside a real Daml project.
- **`dpm component run` needs `--` before passthrough flags.** The ad-hoc runner
  (`dpm component run canton-barebones 0.0.1 canton-barebones validate`) parses flags
  like `--json` itself unless you separate them:
  `dpm component run canton-barebones 0.0.1 -- canton-barebones status --json`.
  Project-installed commands (`dpm canton-barebones status --json`) pass flags through
  without the separator.
- **Short names only resolve against dpm's configured registry** (Digital Asset's, under
  its `components/` path convention). Third-party components like this one are always
  referenced by full `oci://` URI.
