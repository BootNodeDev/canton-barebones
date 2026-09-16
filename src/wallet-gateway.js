// Builds the Wallet Gateway's own configuration file.
//
// The Wallet Gateway (https://github.com/canton-network/wallet-gateway) is a
// server-side wallet that exposes the CIP-103 dApp JSON-RPC API plus a user web
// interface. It is published on npm as @canton-network/wallet-gateway-remote and
// refuses to start without a config file describing where its ledger, its
// identity provider and its stores live.
//
// That file is generated rather than scaffolded: its ledger URL has to match the
// participant this stack actually runs, so letting a developer hand-edit a stale
// copy would only produce a gateway pointing at nothing. Developers change the
// stack through canton-barebones.config.json; this module translates that into
// what the gateway expects.
import fs from 'node:fs';
import path from 'node:path';

// The app-user participant's JSON Ledger API inside the Compose network. Splice
// numbers a participant's ports as <prefix><suffix>, where app-user's prefix is
// 2 and the JSON API's suffix is 975 (PARTICIPANT_JSON_API_PORT_SUFFIX in
// LocalNet's env/common.env). The host is the `canton` container, which hosts
// every participant.
const APP_USER_LEDGER_API_URL = 'http://canton:2975';

// Credentials for LocalNet's unsafe authentication mode, which is how Splice
// ships it for local development: tokens are HMAC-signed with a shared secret
// instead of coming from a real identity provider. The three values below are
// LocalNet's own defaults, so a token the gateway signs is one the participant
// accepts:
//   - the audience is AUTH_APP_USER_AUDIENCE (env/app-user-auth-on.env)
//   - the user is AUTH_APP_USER_VALIDATOR_USER_NAME (same file)
//   - the secret is SPLICE_APP_UI_UNSAFE_SECRET (env/common.env), which applies
//     because SPLICE_APP_UI_UNSAFE defaults to true
// Changing any of them in a Compose override means changing them here too.
const LOCALNET_AUDIENCE = 'https://canton.network.global';
const LOCALNET_LEDGER_USER = 'ledger-api-user';
const LOCALNET_UNSAFE_SECRET = 'unsafe';

// The port the gateway listens on inside its container. The host port is a
// separate config field and is mapped onto this one, so this value never has to
// change and the generated file stays identical across projects.
export const WALLET_GATEWAY_CONTAINER_PORT = 3030;

// Where the container keeps its SQLite stores. The paths in the generated config
// are relative, so they resolve against the container's working directory, which
// templates/wallet-gateway.yaml backs with a named volume.
const STORE_FILE = 'store.sqlite';
const SIGNING_STORE_FILE = 'signing_store.sqlite';

// Self-signed tokens need no identity provider to talk to, so the gateway is
// given exactly one: an issuer name it signs its own tokens under. LocalNet's
// unsafe mode does not check the issuer, only the signature and the audience.
const IDENTITY_PROVIDER_ID = 'idp-localnet-self-signed';

// The authentication block the gateway uses for both user and admin calls. In
// unsafe mode the participant grants whatever the token claims, so there is no
// separate admin identity to model: both roles sign as the same ledger user.
function localnetAuth() {
  return {
    method: 'self_signed',
    issuer: 'self-signed',
    audience: LOCALNET_AUDIENCE,
    scope: 'openid daml_ledger_api offline_access',
    clientId: LOCALNET_LEDGER_USER,
    clientSecret: LOCALNET_UNSAFE_SECRET,
  };
}

// Produces the gateway's config object for this stack. Pure, so the shape can be
// asserted in tests without writing to disk.
export function buildWalletGatewayConfig() {
  return {
    kernel: {
      id: 'canton-barebones',
      clientType: 'remote',
    },
    logging: {
      level: 'info',
      format: 'pretty',
    },
    server: {
      port: WALLET_GATEWAY_CONTAINER_PORT,
      dappPath: '/api/v0/dapp',
      userPath: '/api/v0/user',
      // Any origin is allowed because the dApps that connect to a local stack are
      // whatever the developer happens to be running, on whatever port their dev
      // server picked.
      allowedOrigins: '*',
      requestSizeLimit: '5mb',
      requestRateLimit: 10000,
      trustProxy: false,
      // The JWT claim that marks a caller as admin. With self-signed tokens the
      // gateway mints its own, so this grants admin to the local developer.
      admin: 'sub',
      signingWorker: {
        pollInterval: 5000,
      },
    },
    store: {
      connection: { type: 'sqlite', database: STORE_FILE },
    },
    signingStore: {
      connection: { type: 'sqlite', database: SIGNING_STORE_FILE },
    },
    bootstrap: {
      idps: [
        {
          id: IDENTITY_PROVIDER_ID,
          type: 'self_signed',
          issuer: 'unsafe-auth',
        },
      ],
      networks: [
        {
          id: 'canton:localnet',
          name: 'LocalNet (app-user)',
          description: "Canton Barebones LocalNet, through the app-user participant's JSON Ledger API",
          identityProviderId: IDENTITY_PROVIDER_ID,
          auth: localnetAuth(),
          adminAuth: localnetAuth(),
          ledgerApi: { baseUrl: APP_USER_LEDGER_API_URL },
        },
      ],
    },
    hashingScheme: {
      version: 'HASHING_SCHEME_VERSION_V3',
    },
  };
}

// Writes the gateway's config into the project's .generated/ directory and
// returns its path, for templates/wallet-gateway.yaml to mount into the
// container. Written on every command that builds the Compose invocation, even
// when the gateway is off: Compose resolves the mount's source path while
// reading the file, and a missing source would be created as a directory.
export function writeWalletGatewayConfig(config) {
  const configFilePath = path.resolve(config.generatedDir, 'wallet-gateway.config.json');
  fs.writeFileSync(configFilePath, `${JSON.stringify(buildWalletGatewayConfig(), null, 2)}\n`);
  return configFilePath;
}
