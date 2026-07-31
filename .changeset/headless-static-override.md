---
"@bootnodedev/cbn": patch
---

Headless validators are now driven by the static `templates/runtime-overrides.yaml` via env vars: each validator's nginx route template is mounted from `${*_NGINX_ROUTES}`, pointing at Splice's real routing config when the UI is on or at an empty file when it is off. `writeGeneratedOverride` and the generated `.generated/service-overrides.yaml` are gone — no YAML is generated from JS anymore.
