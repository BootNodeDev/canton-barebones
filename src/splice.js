import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const localnetPath = 'cluster/compose/localnet';

// Converts GitHub refs into deterministic local folder names.
function pathSegment(value) {
  return value.replaceAll(/[^a-zA-Z0-9._-]/g, '_');
}

// Builds the HTTPS clone URL for the configured GitHub repository.
function githubCloneUrl(repo) {
  return `https://github.com/${repo}.git`;
}

// Runs git and turns command failures into actionable CLI errors.
function runGit(args, options = {}) {
  const result = spawnSync('git', args, {
    stdio: options.stdio ?? 'inherit',
    encoding: 'utf8',
  });

  if (result.error) {
    throw new Error(`git is required to fetch Splice: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} exited with status ${result.status}`);
  }

  return result;
}

// Returns where the pinned Splice checkout and LocalNet files should live.
export function resolveSplicePaths(config) {
  const checkoutDir = path.resolve(
    config.generatedDir,
    'splice',
    pathSegment(config.splice.repo),
    pathSegment(config.splice.tag)
  );

  return {
    checkoutDir,
    localnetDir: path.resolve(checkoutDir, localnetPath),
  };
}

// Fetches the pinned Splice tag with sparse checkout so this repo does not vendor Splice.
export function ensureSpliceCheckout(config) {
  const { checkoutDir, localnetDir } = resolveSplicePaths(config);
  const composeFile = path.resolve(localnetDir, 'compose.yaml');

  if (fs.existsSync(composeFile)) {
    return { checkoutDir, localnetDir };
  }

  fs.mkdirSync(path.dirname(checkoutDir), { recursive: true });
  const tempDir = `${checkoutDir}.tmp-${process.pid}`;
  fs.rmSync(tempDir, { recursive: true, force: true });

  console.log(`Fetching Splice ${config.splice.repo}@${config.splice.tag}`);
  runGit([
    '-c',
    'advice.detachedHead=false',
    'clone',
    '--depth',
    '1',
    '--filter=blob:none',
    '--sparse',
    '--branch',
    config.splice.tag,
    githubCloneUrl(config.splice.repo),
    tempDir,
  ]);
  runGit(['-C', tempDir, 'sparse-checkout', 'set', localnetPath]);

  fs.rmSync(checkoutDir, { recursive: true, force: true });
  fs.renameSync(tempDir, checkoutDir);

  return { checkoutDir, localnetDir };
}
