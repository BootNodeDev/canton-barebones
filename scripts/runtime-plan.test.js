import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { deriveRuntimePlan, writeLocalnetEnv } from '../src/compose.js';

// A minimal config slice covering only what deriveRuntimePlan and
// writeLocalnetEnv read: the validator flags, the SV UI flags, the network tool
// flags, the identifiers echoed into the env file, and a directory to generate
// into. The baseline mirrors the scaffolded default — app-provider off, app-user
// headless, tools off — and each case below flips one lever. The SV UIs are all
// on here (the scaffolded default ships them off) so the negative cases can
// disable flags one at a time from a fully-on baseline.
function baseConfig(generatedDir) {
  return {
    imageTag: '0.6.11',
    composeProjectName: 'canton-barebones',
    dockerNetwork: 'cantonBarebones',
    localnetDir: '/tmp/localnet',
    localnetEnvDir: '/tmp/localnet/env',
    validators: {
      appProvider: { enabled: false, ui: false },
      appUser: { enabled: true, ui: false },
    },
    sv: { scanUI: true, svUI: true, walletUI: true },
    networkTools: { console: false, multiSync: false, swaggerUI: false },
    generatedDir,
  };
}

// A throwaway directory standing in for the project's .generated/, so the tests
// can inspect the env file the writer produces without touching the repo.
const generatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbn-runtime-plan-'));
after(() => fs.rmSync(generatedDir, { recursive: true, force: true }));

// Parses a generated env file back into a key→value map so assertions can target
// individual variables instead of matching on raw file contents.
function readEnvFile(envPath) {
  const entries = fs
    .readFileSync(envPath, 'utf8')
    .split('\n')
    .filter(line => line.includes('='))
    .map(line => line.split(/=(.*)/s).slice(0, 2));
  return Object.fromEntries(entries);
}

// Scenario: mapping the SV UI flags onto the plan. Each disabled flag must
// surface as its Docker Compose service name — that name is what the static
// runtime override targets (both the replicas pin and the nginx alias), and it
// is echoed in `validate --json` for the user.
describe('deriveRuntimePlan sv UI flags', () => {
  // All flags on (the default) → nothing disabled, and the profile set stays the
  // usual sv-only baseline. Guards against the sv section accidentally growing
  // profile side effects: SV UIs ride the always-on `sv` profile.
  it('reports no disabled SV UIs when every flag is on', () => {
    const plan = deriveRuntimePlan(baseConfig(generatedDir));
    assert.deepEqual(plan.disabledSvUIs, []);
    assert.deepEqual(plan.upProfiles, ['sv']);
  });

  // Turning off scanUI and walletUI while keeping svUI must list exactly the two
  // matching service names — proving the flag→service mapping and that flags are
  // independent (unlike a validator's all-or-nothing ui bundle).
  it('maps each disabled flag to its compose service name', () => {
    const config = baseConfig(generatedDir);
    config.sv = { scanUI: false, svUI: true, walletUI: false };
    const plan = deriveRuntimePlan(config);
    assert.deepEqual(plan.disabledSvUIs, ['scan-web-ui', 'wallet-web-ui-sv']);
  });
});

// Scenario: the SV UI env vars. templates/runtime-overrides.yaml is static and
// consumes one replicas + alias pair per UI, so these vars ARE the runtime
// contract: replicas 0/1 decides whether the container starts, and the alias
// keeps a disabled UI's hostname resolvable (nginx dies at startup on an
// unresolvable upstream — Splice's sv.conf proxies to these hostnames
// unconditionally). An enabled UI gets an inert "-unused" alias because the
// static YAML list entry always exists and only its value can change.
describe('writeLocalnetEnv sv UI vars', () => {
  // All UIs on (the default): every service keeps 1 replica and nginx only
  // holds inert aliases, leaving the real hostnames to the UI containers.
  it('writes 1 replica and an inert alias for enabled UIs', () => {
    const envPath = writeLocalnetEnv(baseConfig(generatedDir));
    const env = readEnvFile(envPath);
    for (const prefix of ['SCAN_WEB_UI', 'SV_WEB_UI', 'WALLET_WEB_UI_SV']) {
      assert.equal(env[`${prefix}_REPLICAS`], '1');
    }
    assert.equal(env.SCAN_WEB_UI_NGINX_ALIAS, 'scan-web-ui-unused');
    assert.equal(env.SV_WEB_UI_NGINX_ALIAS, 'sv-web-ui-unused');
    assert.equal(env.WALLET_WEB_UI_SV_NGINX_ALIAS, 'wallet-web-ui-sv-unused');
  });

  // scanUI off: its service must drop to 0 replicas and nginx must take over the
  // real `scan-web-ui` hostname, while the other two UIs stay untouched.
  it('writes 0 replicas and the real hostname alias for a disabled UI', () => {
    const config = baseConfig(generatedDir);
    config.sv = { scanUI: false, svUI: true, walletUI: true };
    const env = readEnvFile(writeLocalnetEnv(config));
    assert.equal(env.SCAN_WEB_UI_REPLICAS, '0');
    assert.equal(env.SCAN_WEB_UI_NGINX_ALIAS, 'scan-web-ui');
    assert.equal(env.SV_WEB_UI_REPLICAS, '1');
    assert.equal(env.SV_WEB_UI_NGINX_ALIAS, 'sv-web-ui-unused');
    assert.equal(env.WALLET_WEB_UI_SV_REPLICAS, '1');
    assert.equal(env.WALLET_WEB_UI_SV_NGINX_ALIAS, 'wallet-web-ui-sv-unused');
  });
});
