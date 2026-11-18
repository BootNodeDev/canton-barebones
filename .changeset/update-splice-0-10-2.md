---
"@bootnodedev/canton-barebones": minor
---

Update Splice to 0.10.2. Splice 0.10 runs Postgres 18 with its data mounted at `/var/lib/postgresql`, so `start` on a volume an earlier release wrote stops at `container postgres exited (1)`. Move the data to Postgres 18 (`pg_dumpall` from 14, restore into 18) or `reset` the stack before starting.
