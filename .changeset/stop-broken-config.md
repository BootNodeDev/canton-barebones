---
"@bootnodedev/cbn": patch
---

`stop` no longer requires a fully valid config: it reads only `composeProjectName` and tears the stack down by Compose project label (`docker compose -p <name> down --remove-orphans`), so a broken config can still stop a running stack. If `composeProjectName` itself is missing or invalid, `stop` fails with the usual config error. All other Docker commands still validate the full config.
