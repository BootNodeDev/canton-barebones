// This tool works across two different locations, and mixing them up is an easy
// mistake, so all path building goes through this module:
//   - the package: where this tool is installed (holds the bundled templates).
//   - the project: the folder the developer runs the tool from (holds their
//     config, their overrides, and the generated files).
// Keeping the two apart is what lets the same installed CLI scaffold files into,
// and generate files for, any project it is run in.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Absolute path to this source file, used to locate the package directory below.
const thisFile = fileURLToPath(import.meta.url);

// The installed package directory (one level up from this src/ file). Holds the
// read-only bundled templates that `init` copies out.
export const packageRoot = path.resolve(path.dirname(thisFile), '..');

// The developer's project directory (wherever they ran the command from). Holds
// their config file, their overrides, and everything written under .generated/.
export const projectRoot = process.cwd();

// When the CLI ships as a single compiled binary (the dpm distribution channel)
// there is no installed package directory on disk, so the bundled templates
// cannot be read from packageRoot. The binary's entry point embeds their
// contents at compile time and registers them here, keyed by their
// package-relative path (e.g. "templates/runtime-overrides.yaml"). Under Node
// (the npm channel) nothing registers and the files are read from disk as
// before.
let embeddedPackageFiles = null;

// Called once by the compiled binary's entry point, before any command runs.
export function registerEmbeddedPackageFiles(files) {
  embeddedPackageFiles = files;
}

// Builds an absolute path inside the installed package (e.g. a bundled template).
// Callers need a real file on disk — `init` copies it and docker compose reads
// it as an override (-f) — so in compiled-binary mode the embedded content is
// materialized under the project's .generated/ dir and that path is returned.
export function resolveFromPackage(...segments) {
  const relativePath = segments.join('/');
  if (embeddedPackageFiles && relativePath in embeddedPackageFiles) {
    // Rewritten on every call: the content must always match the running binary's
    // version, and a stale copy from an older binary would be silently wrong.
    const materializedPath = path.resolve(projectRoot, '.generated', relativePath);
    fs.mkdirSync(path.dirname(materializedPath), { recursive: true });
    fs.writeFileSync(materializedPath, embeddedPackageFiles[relativePath]);
    return materializedPath;
  }
  return path.resolve(packageRoot, ...segments);
}

// Builds an absolute path inside the developer's project (e.g. their config file).
export function resolveFromProject(...segments) {
  return path.resolve(projectRoot, ...segments);
}
