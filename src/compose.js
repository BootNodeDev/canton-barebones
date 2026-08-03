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
//     route to its (absent) UIs and fail. To run it headless its nginx route
//     template is blanked out with an empty file.
//   - The SV's web UIs ride the always-on `sv` profile, so turning one off is not
//     a profile decision either: the disabled UI is pinned to 0 replicas while
//     nginx keeps its hostname resolvable.
// Both UI levers live in a static override shipped with this package
// (templates/runtime-overrides.yaml, see its header for the mechanics), driven
// purely by env vars written here (see writeLocalnetEnv).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { resolveFromPackage } from './paths.js';

// Every profile this wrapper can select. Used by `reset` to make sure containers
// from any profile are removed, not just the ones currently up. (`stop` does not
// need profiles: it tears down by project name, see stopStackByProjectName.)
export const allLocalnetProfiles = ['app-provider', 'app-user', 'sv', 'swagger-ui', 'console', 'multi-sync'];

// Compose profile that starts each validator's UI bundle.
const PARTICIPANT_PROFILE = { appProvider: 'app-provider', appUser: 'app-user' };

// Compose profile for each network tool.
const TOOL_PROFILE = { console: 'console', multiSync: 'multi-sync', swaggerUI: 'swagger-ui' };

// The SV web UI service behind each `sv.*` config flag. These live in the
// always-selected `sv` profile, so a disabled one must be kept from starting via
// the static runtime override rather than by dropping a profile.
const SV_UI_SERVICE = { scanUI: 'scan-web-ui', svUI: 'sv-web-ui', walletUI: 'wallet-web-ui-sv' };

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
// - headlessValidators: validators whose backend is on but UIs are off; nginx is
//   told to skip their routes via env vars (see writeLocalnetEnv).
// - disabledSvUIs: SV web UI services turned off in the config; the static
//   runtime override pins them to 0 replicas via env vars (see writeLocalnetEnv).
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

  const disabledSvUIs = Object.entries(config.sv)
    .filter(([, on]) => !on)
    .map(([flag]) => SV_UI_SERVICE[flag]);

  return { nodeEnv, upProfiles, headlessValidators, disabledSvUIs };
}

// Writes runtime env files used to bridge this repo's config into Splice LocalNet.
export function writeLocalnetEnv(config) {
  fs.mkdirSync(config.generatedDir, { recursive: true });
  const runtimeEnvPath = path.resolve(config.generatedDir, 'localnet.env');
  const emptyEnvPath = path.resolve(config.generatedDir, 'empty.env');
  fs.writeFileSync(emptyEnvPath, '');

  const { nodeEnv } = deriveRuntimePlan(config);

  // Mounted as a validator's nginx route template whenever its UI is off
  // (headless or disabled): empty routes mean nginx has nothing to resolve, so
  // it boots without that validator's UI containers.
  const emptyRoutesPath = path.resolve(config.generatedDir, 'empty-nginx-routes.conf');
  fs.writeFileSync(emptyRoutesPath, '');

  // The file the static runtime override mounts as a validator's nginx route
  // template: Splice's real routing config when the UI is on (same file Splice
  // itself mounts, so routes stay identical), the empty file otherwise.
  const routesSource = (key, confName) =>
    config.validators[key].ui
      ? path.resolve(config.localnetDir, 'conf', 'nginx', confName)
      : emptyRoutesPath;

  const validatorRoutesEnv = [
    envLine('APP_PROVIDER_NGINX_ROUTES', routesSource('appProvider', 'app-provider.conf')),
    envLine('APP_USER_NGINX_ROUTES', routesSource('appUser', 'app-user.conf')),
  ];

  // One replicas + alias pair per SV web UI, consumed by the static
  // templates/runtime-overrides.yaml (see its header for how the two work). The
  // env prefix is the service name upper-snake-cased, e.g. SCAN_WEB_UI.
  const svUiEnv = Object.entries(SV_UI_SERVICE).flatMap(([flag, service]) => {
    const on = config.sv[flag];
    const prefix = service.replaceAll('-', '_').toUpperCase();
    return [
      envLine(`${prefix}_REPLICAS`, on ? 1 : 0),
      envLine(`${prefix}_NGINX_ALIAS`, on ? `${service}-unused` : service),
    ];
  });

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
    ...validatorRoutesEnv,
    ...svUiEnv,
    '',
  ].join('\n');

  fs.writeFileSync(runtimeEnvPath, contents);
  return runtimeEnvPath;
}

// Builds the docker compose arguments that select Splice LocalNet files and profiles.
export function dockerComposeArgs(config, options = {}) {
  const runtimeEnvPath = writeLocalnetEnv(config);
  const plan = deriveRuntimePlan(config);
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

  // Always apply Splice's CPU/memory limits: this is a local dev stack, so the
  // constraints keep it from starving the host and match how Splice runs LocalNet.
  args.push('-f', path.resolve(config.localnetDir, 'resource-constraints.yaml'));

  // The package's static runtime override translates the UI env vars into empty
  // nginx route templates, replica pins, and nginx aliases. It ships with the
  // package (not scaffolded) and sits after Splice's files — so its mounts win
  // their merge — but before the user's override, so user tweaks can still win.
  args.push('-f', resolveFromPackage('templates/runtime-overrides.yaml'));

  args.push('-f', config.localnetOverridePath);

  args.push(...profileFlags(profiles));
  return args;
}

// Runs Docker Compose with inherited stdio by default so users see startup progress.
export function runDockerCompose(config, commandArgs, options = {}) {
  const args = [...dockerComposeArgs(config, options), ...commandArgs];
  return runDocker(args, {
    cwd: config.localnetDir,
    env: {
      ...process.env,
      IMAGE_TAG: config.imageTag,
      COMPOSE_PROJECT_NAME: config.composeProjectName,
      DOCKER_NETWORK: config.dockerNetwork,
      LOCALNET_DIR: config.localnetDir,
      LOCALNET_ENV_DIR: config.localnetEnvDir,
    },
    ...options,
  });
}

// Stops the stack knowing only its Compose project name. Compose matches the
// containers by their project label, so no compose files, env files, or profiles
// are needed, which lets `stop` work even when the rest of the config (or the
// Splice checkout) is broken. Volumes are kept, same as the file-based `down`.
export function stopStackByProjectName(projectName) {
  return runDocker(['compose', '--project-name', projectName, 'down', '--remove-orphans'], {});
}

// Shared `docker` spawn wrapper: inherits stdio by default so users see compose
// progress, turns a missing binary into an actionable dependency error, and
// surfaces compose's stderr on a non-zero exit.
function runDocker(args, options = {}) {
  if (options.printCommand) {
    console.log(['docker', ...args].join(' '));
  }

  const result = spawnSync('docker', args, {
    cwd: options.cwd,
    env: options.env,
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
