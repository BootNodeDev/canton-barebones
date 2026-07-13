import path from 'node:path';
import { fileURLToPath } from 'node:url';

const thisFile = fileURLToPath(import.meta.url);

// Where the npm package is installed (for bundled defaults/templates).
export const packageRoot = path.resolve(path.dirname(thisFile), '..');

// Where the consumer's project lives (for config, overrides, and generated files).
export const projectRoot = process.cwd();

// Resolves paths relative to the package installation directory.
export function resolveFromPackage(...segments) {
  return path.resolve(packageRoot, ...segments);
}

// Resolves paths relative to the consumer's project directory.
export function resolveFromProject(...segments) {
  return path.resolve(projectRoot, ...segments);
}
