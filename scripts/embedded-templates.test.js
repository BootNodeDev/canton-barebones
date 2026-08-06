import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Covers the one behavior that differs between the two distribution channels:
// how resolveFromPackage locates the bundled templates.
//   - npm channel: nothing is registered, so it resolves to a real file inside
//     the installed package directory (next to src/).
//   - compiled-binary channel (dpm): scripts/binary-entry.js registers the
//     template contents that were embedded at compile time, and the function
//     must write them to a real file under the project's .generated/ — both
//     `init` (which copies the file) and docker compose (which reads it via -f
//     from another process) need an actual path on disk, not an in-memory string.
//
// paths.js captures process.cwd() as the project root at import time, so the
// suite chdirs into a throwaway directory BEFORE importing it. That keeps every
// materialized file inside the temp dir instead of polluting the repository
// (which acts as the project when tests run from the repo root).
// realpathSync canonicalizes the freshly created dir (on macOS os.tmpdir() goes
// through the /var → /private/var symlink) so it compares equal to what paths.js
// derives from process.cwd(), which the OS reports symlink-resolved.
const projectDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'canton-barebones-paths-')));
process.chdir(projectDir);

const { packageRoot, registerEmbeddedPackageFiles, resolveFromPackage } = await import(
  '../src/paths.js'
);

after(() => {
  // Leave the temp dir before deleting it: removing the process's cwd fails on
  // some platforms.
  process.chdir(os.tmpdir());
  fs.rmSync(projectDir, { recursive: true, force: true });
});

// The npm channel: no embedded files were registered, so the function must
// behave as a pure path builder pointing inside the installed package, and it
// must not touch the filesystem (materializing is a binary-only behavior).
describe('resolveFromPackage without embedded files (npm channel)', () => {
  it('resolves inside the package directory and writes nothing', () => {
    // Explicitly reset: describe blocks in this file share module state, and
    // this suite documents the "nothing registered" default.
    registerEmbeddedPackageFiles(null);

    const resolved = resolveFromPackage('templates/runtime-overrides.yaml');

    assert.equal(resolved, path.resolve(packageRoot, 'templates/runtime-overrides.yaml'));
    // No .generated/ side effect: materialization must not happen on this channel.
    assert.equal(fs.existsSync(path.resolve(projectDir, '.generated')), false);
  });
});

// The compiled-binary channel: the entry point registered the embedded contents,
// so asking for a package file must produce a real file under the project's
// .generated/ that other processes (docker compose) can read.
describe('resolveFromPackage with embedded files (compiled binary)', () => {
  // Stands in for a template embedded at compile time. The key mirrors the real
  // package-relative paths used by init.js/compose.js ("templates/<name>"); the
  // content just needs to be recognizable so the assertions can compare bytes.
  const embedded = { 'templates/fake-override.yaml': 'services: {}\n# embedded marker\n' };

  it('materializes the content under .generated/ and returns that path', () => {
    registerEmbeddedPackageFiles(embedded);

    const resolved = resolveFromPackage('templates/fake-override.yaml');

    // The returned path must live in the project (cwd), not in the package, and
    // the file must exist with exactly the embedded content.
    assert.equal(resolved, path.resolve(projectDir, '.generated', 'templates/fake-override.yaml'));
    assert.equal(fs.readFileSync(resolved, 'utf8'), embedded['templates/fake-override.yaml']);
  });

  it('rewrites the file on every call so a stale copy cannot survive', () => {
    registerEmbeddedPackageFiles(embedded);
    const resolved = resolveFromPackage('templates/fake-override.yaml');

    // Simulate a leftover from an older binary version: the template exists on
    // disk but its content no longer matches the running binary.
    fs.writeFileSync(resolved, 'stale content from a previous version\n');

    // Resolving again must restore the embedded content, not trust the disk.
    resolveFromPackage('templates/fake-override.yaml');
    assert.equal(fs.readFileSync(resolved, 'utf8'), embedded['templates/fake-override.yaml']);
  });

  it('fails loudly for a package file that was never embedded', () => {
    registerEmbeddedPackageFiles(embedded);

    // The guarded mistake: a new template gets added to the package but not to
    // scripts/binary-entry.js. Falling through to the package-directory path
    // would ENOENT later (that directory does not exist inside a binary), so
    // the error must name the missing file and the fix instead.
    assert.throws(
      () => resolveFromPackage('templates/forgotten.yaml'),
      error => {
        assert.match(error.message, /templates\/forgotten\.yaml/);
        assert.match(error.message, /binary-entry\.js/);
        return true;
      },
      'expected resolveFromPackage to throw for a non-embedded file'
    );
  });
});
