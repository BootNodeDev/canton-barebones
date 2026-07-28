// This tool works across two different locations, and mixing them up is an easy
// mistake, so all path building goes through this module:
//   - the package: where this tool is installed (holds the bundled templates).
//   - the project: the folder the developer runs the tool from (holds their
//     config, their overrides, and the generated files).
// Keeping the two apart is what lets the same installed CLI scaffold files into,
// and generate files for, any project it is run in.
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

// Builds an absolute path inside the installed package (e.g. a bundled template).
export function resolveFromPackage(...segments) {
  return path.resolve(packageRoot, ...segments);
}

// Builds an absolute path inside the developer's project (e.g. their config file).
export function resolveFromProject(...segments) {
  return path.resolve(projectRoot, ...segments);
}
