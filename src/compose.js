// Turns the validated config into an actual Docker Compose run.
//
// Docker Compose "profiles" are labels on services; a service only starts if one
// of its profiles is selected with --profile. Splice's LocalNet wires nginx to
// route to each participant's web UIs as fixed upstreams, and nginx refuses to
// start if any of those UI containers is missing. So the levers are:
//   - The SV is required infra and always runs fully (--profile sv). That also
//     starts the shared services every profile needs: postgres, canton, splice,
//     and nginx.
//   - Each validator's backend switches on/off via an env var (*_PROFILE).
//   - A validator with its backend on but UIs off would still make nginx try to
//     route to its (absent) UIs and fail. To run it headless we blank out its
//     nginx route with a generated override (see writeGeneratedOverride).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Every profile this wrapper can select. Used by teardown (stop/reset) to make
// sure containers from any profile are removed, not just the ones currently up.
export const allLocalnetProfiles = ['app-provider', 'app-user', 'sv', 'swagger-ui', 'console', 'multi-sync'];

// Compose profile that starts each validator's UI bundle.
const PARTICIPANT_PROFILE = { appProvider: 'app-provider', appUser: 'app-user' };

// nginx template file (inside the container) that holds each validator's routes.
// Blanking it out with an empty file makes nginx skip that validator, so it can
// run headless without nginx failing on the missing UI upstreams.
const NGINX_ROUTE_TEMPLATE = {
  appProvider: '/etc/nginx/templates/app-provider.conf.template',
  appUser: '/etc/nginx/templates/app-user.conf.template',
};

// Compose profile for each network tool.
const TOOL_PROFILE = { console: 'console', multiSync: 'multi-sync', swaggerUI: 'swagger-ui' };

// Formats one Docker env-file line and strips newlines to keep generated files valid.
function envLine(key, value) {
  return `${key}=${String(value).replaceAll(/[\r\n]/g, '')}`;
}

// Converts configured LocalNet profiles into docker compose --profile flags.
function profileFlags(profiles) {
  return profiles.flatMap(profile => ['--profile', profile]);
}

// Translates the validated config into the concrete Docker Compose levers:
// - nodeEnv: `*_PROFILE` env vars that switch each validator's backend on/off
//   (the shared canton/splice processes include a validator's conf only when its
//   env is "on"; SV is always "on").
// - upProfiles: `--profile` flags to start — always `sv` (which also brings up the
//   shared postgres/canton/splice/nginx), plus a validator's profile when its UIs
//   are wanted, plus a profile per enabled network tool.
// - headlessValidators: validators whose backend is on but UIs are off; nginx must
//   be told to skip their routes (see writeGeneratedOverride).
export function deriveRuntimePlan(config) {
  const { appProvider, appUser } = config.validators;

  const nodeEnv = {
    SV_PROFILE: 'on',
    APP_PROVIDER_PROFILE: appProvider.enabled ? 'on' : 'off',
    APP_USER_PROFILE: appUser.enabled ? 'on' : 'off',
  };

  // SV always runs fully; that also starts the shared services (postgres, canton,
  // splice, nginx) that every other profile depends on.
  const upProfiles = ['sv'];
  const headlessValidators = [];

  for (const key of ['appProvider', 'appUser']) {
    const validator = config.validators[key];
    if (!validator.enabled) {
      continue;
    }
    if (validator.ui) {
      upProfiles.push(PARTICIPANT_PROFILE[key]);
    } else {
      headlessValidators.push(key);
    }
  }

  for (const [tool, on] of Object.entries(config.networkTools)) {
    if (on) {
      upProfiles.push(TOOL_PROFILE[tool]);
    }
  }

  return { nodeEnv, upProfiles, headlessValidators };
}

// Writes runtime env files used to bridge this repo's config into Splice LocalNet.
export function writeLocalnetEnv(config) {
  fs.mkdirSync(config.generatedDir, { recursive: true });
  const runtimeEnvPath = path.resolve(config.generatedDir, 'localnet.env');
  const emptyEnvPath = path.resolve(config.generatedDir, 'empty.env');
  fs.writeFileSync(emptyEnvPath, '');

  const { nodeEnv } = deriveRuntimePlan(config);
  const contents = [
    envLine('IMAGE_TAG', config.imageTag),
    envLine('COMPOSE_PROJECT_NAME', config.composeProjectName),
    envLine('DOCKER_NETWORK', config.dockerNetwork),
    envLine('LOCALNET_DIR', config.localnetDir),
    envLine('LOCALNET_ENV_DIR', config.localnetEnvDir),
    envLine('ALPHA_PROTOCOL_VERSION_ENV', emptyEnvPath),
    envLine('SV_PROFILE', nodeEnv.SV_PROFILE),
    envLine('APP_PROVIDER_PROFILE', nodeEnv.APP_PROVIDER_PROFILE),
    envLine('APP_USER_PROFILE', nodeEnv.APP_USER_PROFILE),
    '',
  ].join('\n');

  fs.writeFileSync(runtimeEnvPath, contents);
  return runtimeEnvPath;
}

// Writes a generated compose override that runs headless validators (backend on,
// UIs off) by replacing their nginx route template with an empty file. Without
// this, nginx would try to route to those validators' absent UI containers and
// fail to start. Docker Compose merges volume mounts by target path with the last
// file winning, so mounting our empty file over Splice's template neutralizes it.
// Returns the path when an override is needed, or null otherwise (so no file is
// passed to -f when nothing is headless).
export function writeGeneratedOverride(config, headlessValidators) {
  const overridePath = path.resolve(config.generatedDir, 'service-overrides.yaml');
  if (headlessValidators.length === 0) {
    fs.rmSync(overridePath, { force: true });
    return null;
  }
  fs.mkdirSync(config.generatedDir, { recursive: true });
  const emptyTemplatePath = path.resolve(config.generatedDir, 'empty-nginx-template');
  fs.writeFileSync(emptyTemplatePath, '');
  const mounts = headlessValidators
    .map(key => `      - ${emptyTemplatePath}:${NGINX_ROUTE_TEMPLATE[key]}\n`)
    .join('');
  const contents = `# Generated from canton-barebones.config.json — do not edit.\n# These validators run their backend but not their UIs. nginx would otherwise try\n# to route to the missing UI containers and fail to start, so their nginx route\n# templates are replaced with an empty file.\nservices:\n  nginx:\n    volumes:\n${mounts}`;
  fs.writeFileSync(overridePath, contents);
  return overridePath;
}

// Builds the docker compose arguments that select Splice LocalNet files and profiles.
export function dockerComposeArgs(config, options = {}) {
  const runtimeEnvPath = writeLocalnetEnv(config);
  const plan = deriveRuntimePlan(config);
  const generatedOverridePath = writeGeneratedOverride(config, plan.headlessValidators);
  const profiles = options.profiles ?? plan.upProfiles;
  const args = [
    'compose',
    '--env-file',
    runtimeEnvPath,
    '--env-file',
    path.resolve(config.localnetDir, 'compose.env'),
    '--env-file',
    path.resolve(config.localnetEnvDir, 'common.env'),
    '-f',
    path.resolve(config.localnetDir, 'compose.yaml'),
  ];

  if (config.resourceConstraints) {
    args.push('-f', path.resolve(config.localnetDir, 'resource-constraints.yaml'));
  }

  args.push('-f', config.localnetOverridePath);

  // The generated override must come last so its empty nginx templates win the merge.
  if (generatedOverridePath) {
    args.push('-f', generatedOverridePath);
  }

  args.push(...profileFlags(profiles));
  return args;
}

// Runs Docker Compose with inherited stdio by default so users see startup progress.
export function runDockerCompose(config, commandArgs, options = {}) {
  const args = [...dockerComposeArgs(config, options), ...commandArgs];
  if (options.printCommand) {
    console.log(['docker', ...args].join(' '));
  }

  const result = spawnSync('docker', args, {
    cwd: config.localnetDir,
    env: {
      ...process.env,
      IMAGE_TAG: config.imageTag,
      COMPOSE_PROJECT_NAME: config.composeProjectName,
      DOCKER_NETWORK: config.dockerNetwork,
      LOCALNET_DIR: config.localnetDir,
      LOCALNET_ENV_DIR: config.localnetEnvDir,
    },
    stdio: options.stdio ?? 'inherit',
    encoding: 'utf8',
  });

  if (result.error) {
    // Surface a missing Docker binary as an actionable dependency error, mirroring
    // how runGit reports a missing git; other spawn errors keep their raw detail.
    if (result.error.code === 'ENOENT') {
      throw new Error(`docker is required to run the stack: ${result.error.message}`);
    }
    throw result.error;
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const detail = stderr ? `\n${stderr}` : '';
    throw new Error(`docker compose exited with status ${result.status}${detail}`);
  }

  return result;
}
