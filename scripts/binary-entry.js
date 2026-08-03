// Entry point for the standalone-binary build (`npm run build:binary`), the
// distribution channel used by dpm components. It is only ever compiled by
// `bun build --compile` — never executed by Node — which is why it can use
// Bun's `with { type: 'text' }` imports: they inline each template's content
// into the binary at compile time, keeping templates/ as the single source of
// truth. The registered contents are materialized back to disk on demand by
// src/paths.js, since `init` and docker compose need real files.
import configTemplate from '../templates/canton-barebones.config.json' with { type: 'text' };
import runtimeOverridesTemplate from '../templates/runtime-overrides.yaml' with { type: 'text' };
import localnetOverridesTemplate from '../templates/splice-localnet-overrides.yaml' with { type: 'text' };

import { registerEmbeddedPackageFiles } from '../src/paths.js';

registerEmbeddedPackageFiles({
  'templates/canton-barebones.config.json': configTemplate,
  'templates/runtime-overrides.yaml': runtimeOverridesTemplate,
  'templates/splice-localnet-overrides.yaml': localnetOverridesTemplate,
});

// Imported dynamically so registration above runs first; a static import would
// be hoisted and dispatch the command before the templates are registered.
await import('../bin/canton-barebones.js');
