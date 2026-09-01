---
'@bootnodedev/canton-barebones': minor
---

`validate` now checks that the pinned Splice release still defines everything the
wrapper's compose overrides address by name, and fails naming the mismatch. This
turns a Splice upgrade from a guess into a check: raise `splice.tag`, run
`validate`, and a renamed service or a moved nginx route template is reported
instead of silently producing a stack that starts and misbehaves.
