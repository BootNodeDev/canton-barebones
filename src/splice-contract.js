// Checks that the pinned Splice release still defines everything this wrapper
// addresses by name in templates/runtime-overrides.yaml.
//
// Docker Compose merges by name and never complains about a name that matches
// nothing, so a Splice release that renames a service does not fail: the
// override lands on nothing and the stack comes up misbehaving. These checks
// turn that silence into an error.
//
// The names are read from the files that emit them rather than restated here, so
// a check cannot drift from what we hand to Docker. Nothing else about Splice is
// asserted; it is free to move anything we do not name.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

import { allLocalnetProfiles } from './compose.js';
import { resolveFromPackage } from './paths.js';

// The target of a short-form `volumes:` entry ("source:target[:mode]").
function mountTarget(entry) {
  return String(entry).split(':')[1] ?? '';
}

// Splice spells a validator's mount target around its *_PROFILE value, so
// app-user.c${APP_USER_PROFILE}f.template reads "conf" only while that validator
// is on, and something nginx ignores when it is off. Our override shadows the
// "on" spelling, so that is the spelling these comparisons use.
function withProfilesOn(target) {
  return target.replaceAll(/\$\{[A-Z_]+_PROFILE\}/g, 'on');
}

// Reports one message per mismatch, empty when the release is compatible. Takes
// parsed models so it can be exercised without a checkout on disk.
export function findContractMismatches({ spliceModel, overrideModel, profiles }) {
  const spliceServices = spliceModel.services ?? {};
  const mismatches = [];

  // Without the real service, the override's replicas pin and nginx alias apply
  // to a service Compose invents from the override alone and never starts.
  for (const name of Object.keys(overrideModel.services ?? {})) {
    if (!(name in spliceServices)) {
      mismatches.push(`service "${name}" is overridden by this wrapper but the pinned Splice does not define it`);
    }
  }

  // A `--profile` selection that matches nothing starts nothing.
  const spliceProfiles = new Set(Object.values(spliceServices).flatMap(service => service?.profiles ?? []));
  for (const profile of profiles) {
    if (!spliceProfiles.has(profile)) {
      mismatches.push(`profile "${profile}" is selectable by this wrapper but the pinned Splice does not define it`);
    }
  }

  // Compose deduplicates volumes by target, which is how the override replaces a
  // validator's nginx routes. A target that no longer matches adds a second mount
  // instead, leaving nginx with the routes of a validator whose UIs are not
  // running: the startup failure the override exists to prevent.
  const spliceTargets = new Set(
    (spliceServices.nginx?.volumes ?? []).map(entry => withProfilesOn(mountTarget(entry)))
  );
  for (const entry of overrideModel.services?.nginx?.volumes ?? []) {
    const target = mountTarget(entry);
    if (!spliceTargets.has(target)) {
      mismatches.push(`nginx mount target "${target}" is overridden by this wrapper but the pinned Splice does not mount anything there`);
    }
  }

  return mismatches;
}

// Reads the pinned checkout and the wrapper's own override, then compares them.
// No variable interpolation is applied: every name compared is a YAML literal.
export function checkSpliceContract(config) {
  const parse = filePath => yaml.load(fs.readFileSync(filePath, 'utf8')) ?? {};
  return findContractMismatches({
    spliceModel: parse(path.resolve(config.localnetDir, 'compose.yaml')),
    overrideModel: parse(resolveFromPackage('templates/runtime-overrides.yaml')),
    profiles: allLocalnetProfiles,
  });
}
