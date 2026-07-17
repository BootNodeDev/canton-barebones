#!/usr/bin/env node
// Command-line entry point. It reads the sub-command (init, start, stop, ...) and
// runs it. Every command except `init`/`help` first loads and validates the config
// (which also downloads Splice on first run), then shells out to Docker Compose.
// The heavy lifting lives in src/*; this file is just the dispatcher.
import { loadConfig } from '../src/config.js';
import { init } from '../src/init.js';
import {
  allLocalnetProfiles,
  dockerComposeArgs,
  runDockerCompose,
  writeLocalnetEnv,
} from '../src/compose.js';

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
`);
}

// Dispatches the requested wrapper command against the resolved LocalNet configuration.
function main() {
  const [command = 'help', ...rest] = process.argv.slice(2);

  if (command === 'help' || command === '--help' || command === '-h') {
    usage();
    return;
  }

  if (command === 'init') {
    init({ force: rest.includes('--force') });
    return;
  }

  const config = loadConfig();

  switch (command) {
    case 'setup':
      console.log(`Splice: ${config.splice.repo}@${config.splice.tag}`);
      console.log(`Checkout: ${config.spliceCheckoutDir}`);
      console.log(`LocalNet: ${config.localnetDir}`);
      return;
    case 'validate': {
      const runtimeEnvPath = writeLocalnetEnv(config);
      console.log(`Config OK: ${config.configPath}`);
      console.log(`Splice: ${config.splice.repo}@${config.splice.tag}`);
      console.log(`LocalNet: ${config.localnetDir}`);
      console.log(`Runtime env: ${runtimeEnvPath}`);
      console.log(`LocalNet override: ${config.localnetOverridePath}`);
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
    case 'stop':
      runDockerCompose(config, ['down', '--remove-orphans'], { profiles: allLocalnetProfiles });
      return;
    case 'reset':
      runDockerCompose(config, ['down', '-v', '--remove-orphans'], { profiles: allLocalnetProfiles });
      return;
    case 'status':
      runDockerCompose(config, ['ps']);
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
  console.error(error.message);
  process.exit(1);
}
