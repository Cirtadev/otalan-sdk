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

## Platform Support

The SDK packages can be installed and used from development machines running Windows, macOS, or Linux.

Runtime support is for native mobile apps:

- iOS and Android apps built with Capacitor through `@otalan/capacitor`
- iOS and Android apps using Expo or bare React Native with `expo-updates` through `@otalan/expo`

## Version Support

- `@otalan/capacitor` supports Capacitor 8 and Capacitor 7.
- `@otalan/expo` supports Expo SDK 54 and 55.
- Bare React Native support covers React Native 0.84 and 0.85 when paired with a compatible `expo-updates` setup.

See each package README for exact peer dependency ranges.

Older versions may work, but they are outside the supported range. We do not offer support for unsupported versions and do not take responsibility for issues caused by using them.

## Consumer Install

You do not need Bun to use either package in an app.

Use any package manager you already use:

```bash
npm install @otalan/capacitor
npm install @otalan/expo
```

Peer dependencies are documented in each package README.

## Repo Development

Bun 1.3.11 or newer is required to build and validate this repo.

```bash
bun install
bun run lint
bun run check
bun test
bun run build
```

Package tests live under each workspace `tests/` directory.
