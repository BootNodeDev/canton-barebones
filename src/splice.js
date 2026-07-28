// Downloads the Splice source this tool is built on. Splice is the Canton
// application stack (published as a public GitHub repo) that ships a ready-made
// "LocalNet" — a set of Docker Compose files for running a local Canton network.
// Rather than copying Splice into this repo, we fetch a single pinned version of
// just its LocalNet folder into .generated/ the first time the stack is started,
// so upgrading is a one-line version change and our repo stays small.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Path, inside the Splice repo, to the LocalNet compose files we actually use.
const localnetPath = 'cluster/compose/localnet';

// Converts GitHub refs into deterministic local folder names. Characters that are
// not safe in folder names (like "/") become "_", so "canton-network/splice"
// turns into "canton-network_splice".
function pathSegment(value) {
  return value.replaceAll(/[^a-zA-Z0-9._-]/g, '_');
}

// Builds the HTTPS git URL for a "owner/repo" GitHub slug.
function githubCloneUrl(repo) {
  return `https://github.com/${repo}.git`;
}

// Runs a git command, streaming its output, and turns a missing git binary or a
// non-zero exit into a clear error instead of a silent failure.
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

// Computes where a given repo+tag checkout lives under .generated/. Each version
// gets its own folder (.generated/splice/<repo>/<tag>/...), so changing the pin
// fetches into a fresh folder instead of mutating the old one.
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

// Makes sure the pinned Splice LocalNet files exist locally, downloading them if
// they are missing. It is safe to call on every command: if the checkout is
// already there (its compose.yaml exists) it returns immediately. The download
// uses a shallow, "sparse" clone (only the LocalNet folder, no blobs we don't
// need) to stay fast, and writes to a temp folder first so an interrupted fetch
// can never leave a half-downloaded checkout behind.
export function ensureSpliceCheckout(config) {
  const { checkoutDir, localnetDir } = resolveSplicePaths(config);
  const composeFile = path.resolve(localnetDir, 'compose.yaml');

  // Already downloaded for this pin: nothing to do.
  if (fs.existsSync(composeFile)) {
    return { checkoutDir, localnetDir };
  }

  fs.mkdirSync(path.dirname(checkoutDir), { recursive: true });
  // Download into a per-process temp folder, then swap it into place atomically.
  const tempDir = `${checkoutDir}.tmp-${process.pid}`;
  fs.rmSync(tempDir, { recursive: true, force: true });

  console.log(`Fetching Splice ${config.splice.repo}@${config.splice.tag}`);
  // Shallow clone of just the pinned tag, in sparse mode so no files are checked
  // out yet and file contents are fetched on demand (--filter=blob:none).
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
  // Now pull down only the LocalNet folder we need.
  runGit(['-C', tempDir, 'sparse-checkout', 'set', localnetPath]);

  // Swap the finished download into its final location in one step.
  fs.rmSync(checkoutDir, { recursive: true, force: true });
  fs.renameSync(tempDir, checkoutDir);

  return { checkoutDir, localnetDir };
}
