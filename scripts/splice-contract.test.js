import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { findContractMismatches } from '../src/splice-contract.js';

// A fake Splice compose.yaml, cut down to only the parts the check reads. It
// copies the real shape at the pinned release:
//   - `nginx` and the three SV web UI services, because those are the services
//     templates/runtime-overrides.yaml addresses by name.
//   - nginx's route-template mounts written the way Splice writes them, with the
//     validator's *_PROFILE value spliced into the middle of the filename, so
//     `app-user.c${APP_USER_PROFILE}f.template` spells "conf" only while that
//     validator is on. Our override shadows that "on" spelling.
//   - one profile per service, covering the names the wrapper can select.
function spliceModel() {
  return {
    services: {
      nginx: {
        volumes: [
          '${LOCALNET_DIR}/conf/nginx/app-provider.conf:/etc/nginx/templates/app-provider.c${APP_PROVIDER_PROFILE}f.template',
          '${LOCALNET_DIR}/conf/nginx/app-user.conf:/etc/nginx/templates/app-user.c${APP_USER_PROFILE}f.template',
        ],
      },
      'scan-web-ui': { profiles: ['sv'] },
      'sv-web-ui': { profiles: ['sv'] },
      'wallet-web-ui-sv': { profiles: ['sv'] },
      'wallet-web-ui-app-user': { profiles: ['app-user'] },
    },
  };
}

// A fake templates/runtime-overrides.yaml: the services it pins to 0 replicas,
// and the two nginx mount targets it shadows. Its targets carry no variable,
// which is the point of the comparison: the override only replaces Splice's
// mount while Splice's own target resolves to this same string.
function overrideModel() {
  return {
    services: {
      nginx: {
        volumes: [
          '${APP_PROVIDER_NGINX_ROUTES}:/etc/nginx/templates/app-provider.conf.template',
          '${APP_USER_NGINX_ROUTES}:/etc/nginx/templates/app-user.conf.template',
        ],
      },
      'scan-web-ui': { deploy: { replicas: '${SCAN_WEB_UI_REPLICAS}' } },
      'sv-web-ui': { deploy: { replicas: '${SV_WEB_UI_REPLICAS}' } },
      'wallet-web-ui-sv': { deploy: { replicas: '${WALLET_WEB_UI_SV_REPLICAS}' } },
    },
  };
}

// The profiles the wrapper passes to `--profile`, a subset of what the model
// above declares, so the compatible case has nothing to report.
const profiles = ['sv', 'app-user'];

// Runs the check on the compatible pair above, with `overrides` replacing one
// input so each case states only what it breaks.
function check(overrides = {}) {
  return findContractMismatches({
    spliceModel: spliceModel(),
    overrideModel: overrideModel(),
    profiles,
    ...overrides,
  });
}

// Scenario: what the wrapper names in Splice's compose model must still be there.
// Compose merges by name and silently accepts a name that matches nothing, so
// each case below is a real breakage that would otherwise surface as a stack
// that starts and misbehaves rather than as an error.
describe('findContractMismatches', () => {
  // The pinned release defines every service, profile and mount target the
  // wrapper addresses, so a compatible Splice must report nothing at all.
  it('reports nothing when the pinned Splice still defines everything', () => {
    assert.deepEqual(check(), []);
  });

  // Splice renaming `scan-web-ui` is the silent failure this check exists for:
  // the override's 0-replica pin would apply to a service Compose invents from
  // the override alone, so the real scan UI keeps starting even when the user
  // turned it off in their config.
  it('reports a service the override targets but Splice renamed', () => {
    const model = spliceModel();
    model.services['scan-ui'] = model.services['scan-web-ui'];
    delete model.services['scan-web-ui'];
    const mismatches = check({ spliceModel: model });
    assert.equal(mismatches.length, 1);
    assert.match(mismatches[0], /service "scan-web-ui"/);
  });

  // A profile the wrapper still passes to `--profile` but Splice dropped: the
  // selection would bring up nothing instead of that validator's UI bundle.
  it('reports a profile the wrapper selects but Splice dropped', () => {
    const model = spliceModel();
    delete model.services['wallet-web-ui-app-user'].profiles;
    const mismatches = check({ spliceModel: model });
    assert.equal(mismatches.length, 1);
    assert.match(mismatches[0], /profile "app-user"/);
  });

  // Splice moving a validator's route template out from under our mount. Compose
  // deduplicates volumes by target, so a target that no longer matches adds a
  // second mount instead of replacing Splice's: nginx would keep the real routes
  // of a headless validator and die on its missing UI containers at startup.
  it('reports an nginx mount target Splice no longer uses', () => {
    const model = spliceModel();
    model.services.nginx.volumes = [
      '${LOCALNET_DIR}/conf/nginx/app-user.conf:/etc/nginx/routes/app-user.c${APP_USER_PROFILE}f.template',
    ];
    const mismatches = check({ spliceModel: model });
    assert.equal(mismatches.length, 2);
    for (const mismatch of mismatches) {
      assert.match(mismatch, /nginx mount target/);
    }
  });

  // The "off" spelling must not count as a match. Splice's target only reads
  // ".conf.template" while the validator is on; with APP_USER_PROFILE=off it
  // reads ".coff.template", which nginx renders but never includes. If the check
  // compared the raw string it would accept a Splice that no longer offers the
  // target we actually shadow.
  it('matches Splice targets on their profile-on spelling only', () => {
    const model = spliceModel();
    model.services.nginx.volumes = [
      '${LOCALNET_DIR}/conf/nginx/app-provider.conf:/etc/nginx/templates/app-provider.c${APP_PROVIDER_PROFILE}f.template',
      '${LOCALNET_DIR}/conf/nginx/app-user.conf:/etc/nginx/templates/app-user.coff.template',
    ];
    const mismatches = check({ spliceModel: model });
    assert.equal(mismatches.length, 1);
    assert.match(mismatches[0], /app-user\.conf\.template/);
  });
});
