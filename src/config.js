import fs from 'node:fs';
import path from 'node:path';

import { resolveFromProject } from './paths.js';
import { ensureSpliceCheckout } from './splice.js';

const CONFIG_VERSION = 1;
const configPath = resolveFromProject('canton-barebones.config.json');

// Reads JSON config files from disk so CLI commands all use the same parser.
function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// Validates string config values that are required to build compose arguments.
function assertString(value, key) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${key} must be a non-empty string`);
  }
}

// Validates boolean config flags so optional compose files are enabled explicitly.
function assertBoolean(value, key) {
  if (typeof value !== 'boolean') {
    throw new Error(`${key} must be a boolean`);
  }
}

// Validates the owner/repository GitHub slug used to fetch Splice.
function assertGithubRepo(value, key) {
  assertString(value, key);
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(value)) {
    throw new Error(`${key} must use the "owner/repo" format`);
  }
}

// Fails fast when this wrapper points at a missing LocalNet file.
function assertFileExists(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} does not exist: ${filePath}`);
  }
}

// Loads config/canton-barebones.config.json from the project directory and resolves all paths.
export function loadConfig() {
  assertFileExists(configPath, 'Config file (run "canton-barebones init" first)');

  const raw = readJson(configPath);

  if (raw.version !== CONFIG_VERSION) {
    throw new Error(
      `Config version ${raw.version ?? 'missing'} is not compatible with this version of canton-barebones (expected ${CONFIG_VERSION}).\n` +
      'Run "canton-barebones init --force" to get the new defaults, then re-apply your changes.'
    );
  }

  assertGithubRepo(raw.splice?.repo, 'splice.repo');
  assertString(raw.splice?.tag, 'splice.tag');
  assertString(raw.composeProjectName, 'composeProjectName');
  assertString(raw.dockerNetwork, 'dockerNetwork');
  assertBoolean(raw.resourceConstraints, 'resourceConstraints');

  if (!Array.isArray(raw.profiles) || raw.profiles.length === 0) {
    throw new Error('profiles must be a non-empty array');
  }

  for (const profile of raw.profiles) {
    assertString(profile, 'profiles[]');
  }

  const persistenceMode = raw.persistence?.mode;
  if (persistenceMode !== 'persistent' && persistenceMode !== 'ephemeral') {
    throw new Error('persistence.mode must be either "persistent" or "ephemeral"');
  }

  const resolved = {
    ...raw,
    imageTag: raw.imageTag ?? raw.splice.tag,
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

  if (config.resourceConstraints) {
    assertFileExists(
      path.resolve(config.localnetDir, 'resource-constraints.yaml'),
      'LocalNet resource-constraints.yaml'
    );
  }
}
