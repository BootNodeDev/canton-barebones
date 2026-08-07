// Builds the dpm component for every supported platform: compiles the CLI to a
// standalone binary per OS/arch (via Bun, which cross-compiles all targets from
// any host) and assembles the directory layout `dpm publish component` expects —
// one directory per platform, each holding the binary, the component manifest
// and the LICENSE (dpm refuses to publish a component without one at its root).
//
//   dist/dpm-component/<os>-<arch>/
//   ├── canton-barebones[.exe]
//   ├── component.yaml
//   └── LICENSE
//
// Run with `npm run build:component`. For quick host-only iteration during
// development, `npm run build:binary` compiles just the current platform.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Every platform the component is published for. `os`/`arch` follow dpm's
// naming (used for the directory names and the `-p <os>/<arch>=<dir>` publish
// flags); `bunTarget` is Bun's name for the same platform.
const TARGETS = [
  { os: 'linux', arch: 'amd64', bunTarget: 'bun-linux-x64' },
  { os: 'linux', arch: 'arm64', bunTarget: 'bun-linux-arm64' },
  { os: 'darwin', arch: 'amd64', bunTarget: 'bun-darwin-x64' },
  { os: 'darwin', arch: 'arm64', bunTarget: 'bun-darwin-arm64' },
  { os: 'windows', arch: 'amd64', bunTarget: 'bun-windows-x64' },
];

// The manifest is maintained once (dpm-component/component.yaml) and copied into
// every platform directory. dpm's schema has no per-platform fields, so the
// windows copy must itself point at the .exe binary name.
function platformManifest(sourceManifest, os) {
  if (os !== 'windows') {
    return sourceManifest;
  }
  const rewritten = sourceManifest.replace('path: ./canton-barebones', 'path: ./canton-barebones.exe');
  if (rewritten === sourceManifest) {
    throw new Error('component.yaml: expected a "path: ./canton-barebones" command to rewrite for windows');
  }
  return rewritten;
}

// Compiles the CLI for one target. The entry point is the binary-specific one
// (scripts/binary-entry.js), which embeds the templates/ contents at compile
// time — see that file and src/paths.js for how the two channels differ.
function compileBinary(target, outDir) {
  // Bun appends .exe for windows targets on its own; naming it explicitly keeps
  // the manifest, this script and the output aligned without relying on that.
  const binaryName = target.os === 'windows' ? 'canton-barebones.exe' : 'canton-barebones';
  const outFile = path.join(outDir, binaryName);

  const result = spawnSync(
    'bun',
    ['build', '--compile', `--target=${target.bunTarget}`, 'scripts/binary-entry.js', '--outfile', outFile],
    { cwd: repoRoot, stdio: 'inherit' }
  );

  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error(`bun is required to build the component binaries: ${result.error.message}`);
    }
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`bun build for ${target.bunTarget} exited with status ${result.status}`);
  }
}

const sourceManifest = fs.readFileSync(path.join(repoRoot, 'dpm-component', 'component.yaml'), 'utf8');
const license = path.join(repoRoot, 'LICENSE');

// Start from a clean slate so removed platforms or renamed files never linger
// in the published artifact.
const componentRoot = path.join(repoRoot, 'dist', 'dpm-component');
fs.rmSync(componentRoot, { recursive: true, force: true });

for (const target of TARGETS) {
  const outDir = path.join(componentRoot, `${target.os}-${target.arch}`);
  fs.mkdirSync(outDir, { recursive: true });

  compileBinary(target, outDir);
  fs.writeFileSync(path.join(outDir, 'component.yaml'), platformManifest(sourceManifest, target.os));
  fs.copyFileSync(license, path.join(outDir, 'LICENSE'));

  console.log(`built ${path.relative(repoRoot, outDir)}`);
}

// The publish command needs one -p flag per platform; printing it here keeps
// the CI step and manual publishes copy-pasteable and in sync with TARGETS.
const platformFlags = TARGETS.map(
  t => `-p ${t.os}/${t.arch}=dist/dpm-component/${t.os}-${t.arch}`
).join(' ');
console.log(`\npublish with:\n  dpm publish component oci://<registry>/canton-barebones:<version> ${platformFlags}`);
