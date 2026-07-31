// Loads and checks canton-barebones.config.json — the single file a developer
// edits to shape the stack. It uses zod (a schema library) to reject bad configs
// with a clear message instead of failing deep inside Docker later, and then
// resolves the extra runtime paths the rest of the tool needs. What the config
// turns on and off, described inline with each schema: the two validators
// (backend and, optionally, their UIs), the SV's web UIs, and the network tools.
// The SV backend is not configurable — it is required infrastructure and always
// runs — but each of its web UIs can be switched off individually.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import { resolveFromProject } from './paths.js';
import { ensureSpliceCheckout } from './splice.js';

// Bumped when the config shape changes in a breaking way; an old file is then
// rejected with an upgrade hint instead of a confusing field error.
const CONFIG_VERSION = 1;
const configPath = resolveFromProject('canton-barebones.config.json');

// Matches a GitHub "owner/repo" slug (e.g. "canton-network/splice").
const GITHUB_REPO = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;

// Reads and parses a JSON file, so every command loads config the same way.
function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// Fails fast when this wrapper points at a missing file.
function assertFileExists(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} does not exist: ${filePath}`);
  }
}

const spliceSchema = z
  .object({
    repo: z.string().regex(GITHUB_REPO, 'splice.repo must use the "owner/repo" format'),
    tag: z.string().min(1, 'splice.tag must be a non-empty string'),
  })
  .strict();

const persistenceSchema = z
  .object({
    // Controls whether Docker volumes survive a reset or are wiped for clean state.
    mode: z.enum(['persistent', 'ephemeral']),
  })
  .strict();

// A validator (Splice LocalNet ships two fixed slots: app-provider and app-user).
// `enabled` runs the backend (the participant node + validator app, multiplexed
// into the shared canton/splice processes via env, not separate containers).
// `ui` also exposes that validator's web UIs (wallet + ANS) through nginx. They
// come as one bundle: nginx routes to both, so it is all-or-nothing per validator,
// not per-UI. `ui: false` runs the validator headless (backend only, reached on
// its direct API ports).
const validatorSchema = z
  .object({
    enabled: z.boolean(),
    ui: z.boolean(),
  })
  .strict()
  .superRefine((validator, ctx) => {
    // The UIs need their backend to point at, so `ui` cannot be on while the
    // validator itself is disabled.
    if (validator.ui && !validator.enabled) {
      ctx.addIssue({
        code: 'custom',
        path: ['ui'],
        message: 'ui requires enabled: true',
      });
    }
  });

// Splice LocalNet only exposes two participant validators; both are always present
// in the config and toggled via `enabled`, so this is a fixed-key object rather
// than an open array. (The SV is not here: it is required infrastructure — it
// founds the global synchronizer validators connect to — so its backend always
// runs; only its web UIs are configurable, via the separate `sv` section.)
const validatorsSchema = z
  .object({
    appProvider: validatorSchema,
    appUser: validatorSchema,
  })
  .strict();

// The SV's web UIs. Unlike a validator's all-or-nothing `ui` bundle, these can be
// toggled per UI: each flag only controls whether that UI container runs, while
// the APIs behind the same nginx port (scan API, SV admin API, canton JSON API)
// proxy to the always-running splice/canton containers and stay reachable either
// way. A disabled UI's URL answers 502 instead of serving the app.
const svSchema = z
  .object({
    scanUI: z.boolean(),
    svUI: z.boolean(),
    walletUI: z.boolean(),
  })
  .strict();

// Cross-node tooling that operates over the participants (SV + validators): the
// Canton console, the extra local application synchronizer, and the aggregated
// Swagger UI. All are optional and off by default.
const networkToolsSchema = z
  .object({
    console: z.boolean(),
    multiSync: z.boolean(),
    swaggerUI: z.boolean(),
  })
  .strict();

// Top-level config schema. `.strict()` on every object rejects unknown top-level
// fields and unknown keys, so typos and stale keys fail loudly instead of being
// silently ignored.
const configSchema = z
  .object({
    version: z.number(),
    splice: spliceSchema,
    composeProjectName: z.string().min(1, 'composeProjectName must be a non-empty string'),
    dockerNetwork: z.string().min(1, 'dockerNetwork must be a non-empty string'),
    persistence: persistenceSchema,
    validators: validatorsSchema,
    sv: svSchema,
    networkTools: networkToolsSchema,
  })
  .strict();

// Parses and validates raw config against the target schema, with no filesystem
// or Splice-checkout side effects, so it can be unit tested directly.
export function parseConfig(raw) {
  // Check the config version before schema validation so an outdated file yields
  // an actionable upgrade message instead of a generic field error.
  if (raw?.version !== CONFIG_VERSION) {
    throw new Error(
      `Config version ${raw?.version ?? 'missing'} is not compatible with this version of canton-barebones (expected ${CONFIG_VERSION}).\n` +
        'Run "canton-barebones init --force" to get the new defaults, then re-apply your changes.'
    );
  }

  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map(issue => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid canton-barebones.config.json:\n${details}`);
  }

  return result.data;
}

// Loads canton-barebones.config.json from the project directory, validates it,
// and resolves all runtime paths and the pinned Splice checkout. Mapping the
// config onto compose profiles/env/overrides lives in compose.js, next to the
// Docker Compose invocation it drives.
export function loadConfig() {
  assertFileExists(configPath, 'Config file (run "canton-barebones init" first)');

  const parsed = parseConfig(readJson(configPath));

  const resolved = {
    ...parsed,
    imageTag: parsed.splice.tag,
    configPath,
    generatedDir: resolveFromProject('.generated'),
    localnetOverridePath: resolveFromProject('splice-localnet-overrides.yaml'),
  };

  const splicePaths = ensureSpliceCheckout(resolved);
  resolved.spliceCheckoutDir = splicePaths.checkoutDir;
  resolved.localnetDir = splicePaths.localnetDir;
  resolved.localnetEnvDir = path.resolve(resolved.localnetDir, 'env');

  validateLocalnetFiles(resolved);
  return resolved;
}

// Verifies the subset of Splice LocalNet files this initial wrapper depends on.
export function validateLocalnetFiles(config) {
  assertFileExists(config.localnetOverridePath, 'LocalNet override compose file');
  assertFileExists(config.localnetDir, 'LocalNet directory');
  assertFileExists(path.resolve(config.localnetDir, 'compose.yaml'), 'LocalNet compose.yaml');
  assertFileExists(path.resolve(config.localnetDir, 'compose.env'), 'LocalNet compose.env');
  assertFileExists(path.resolve(config.localnetEnvDir, 'common.env'), 'LocalNet common.env');
  assertFileExists(path.resolve(config.localnetEnvDir, 'postgres.env'), 'LocalNet postgres.env');
  assertFileExists(path.resolve(config.localnetEnvDir, 'splice.env'), 'LocalNet splice.env');

  // Resource limits are always applied in this dev stack (see compose.js), so the
  // file must exist.
  assertFileExists(
    path.resolve(config.localnetDir, 'resource-constraints.yaml'),
    'LocalNet resource-constraints.yaml'
  );
}
