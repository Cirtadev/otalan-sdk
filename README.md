# `otalan-sdk`

Monorepo for the Otalan mobile OTA SDK packages:

- `@otalan/capacitor`: full Otalan OTA client for Capacitor apps
- `@otalan/expo`: small confirmation helper for Expo apps using `expo-updates`

Website: [otalan.com](https://otalan.com)

## Which Package To Use

### `@otalan/capacitor`

Use this when your app is built with Capacitor and Otalan should handle:

- update checks against Otalan
- bundle download and staging
- reload after install
- install confirmation with advisory transfer source metadata

Package docs: [capacitor/README.md](capacitor/README.md)

### `@otalan/expo`

Use this when your app uses Expo with `expo-updates` and you only need:

- startup confirmation for launched OTA updates
- current update metadata
- a small `initializeUpdater()` helper

It does not fetch, select, or apply updates itself.

Package docs: [expo/README.md](expo/README.md)

## App Lifecycle

Otalan serves OTA traffic only for apps that are active in Otalan. If update traffic is unavailable for an app, the mobile SDKs keep the host app running and surface or log the request failure according to the helper being used.

## Update Compatibility

Capacitor update checks include `appId`, `platform`, `channel`, `nativeVersion`, `currentBundleId` when available, and stable `deviceId`. Successful `/capacitor/check` responses must include matching `appId`, `platform`, and `runtimeVersion`; `@otalan/capacitor` validates those values before trusting `updateAvailable` or using any selected bundle.

Expo update selection is handled by `expo-updates` and the Otalan manifest endpoint. `@otalan/expo` observes and confirms the launched update; it does not fetch or stage Expo updates itself.

## Startup Enablement

When `enabled` is omitted, both startup helpers auto-enable only when their runtime and required credentials are available. Pass `enabled: false` to force a no-op. Pass `enabled: true` only when your app has its own gate, because it bypasses the helper's default platform and credential checks and can surface missing or invalid config as startup request failures.

## Device IDs

Both package startup helpers can create and persist a stable device ID unless the app provides one. Low-level `createUpdater()` APIs still require an explicit `deviceId`.

Expo apps that use staged rollouts must also send the same ID as `x-device-id` on update checks, because `@otalan/expo` does not own the `expo-updates` check request. Capacitor checks go through `@otalan/capacitor`, so the SDK sends the resolved ID itself.

## Basic Usage

Capacitor startup:

```ts
import { initializeUpdater } from '@otalan/capacitor'

const otalan = await initializeUpdater({
  apiUrl: 'https://api.otalan.com',
  apiKey: 'otalan_ota_xxx',
  channel: 'production',
  onResume: true,
})

const deviceId = await otalan.getDeviceId()
```

You can also pass these values from your app's environment variables. For example, keep local values in a `.env` file and read them with the env API provided by your app framework, such as Expo public env vars or Vite's `import.meta.env`.

For Expo apps:

```dotenv
EXPO_PUBLIC_OTALAN_API_URL=https://api.otalan.com
EXPO_PUBLIC_OTALAN_API_KEY=otalan_ota_xxx
EXPO_PUBLIC_OTALAN_APP_ID=com.example.app
```

For Capacitor apps using Vite:

```dotenv
VITE_OTALAN_API_URL=https://api.otalan.com
VITE_OTALAN_API_KEY=otalan_ota_xxx
VITE_OTALAN_APP_ID=com.example.app
VITE_OTALAN_CHANNEL=production
```

Expo startup:

```ts
import { initializeUpdater } from '@otalan/expo'

const otalan = await initializeUpdater({
  apiUrl: 'https://api.otalan.com',
  apiKey: 'otalan_ota_xxx',
  appId: 'com.example.app',
})

const deviceId = await otalan.getDeviceId()
```

## API Return Summary

`@otalan/capacitor`:

- `initializeUpdater(config)`: returns an initialized helper with `getDeviceId()`, `getUpdater()`, and `sync(trigger?)`
- `initialized.getDeviceId()`: returns `Promise<string | null>`
- `initialized.getUpdater()`: returns a promise resolving to the low-level updater or `null`
- `initialized.sync(trigger?)`: returns `Promise<CapacitorSyncResult | null>`
- `createUpdater(config)`: returns a low-level updater with `ready()`, `getCurrentBundleId()`, `check()`, and `sync()`
- `updater.ready()`: returns the Live Update ready result
- `updater.getCurrentBundleId()`: returns `Promise<string | undefined>`
- `updater.check()`: returns `Promise<CapacitorCheckResult>`
- `updater.sync()`: returns `Promise<CapacitorSyncResult>`

`@otalan/expo`:

- `initializeUpdater(config)`: returns an initialized helper with `getDeviceId()`, `getUpdater()`, and `ready()`
- `initialized.getDeviceId()`: returns `Promise<string | null>`
- `initialized.getUpdater()`: returns the low-level updater or `null`
- `initialized.ready()`: returns `Promise<ExpoReadyResult | null>`
- `createUpdater(config)`: returns a low-level updater with `getCurrentUpdate()`, `confirmCurrentUpdate()`, and `ready()`
- `updater.getCurrentUpdate()`: returns `Promise<ExpoReadyResult>`
- `updater.confirmCurrentUpdate()`: returns `Promise<ExpoReadyResult>`
- `updater.ready()`: returns `Promise<ExpoReadyResult>`

## Platform Support

The SDK packages can be installed and used from development machines running Windows, macOS, or Linux.

Runtime support is for native mobile apps:

- iOS and Android apps built with Capacitor through `@otalan/capacitor`
- iOS and Android apps using supported Expo SDK versions with `expo-updates` through `@otalan/expo`

## Version Support

- `@otalan/capacitor` officially supports Capacitor 7 and 8.
- `@otalan/expo` officially supports Expo SDK 54 and 55.

The package peer dependencies are intentionally permissive so unsupported combinations can still install and be evaluated.

Other runtimes and older Expo or Capacitor versions may work, but they are outside the official support range for the moment. We do not offer support for unsupported combinations and do not take responsibility for issues caused by using them.

## Consumer Install

You do not need Bun to use either package in an app.

Install only the package that matches your app runtime.

For Capacitor apps:

```bash
npm install @otalan/capacitor @capawesome/capacitor-live-update @capacitor/app @capacitor/core
```

For Expo apps using `expo-updates`:

```bash
npm install @otalan/expo expo-updates
```

Official support ranges are documented in each package README.

## Repo Layout

- `capacitor/`: `@otalan/capacitor` source, package docs, and tests
- `expo/`: `@otalan/expo` source, package docs, and tests
- root scripts: workspace-level install, lint, typecheck, test, and build commands

## Repo Development

Bun 1.3.11 or newer is required to build and validate this repo. The pinned package manager is `bun@1.3.13`.

```bash
bun install
bun run lint
bun run check
bun test
bun run build
```

Package tests live under each workspace `tests/` directory.

For package-specific work:

```bash
bun run build:capacitor
bun run build:expo
```
