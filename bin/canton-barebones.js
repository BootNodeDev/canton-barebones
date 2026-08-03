#!/usr/bin/env node
// Command-line entry point. It reads the sub-command (init, start, stop, ...) and
// runs it. Every command except `init`/`help`/`stop` first loads and validates the
// config (which also downloads Splice on first run), then shells out to Docker
// Compose. `stop` only reads `composeProjectName` so a broken config can still
// bring the stack down. The heavy lifting lives in src/*; this file is just the
// dispatcher.
import { loadComposeProjectName, loadConfig } from '../src/config.js';
import { init } from '../src/init.js';
import {
  allLocalnetProfiles,
  deriveRuntimePlan,
  dockerComposeArgs,
  runDockerCompose,
  stopStackByProjectName,
  writeLocalnetEnv,
} from '../src/compose.js';
import { isJsonMode, printError, printResult, setJsonMode } from '../src/output.js';

// Prints the CLI contract without requiring Docker or a valid LocalNet checkout.
function usage() {
  console.log(`Usage: canton-barebones <command>

Commands:
  init                 Scaffold config and compose overrides into the project
  setup                Fetch the pinned Splice LocalNet source
  validate             Validate config and LocalNet paths
  compose <args...>    Run docker compose with the configured LocalNet files
  start                Start the stack
  stop                 Stop the stack and keep volumes
  reset                Stop the stack and remove volumes
  status               Show compose service status
  logs [args...]       Show compose logs
  help                 Show this help

Flags:
  --json               Machine-readable output for validate/setup/status.
                       Success is written to stdout, errors to stderr; the exit
                       code is 0 on success, 1 on failure.
`);
}

// Dispatches the requested wrapper command against the resolved LocalNet configuration.
function main() {
  // `--json` is a global flag that switches the read commands (validate/setup/
  // status) to machine-readable output. Strip it up front so it never leaks into
  // the args forwarded to `compose`/`logs`.
  const argv = process.argv.slice(2);
  setJsonMode(argv.includes('--json'));
  const [command = 'help', ...rest] = argv.filter(arg => arg !== '--json');

  if (command === 'help' || command === '--help' || command === '-h') {
    usage();
    return;
  }

  if (command === 'init') {
    init({ force: rest.includes('--force') });
    return;
  }

  // `stop` deliberately skips loadConfig(): tearing the stack down must keep
  // working when the config is broken, and Compose only needs the project name
  // to find the containers. Every other Docker command still validates fully.
  if (command === 'stop') {
    stopStackByProjectName(loadComposeProjectName());
    return;
  }

  const config = loadConfig();

  switch (command) {
    case 'setup':
      printResult(
        {
          splice: { repo: config.splice.repo, tag: config.splice.tag, imageTag: config.imageTag },
          checkout: config.spliceCheckoutDir,
          localnetDir: config.localnetDir,
        },
        () => {
          console.log(`Splice: ${config.splice.repo}@${config.splice.tag}`);
          console.log(`Checkout: ${config.spliceCheckoutDir}`);
          console.log(`LocalNet: ${config.localnetDir}`);
        }
      );
      return;
    case 'validate': {
      const runtimeEnvPath = writeLocalnetEnv(config);
      // The resolved runtime plan is included so a consumer can see exactly what
      // the config will launch (profiles, headless validators, participant env)
      // without having to start the stack.
      printResult(
        {
          splice: { repo: config.splice.repo, tag: config.splice.tag, imageTag: config.imageTag },
          config: {
            version: config.version,
            composeProjectName: config.composeProjectName,
            dockerNetwork: config.dockerNetwork,
            persistence: config.persistence,
            validators: config.validators,
            networkTools: config.networkTools,
          },
          paths: {
            config: config.configPath,
            localnetDir: config.localnetDir,
            runtimeEnv: runtimeEnvPath,
            localnetOverride: config.localnetOverridePath,
            generatedDir: config.generatedDir,
          },
          plan: deriveRuntimePlan(config),
        },
        () => {
          console.log(`Config OK: ${config.configPath}`);
          console.log(`Splice: ${config.splice.repo}@${config.splice.tag}`);
          console.log(`LocalNet: ${config.localnetDir}`);
          console.log(`Runtime env: ${runtimeEnvPath}`);
          console.log(`LocalNet override: ${config.localnetOverridePath}`);
        }
      );
      return;
    }
    case 'compose': {
      if (rest.length === 0) {
        console.log(['docker', ...dockerComposeArgs(config)].join(' '));
        return;
      }
      runDockerCompose(config, rest);
      return;
    }
    case 'start':
      runDockerCompose(config, ['up', '-d', '--remove-orphans']);
      return;
    case 'reset':
      runDockerCompose(config, ['down', '-v', '--remove-orphans'], { profiles: allLocalnetProfiles });
      return;
    case 'status':
      // Delegate machine-readable output to Docker Compose's own `--format json`,
      // which already emits one JSON object per service.
      runDockerCompose(config, isJsonMode() ? ['ps', '--format', 'json'] : ['ps']);
      return;
    case 'logs':
      runDockerCompose(config, ['logs', ...rest]);
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

try {
  main();
} catch (error) {
  printError(error.message);
  process.exit(1);
}
