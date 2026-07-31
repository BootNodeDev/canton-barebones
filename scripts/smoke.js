import assert from 'node:assert/strict';
import fs from 'node:fs';

import { loadConfig } from '../src/config.js';
import { deriveRuntimePlan, runDockerCompose, writeLocalnetEnv } from '../src/compose.js';

const config = loadConfig();
const runtimeEnvPath = writeLocalnetEnv(config);
const localnetOverride = fs.readFileSync(config.localnetOverridePath, 'utf8');

// This smoke test proves the default config resolves the pinned Splice checkout,
// writes generated runtime files, and produces a valid Docker Compose model.
// It requires Docker and a Splice checkout, so it runs under "test:e2e", not the
// unit test suite.
assert.equal(config.imageTag.length > 0, true);
assert.equal(config.splice.repo, 'canton-network/splice');
assert.equal(config.splice.tag, '0.6.11');
assert.equal(config.persistence.mode, 'persistent');
assert.deepEqual(config.validators, {
  appProvider: { enabled: false, ui: false },
  appUser: { enabled: true, ui: false },
});
// The scaffolded default ships every SV web UI off, matching the barebones
// philosophy of the rest of the defaults (turn on what you need).
assert.deepEqual(config.sv, { scanUI: false, svUI: false, walletUI: false });
assert.deepEqual(config.networkTools, { console: false, multiSync: false, swaggerUI: false });

// With the scaffolded default (app-provider off, app-user enabled headless, tools
// off), only the SV profile is started: a headless validator adds no `--profile`
// (its backend is switched via env), so `upProfiles` stays `['sv']`. That profile
// also brings up the shared postgres/canton/splice/nginx. app-user being headless
// means it lands in `headlessValidators`, which triggers the generated nginx override.
const plan = deriveRuntimePlan(config);
assert.deepEqual(plan.upProfiles, ['sv']);
assert.deepEqual(plan.headlessValidators, ['appUser']);
// All SV web UIs are off by default, so all three are pinned to 0 replicas.
assert.deepEqual(plan.disabledSvUIs, ['scan-web-ui', 'sv-web-ui', 'wallet-web-ui-sv']);
assert.equal(runtimeEnvPath.endsWith('.generated/localnet.env'), true);
assert.equal(config.localnetOverridePath.endsWith('splice-localnet-overrides.yaml'), true);
assert.match(localnetOverride, /max-size: "25m"/);
assert.match(localnetOverride, /max-file: "3"/);
assert.match(localnetOverride, /LOG_LEVEL_STDOUT: "\$\{LOG_LEVEL:-INFO\}"/);

runDockerCompose(config, ['config', '--quiet'], { stdio: 'pipe' });

console.log('Smoke test OK');
