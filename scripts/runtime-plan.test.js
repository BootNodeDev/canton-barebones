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
    imageTag: 'test-image-tag', // placeholder: no case here asserts IMAGE_TAG
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
    // Off, like the scaffolded default. The version is a placeholder: the cases
    // below assert that whatever is configured reaches the env file verbatim,
    // not that any particular release is pinned.
    walletGateway: { enabled: false, version: '1.2.3', port: 3030 },
    generatedDir,
  };
}

// A throwaway directory standing in for the project's .generated/, so the tests
// can inspect the env file the writer produces without touching the repo.
const generatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'canton-barebones-runtime-plan-'));
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

// Scenario: the validator route-source env vars. templates/runtime-overrides.yaml
// statically mounts `${*_NGINX_ROUTES}` over each validator's nginx route
// template, so the var's value decides what nginx renders: Splice's real routing
// config when the UI is on, or an empty file — no routes, so nginx never tries
// to resolve UI containers that are not running (headless or disabled validators).
describe('writeLocalnetEnv validator route sources', () => {
  // The scaffolded default: app-user enabled without UI (headless) and
  // app-provider fully disabled. Both must get the empty routes file, because in
  // both cases the validator's UI containers do not run.
  it('points ui-less validators at the empty routes file', () => {
    const env = readEnvFile(writeLocalnetEnv(baseConfig(generatedDir)));
    assert.equal(env.APP_USER_NGINX_ROUTES.endsWith('empty-nginx-routes.conf'), true);
    assert.equal(env.APP_PROVIDER_NGINX_ROUTES, env.APP_USER_NGINX_ROUTES);
    // The mount source must exist and be empty, or docker would create a
    // directory in its place / nginx would render stale routes.
    assert.equal(fs.existsSync(env.APP_USER_NGINX_ROUTES), true);
    assert.equal(fs.readFileSync(env.APP_USER_NGINX_ROUTES, 'utf8'), '');
  });

  // A validator with its UI on must mount Splice's real routing config — the
  // exact file Splice's own compose mounts — so its routes stay identical.
  it("points a ui-enabled validator at Splice's real routing config", () => {
    const config = baseConfig(generatedDir);
    config.validators.appUser = { enabled: true, ui: true };
    const env = readEnvFile(writeLocalnetEnv(config));
    // baseConfig pins localnetDir to /tmp/localnet, so the resolved source is
    // that checkout's nginx config for app-user.
    assert.equal(env.APP_USER_NGINX_ROUTES, '/tmp/localnet/conf/nginx/app-user.conf');
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

// Scenario: the Wallet Gateway env vars. templates/wallet-gateway.yaml is static
// and defines a service Splice does not ship, so these vars ARE its runtime
// contract: the replicas pin decides whether the container starts, the version
// is what the container installs from npm at startup, and the config path is the
// file it is handed with `-c`. The gateway is switched with replicas rather than
// a Compose profile so it stays in the model even when off, which is what lets a
// stack started with the gateway on still be torn down after switching it off.
describe('writeLocalnetEnv wallet gateway vars', () => {
  // The scaffolded default leaves the gateway off: the service must be pinned to
  // 0 replicas, and yet still be fully described — a 0-replica service is part
  // of the Compose model, so an unset version or config path would break
  // interpolation for every command, not just `start`.
  it('pins the service to 0 replicas but still describes it when disabled', () => {
    const env = readEnvFile(writeLocalnetEnv(baseConfig(generatedDir)));
    assert.equal(env.WALLET_GATEWAY_REPLICAS, '0');
    assert.equal(env.WALLET_GATEWAY_VERSION, '1.2.3');
    assert.equal(env.WALLET_GATEWAY_PORT, '3030');
  });

  // Enabling it flips only the replicas pin, and the configured host port and npm
  // version must reach the env file verbatim: the template does no defaulting of
  // its own, so a value dropped here would silently start the wrong release or
  // publish the wrong port.
  it('carries the configured version and host port through when enabled', () => {
    const config = baseConfig(generatedDir);
    config.walletGateway = { enabled: true, version: '1.11.2', port: 4040 };
    const env = readEnvFile(writeLocalnetEnv(config));
    assert.equal(env.WALLET_GATEWAY_REPLICAS, '1');
    assert.equal(env.WALLET_GATEWAY_VERSION, '1.11.2');
    assert.equal(env.WALLET_GATEWAY_PORT, '4040');
  });

  // The gateway refuses to start without its config file, and the template mounts
  // it unconditionally, so the file has to be on disk even when the gateway is
  // off: Docker would otherwise create a directory at the mount source. Its
  // ledger URL is the assertion that matters — it must address the app-user
  // participant by its Compose hostname, not by localhost, because the gateway
  // dials it from inside the network.
  it('writes a config file addressing the app-user participant inside the network', () => {
    const env = readEnvFile(writeLocalnetEnv(baseConfig(generatedDir)));
    assert.equal(fs.existsSync(env.WALLET_GATEWAY_CONFIG), true);

    const gatewayConfig = JSON.parse(fs.readFileSync(env.WALLET_GATEWAY_CONFIG, 'utf8'));
    const [network] = gatewayConfig.bootstrap.networks;
    assert.equal(network.ledgerApi.baseUrl, 'http://canton:2975');
    // Self-signed tokens signed with LocalNet's unsafe secret, for the audience
    // and ledger user Splice configures the app-user participant with. A drift in
    // any of the three means the participant rejects every call the gateway makes.
    assert.equal(network.auth.method, 'self_signed');
    assert.equal(network.auth.audience, 'https://canton.network.global');
    assert.equal(network.auth.clientId, 'ledger-api-user');
    assert.equal(network.auth.clientSecret, 'unsafe');
  });

  // The container listens on a fixed port and the configured host port is mapped
  // onto it, so the generated config must always name the container port. Getting
  // these two confused would publish a port nothing listens on.
  it('keeps the in-container port independent of the configured host port', () => {
    const config = baseConfig(generatedDir);
    config.walletGateway = { enabled: true, version: '1.11.2', port: 4040 };
    const env = readEnvFile(writeLocalnetEnv(config));

    const gatewayConfig = JSON.parse(fs.readFileSync(env.WALLET_GATEWAY_CONFIG, 'utf8'));
    assert.equal(gatewayConfig.server.port, Number(env.WALLET_GATEWAY_CONTAINER_PORT));
    assert.notEqual(env.WALLET_GATEWAY_CONTAINER_PORT, env.WALLET_GATEWAY_PORT);
  });
});
