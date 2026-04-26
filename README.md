# `otalan-sdk`

Monorepo for the Otalan mobile OTA SDK packages:

- `@otalan/capacitor`: full Otalan OTA client for Capacitor apps
- `@otalan/expo`: small confirmation helper for Expo and bare React Native apps using `expo-updates`

## Which Package To Use

### `@otalan/capacitor`

Use this when your app is built with Capacitor and Otalan should handle:

- update checks through `POST /capacitor/check`
- bundle download and staging
- reload after install
- install confirmation with transfer source through `POST /capacitor/confirm`

Package docs: [capacitor/README.md](capacitor/README.md)

### `@otalan/expo`

Use this when your app uses Expo or bare React Native with `expo-updates` and you only need:

- startup confirmation with transfer source through `POST /expo/confirm`
- current update metadata
- a small `initializeUpdater()` helper

It does not fetch, select, or apply updates itself.

Package docs: [expo/README.md](expo/README.md)

## App Lifecycle

Otalan serves OTA traffic only for active, non-archived apps. When an app is archived in Otalan, the mobile SDKs keep the host app running, but update checks and install confirmations for that app are rejected by the API until the app is restored.

## Consumer Install

You do not need Bun to use either package in an app.

Use any package manager you already use:

```bash
npm install @otalan/capacitor
npm install @otalan/expo
```

Peer dependencies are documented in each package README.

## Repo Development

Bun is required to build and validate this repo.

```bash
bun install
bun run lint
bun run check
bun test
bun run build
```

Package tests live under each workspace `tests/` directory.
