import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseConfig } from '../src/config.js';

// Deep-clones a config object so each case can mutate a copy without affecting
// the shared valid baseline.
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// Asserts that parseConfig rejects `raw` and that the thrown message contains
// `expectedFragment`, documenting which rule the case exercises.
function assertRejects(raw, expectedFragment) {
  assert.throws(
    () => parseConfig(raw),
    error => {
      assert.match(error.message, expectedFragment, `unexpected message: ${error.message}`);
      return true;
    },
    'expected parseConfig to throw'
  );
}

// The scaffolded default shipped by `init`: version 1, a pinned Splice source,
// persistent volumes, app-provider off, app-user enabled headless (backend on,
// UIs off), and all network tools off. The SV is not in the config — it is
// required infrastructure that always runs fully. This is the baseline; every
// negative case below clones it and breaks a single rule, so a failure points to
// one validation concern.
const validConfig = {
  version: 1,
  splice: { repo: 'canton-network/splice', tag: '0.6.11' },
  composeProjectName: 'canton-barebones',
  dockerNetwork: 'cantonBarebones',
  resourceConstraints: true,
  persistence: { mode: 'persistent' },
  validators: {
    appProvider: { enabled: false, ui: false },
    appUser: { enabled: true, ui: false },
  },
  networkTools: { console: false, multiSync: false, swaggerUI: false },
};

// A richer config: app-user enabled with its UIs on, and every network tool on.
// Exercises the enabled+ui combination and the tool flags together.
const enabledValidator = clone(validConfig);
enabledValidator.validators.appUser = { enabled: true, ui: true };
enabledValidator.networkTools = { console: true, multiSync: true, swaggerUI: true };

// Scenario: the happy path. The schema must accept the config that `init` ships
// and well-formed extensions of it, and parsing must be lossless.
describe('valid configs', () => {
  // The scaffolded default must parse and round-trip unchanged.
  it('accepts the scaffolded default', () => {
    assert.deepEqual(parseConfig(clone(validConfig)), validConfig);
  });

  // A validator enabled with UIs on, plus every network tool on, must parse.
  it('accepts an enabled validator with UIs and all tools on', () => {
    assert.deepEqual(parseConfig(clone(enabledValidator)), enabledValidator);
  });

  // A validator enabled but headless (backend on, UIs off) is a normal case.
  it('accepts an enabled headless validator', () => {
    const raw = clone(validConfig);
    raw.validators.appProvider = { enabled: true, ui: false };
    assert.doesNotThrow(() => parseConfig(raw));
  });
});

// Scenario: config version gating. An outdated or missing version must produce
// the actionable upgrade message instead of a generic schema error.
describe('version gating', () => {
  // An older version must point the user at "init --force".
  it('rejects a mismatched version with an upgrade hint', () => {
    const raw = clone(validConfig);
    raw.version = 0;
    assertRejects(raw, /not compatible|init --force/);
  });

  // A missing version is treated as a mismatch: the file predates version tracking.
  it('rejects a missing version', () => {
    const raw = clone(validConfig);
    delete raw.version;
    assertRejects(raw, /missing|not compatible/);
  });
});

// Scenario: strictness. Unknown fields must fail loudly instead of being ignored,
// so typos and stale keys surface immediately.
describe('unknown fields', () => {
  // A stale top-level key (e.g. the removed `sv`) must be rejected.
  it('rejects an unknown top-level field', () => {
    const raw = clone(validConfig);
    raw.sv = { modules: {} };
    assertRejects(raw, /sv/);
  });

  // Strictness must extend into nested objects: the removed per-validator
  // `modules` key must now fail.
  it('rejects a removed per-validator key', () => {
    const raw = clone(validConfig);
    raw.validators.appUser.modules = { walletUI: true };
    assertRejects(raw, /modules/);
  });
});

// Scenario: required sections and typed fields. Missing sections and
// wrong-typed values must fail.
describe('required and typed fields', () => {
  // `networkTools` is a required section.
  it('rejects a missing networkTools section', () => {
    const raw = clone(validConfig);
    delete raw.networkTools;
    assertRejects(raw, /networkTools/);
  });

  // Both fixed validator slots must be present.
  it('rejects a missing validator slot', () => {
    const raw = clone(validConfig);
    delete raw.validators.appProvider;
    assertRejects(raw, /appProvider/);
  });

  // Flags must be explicit booleans; a string "true" is a common mistake.
  it('rejects a non-boolean tool flag', () => {
    const raw = clone(validConfig);
    raw.networkTools.console = 'true';
    assertRejects(raw, /console/);
  });

  // The `enabled` flag must be a boolean.
  it('rejects a non-boolean validator flag', () => {
    const raw = clone(validConfig);
    raw.validators.appUser.enabled = 'yes';
    assertRejects(raw, /enabled/);
  });

  // Only the two supported volume lifecycles are allowed.
  it('rejects an invalid persistence mode', () => {
    const raw = clone(validConfig);
    raw.persistence.mode = 'keep';
    assertRejects(raw, /persistence\.mode|mode/);
  });

  // The Splice source must be an explicit "owner/repo" slug so the checkout URL
  // can be built deterministically.
  it('rejects a malformed splice repo', () => {
    const raw = clone(validConfig);
    raw.splice.repo = 'not-a-slug';
    assertRejects(raw, /splice\.repo/);
  });
});

// Scenario: validator enabled/ui consistency. A validator's UIs are reached
// through its backend, so `ui` cannot be on while the validator is disabled.
describe('validator enabled/ui consistency', () => {
  // ui:true with enabled:false is contradictory and must be rejected, naming the
  // enabled requirement.
  it('rejects ui enabled on a disabled validator', () => {
    const raw = clone(validConfig);
    raw.validators.appProvider = { enabled: false, ui: true };
    assertRejects(raw, /ui requires enabled|requires enabled/);
  });

  // The same validator with enabled:true and ui:true is valid — proving the rule
  // keys off `enabled`, not the `ui` flag alone.
  it('accepts the same ui once the validator is enabled', () => {
    const raw = clone(validConfig);
    raw.validators.appProvider = { enabled: true, ui: true };
    assert.doesNotThrow(() => parseConfig(raw));
  });
});
