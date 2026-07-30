---
"@bootnodedev/cbn": minor
---

Add per-UI `sv` config flags (`scanUI`, `svUI`, `walletUI`) to toggle the SV-facing web UIs. A static override shipped with the package (`templates/runtime-overrides.yaml`) pins each disabled UI to 0 replicas and aliases its hostname onto nginx — driven purely by env vars — so the stack stays healthy and the SV's API routes keep working either way.
