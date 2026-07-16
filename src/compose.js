import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const allLocalnetProfiles = ['app-provider', 'app-user', 'sv', 'swagger-ui', 'console', 'multi-sync'];

// Formats one Docker env-file line and strips newlines to keep generated files valid.
function envLine(key, value) {
  return `${key}=${String(value).replaceAll(/[\r\n]/g, '')}`;
}

// Converts configured LocalNet profiles into docker compose --profile flags.
function profileFlags(profiles) {
  return profiles.flatMap(profile => ['--profile', profile]);
}

// Writes runtime env files used to bridge this repo's config into Splice LocalNet.
export function writeRuntimeEnv(config) {
  fs.mkdirSync(config.generatedDir, { recursive: true });
  const runtimeEnvPath = path.resolve(config.generatedDir, 'localnet.env');
  const emptyEnvPath = path.resolve(config.generatedDir, 'empty.env');
  fs.writeFileSync(emptyEnvPath, '');

  const contents = [
    envLine('IMAGE_TAG', config.imageTag),
    envLine('COMPOSE_PROJECT_NAME', config.composeProjectName),
    envLine('DOCKER_NETWORK', config.dockerNetwork),
    envLine('LOCALNET_DIR', config.localnetDir),
    envLine('LOCALNET_ENV_DIR', config.localnetEnvDir),
    envLine('ALPHA_PROTOCOL_VERSION_ENV', emptyEnvPath),
    envLine('SV_PROFILE', config.profiles.includes('sv') ? 'on' : 'off'),
    envLine('APP_PROVIDER_PROFILE', config.profiles.includes('app-provider') ? 'on' : 'off'),
    envLine('APP_USER_PROFILE', config.profiles.includes('app-user') ? 'on' : 'off'),
    '',
  ].join('\n');

  fs.writeFileSync(runtimeEnvPath, contents);
  return runtimeEnvPath;
}

// Builds the docker compose arguments that select Splice LocalNet files and profiles.
export function dockerComposeArgs(config, options = {}) {
  const runtimeEnvPath = writeRuntimeEnv(config);
  const profiles = options.profiles ?? config.profiles;
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
    throw new Error(`docker is required to run Splice LocalNet: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const detail = stderr ? `\n${stderr}` : '';
    throw new Error(`docker compose exited with status ${result.status}${detail}`);
  }

  return result;
}
