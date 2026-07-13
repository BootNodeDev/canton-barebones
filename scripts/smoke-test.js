import assert from 'node:assert/strict';
import fs from 'node:fs';

import { loadConfig } from '../src/config.js';
import { runDockerCompose, writeRuntimeEnv } from '../src/compose.js';

const config = loadConfig();
const runtimeEnvPath = writeRuntimeEnv(config);
const localnetOverride = fs.readFileSync(config.localnetOverridePath, 'utf8');

// This smoke test proves the default config resolves the pinned Splice checkout,
// writes generated runtime files, and produces a valid Docker Compose model.
assert.equal(config.imageTag.length > 0, true);
assert.equal(config.splice.repo, 'canton-network/splice');
assert.equal(config.splice.tag, '0.6.11');
assert.deepEqual(config.profiles, ['sv']);
assert.equal(config.persistence.mode, 'persistent');
assert.equal(runtimeEnvPath.endsWith('.generated/localnet.env'), true);
assert.equal(config.localnetOverridePath.endsWith('splice-localnet-overrides.yaml'), true);
assert.match(localnetOverride, /max-size: "25m"/);
assert.match(localnetOverride, /max-file: "3"/);
assert.match(localnetOverride, /LOG_LEVEL_STDOUT: "\$\{LOG_LEVEL:-INFO\}"/);

runDockerCompose(config, ['config', '--quiet'], { stdio: 'pipe' });

console.log('Smoke test OK');
