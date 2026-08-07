---
"@bootnodedev/canton-barebones": minor
---

Add a dpm distribution channel: the CLI is now also published as a dpm component
(`oci://ghcr.io/bootnodedev/canton-barebones`) with self-contained binaries for
linux/darwin/windows — no Node required. Install it by declaring the component in
`daml.yaml` and running `dpm install package`, then use `dpm canton-barebones <cmd>`
(alias `dpm cbn`). The npm channel is unchanged.
