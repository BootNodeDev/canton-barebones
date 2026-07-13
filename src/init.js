import fs from 'node:fs';
import path from 'node:path';

import { resolveFromPackage, resolveFromProject } from './paths.js';

const files = [
  { src: 'templates/canton-barebones.config.json', dest: 'canton-barebones.config.json' },
  { src: 'templates/splice-localnet-overrides.yaml', dest: 'splice-localnet-overrides.yaml' },
];

// Copies default config and compose overrides into the consumer's project directory.
export function init({ force = false } = {}) {
  for (const { src, dest } of files) {
    const srcPath = resolveFromPackage(src);
    const destPath = resolveFromProject(dest);

    if (!force && fs.existsSync(destPath)) {
      console.log(`exists: ${dest}`);
      continue;
    }

    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcPath, destPath);
    console.log(`${force ? 'overwritten' : 'created'}: ${dest}`);
  }

  console.log('\nRun "canton-barebones start" to launch the stack.');
}
