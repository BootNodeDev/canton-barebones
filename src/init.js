// Handles `canton-barebones init`: the one-time setup step. It copies the bundled
// default files out of the package and into the developer's project so they own
// and edit their own copies (same idea as scaffolding a tsconfig.json). Nothing
// here downloads Splice or starts anything — that happens later, on `start`.
import fs from 'node:fs';
import path from 'node:path';

import { resolveFromPackage, resolveFromProject } from './paths.js';

// The files scaffolded into the project: the stack config the developer edits,
// and the compose override that layers our local tweaks on top of Splice's files.
const files = [
  { src: 'templates/canton-barebones.config.json', dest: 'canton-barebones.config.json' },
  { src: 'templates/splice-localnet-overrides.yaml', dest: 'splice-localnet-overrides.yaml' },
];

// Copies each bundled template into the project. Existing files are left untouched
// unless `force` is set, so re-running init never silently overwrites edits.
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
