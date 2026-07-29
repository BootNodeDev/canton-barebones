---
"@bootnodedev/cbn": patch
---

Fix the `bin` path in package.json (`./bin/…` → `bin/…`) so npm 11 no longer strips the `canton-barebones` executable when publishing.
