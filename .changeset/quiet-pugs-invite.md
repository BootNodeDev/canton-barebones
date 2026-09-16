---
"@bootnodedev/canton-barebones": minor
---

Add an optional Wallet Gateway to the stack, behind a new `walletGateway` config section. Turning it on runs [canton-network/wallet-gateway](https://github.com/canton-network/wallet-gateway) against the app-user participant and publishes its web wallet and CIP-103 dApp JSON-RPC API on your host, so a dApp can connect to this stack the way it would to a real wallet. The section is optional and off by default, so existing configs keep working untouched.
