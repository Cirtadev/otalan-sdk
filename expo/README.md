# `@otalan/expo`

Otalan confirmation and manual sync helper for Expo apps using `expo-updates`.

This package is intentionally small. It does not replace `expo-updates`. Update selection, manifest responses, asset URL delivery, fetching, and reloading are handled by Otalan plus the `expo-updates` runtime.

## What This Package Does

- exposes `initializeUpdater()` for current-update confirmation and manual sync
- reads the currently running Expo update metadata
- exposes `initialized.sync()` for manual check, fetch, and reload
- confirms eligible launched OTA updates with advisory transfer source metadata
- sends the OTA App Key through the `x-api-key` header on that confirm request

## What This Package Does Not Do

- it does not decide rollout eligibility
- it does not replace `expo-updates`

## What You Need

- an Expo app using `expo-updates`
- `expo-application` installed in the app
- a working Otalan `expo-updates` endpoint
- an Otalan OTA App Key
- the release channel used by your Expo update URL

## Supported Versions

This package officially supports Expo SDK 54, 55, and 56:

- Expo SDK 54
- Expo SDK 55
- Expo SDK 56

The package peer dependencies warn outside Expo SDK 54, 55, and 56 update runtimes. Other runtimes and older Expo SDK versions may work with package-manager overrides, but they are outside the official support range for the moment. We do not offer support for unsupported combinations and do not take responsibility for issues caused by using them.

## Install

You do not need Bun to use this package in your app.

Install the Otalan package with any package manager:

```bash
npm install @otalan/expo
```

```bash
pnpm add @otalan/expo
```

```bash
yarn add @otalan/expo
```

```bash
bun add @otalan/expo
```

Install Expo native modules with Expo's installer so their versions match your Expo SDK:

```bash
npx expo install expo-updates expo-application
```

## Configure `expo-updates`

Point `expo-updates` at your Otalan manifest endpoint, not `u.expo.dev`.

Example client environment variables:

```dotenv
EXPO_PUBLIC_OTALAN_API_URL=https://api.otalan.com
EXPO_PUBLIC_OTALAN_APP_KEY=otalan_ota_xxx
EXPO_PUBLIC_OTALAN_APP_ID=com.example.app
EXPO_PUBLIC_OTALAN_CHANNEL=production
```

Example `app.config.js`:

```js
const apiUrl = process.env.EXPO_PUBLIC_OTALAN_API_URL ?? 'https://api.otalan.com'
const appId = process.env.EXPO_PUBLIC_OTALAN_APP_ID ?? 'com.example.app'
const channel = process.env.EXPO_PUBLIC_OTALAN_CHANNEL ?? 'production'

export default {
  expo: {
    runtimeVersion: '1.0.0',
    updates: {
      enabled: true,
      url: `${apiUrl}/expo/updates?appId=${appId}&channel=${channel}`,
      requestHeaders: {
        'x-api-key': process.env.EXPO_PUBLIC_OTALAN_APP_KEY ?? '',
      },
      checkAutomatically: 'NEVER',
      fallbackToCacheTimeout: 0,
    },
  },
}
```

Your configured update service is still responsible for manifest responses and asset URLs. Manifests can include direct immutable CDN asset URLs.

`expo-updates` and the configured Otalan manifest endpoint own update selection and runtime compatibility. This helper can run the manual `expo-updates` check/fetch/reload flow through `initialized.sync()`, observes the already launched update metadata, and confirms it with the Otalan bundle ID from the manifest.

Set `checkAutomatically` to `NEVER` for Otalan staged rollouts so JS can attach the resolved device ID before `expo-updates` checks the server. Use an active native policy such as `ON_LOAD` or `WIFI_ONLY` only when rollout selection does not depend on SDK-managed runtime metadata.

Otalan protects Expo update checks with the OTA App Key. Include `x-api-key` or `authorization` on update checks so the manifest endpoint can authenticate the request and apply rollout and quota rules.

The OTA App Key can be embedded in mobile JS/TS bundles for update checks and install confirmations, but it is not a public identifier. OTA App Key values use the `otalan_ota_...` token format. Do not publish them in docs, issue trackers, logs, source control, or backend examples.

OTA Publish Key values use the `otalan_ci_...` token format and are for release automation only. Do not use OTA Publish Keys in app code.

Partial rollouts for Expo require a stable device ID on Otalan update checks. `@otalan/expo` creates and persists that ID, then writes it to Expo update extra params as `otalan-device-id` before checking for updates. App code does not need to know or set an Otalan device header.

`initialized.sync()` sets the OTA App Key request header before checking for updates. Expo requires runtime-overridden header keys to already be declared in `updates.requestHeaders` in native config.

## Quick Start

Create the updater when your app is ready to check for updates, then reuse it for later checks:

```ts
import { initializeUpdater, type InitializedExpoUpdater } from '@otalan/expo'

let updater: InitializedExpoUpdater | undefined

export async function syncOtalanUpdates() {
  if (!updater) {
    updater = await initializeUpdater({
      apiUrl: process.env.EXPO_PUBLIC_OTALAN_API_URL!,
      apiKey: process.env.EXPO_PUBLIC_OTALAN_APP_KEY!,
      appId: process.env.EXPO_PUBLIC_OTALAN_APP_ID!,
      channel: process.env.EXPO_PUBLIC_OTALAN_CHANNEL!,
    })
  }

  return updater.sync()
}
```

## Custom Device ID Storage

By default, `initializeUpdater()` creates and persists a stable `deviceId` with AsyncStorage.
On Android, it treats `Application.getAndroidId()` from `expo-application` as authoritative when
available, compares storage against that value, and updates storage when they differ. On iOS, it
uses `Application.getIosIdForVendorAsync()` when available, then falls back to the stored or
generated SDK ID when iOS returns `null` or the lookup fails.

If you want different storage, provide a custom adapter:

```ts
import * as SecureStore from 'expo-secure-store'
import { initializeUpdater } from '@otalan/expo'

await initializeUpdater({
  apiUrl: 'https://api.otalan.com',
  apiKey: 'otalan_ota_xxx',
  appId: 'com.example.app',
  channel: 'production',
  deviceIdStorage: {
    getItem: (key) => SecureStore.getItemAsync(key),
    setItem: (key, value) => SecureStore.setItemAsync(key, value),
  },
})
```

## Staged Rollouts

Use the configuration and `syncOtalanUpdates()` sample above when rollout eligibility depends on the SDK-managed device ID. `@otalan/expo` writes the resolved device ID to Expo update extra params at runtime before checking for updates, which lets the Otalan manifest endpoint apply staged rollout rules consistently.

## Update Flow

`@otalan/expo` imports `expo-updates` to read launch metadata such as `Updates.isEnabled`, `Updates.manifest`, `Updates.isEmbeddedLaunch`, `Updates.isEmergencyLaunch`, `Updates.runtimeVersion`, and `Updates.updateId`. The initialized helper's `sync()` method sets Otalan request context, then calls `Updates.checkForUpdateAsync()`, `Updates.fetchUpdateAsync()`, and `Updates.reloadAsync()`.

Unlike `@otalan/capacitor`, `@otalan/expo` does not expose an Otalan `onDownloadProgress` callback because the download is still owned by `expo-updates`. For Expo download UI, listen to `expo-updates` download state directly. In React components, `useUpdates().downloadProgress` reports progress from `0` to `1` while `useUpdates().isDownloading` is true.

If your app prefers callback-style progress handling, wrap the Expo state in app code:

```ts
import { useEffect } from 'react'
import { useUpdates } from 'expo-updates'

export function useExpoDownloadProgress(
  onProgress?: (progress: number) => void,
) {
  const { downloadProgress, isDownloading } = useUpdates()

  useEffect(() => {
    if (!isDownloading || typeof downloadProgress !== 'number') {
      return
    }

    onProgress?.(downloadProgress)
  }, [downloadProgress, isDownloading, onProgress])
}
```

This mirrors an `onProgress` callback for app UI, but it is still backed by `expo-updates` state rather than an Otalan-owned download event stream.

The helper delegates fetching and staging to `expo-updates`, so it cannot reliably prove whether the Expo runtime loaded a cached update or a freshly downloaded one. `@otalan/expo` sends `transferSource: "downloaded"` by default on confirmation, but this field is advisory client-reported metadata.

Unlike `@otalan/capacitor`, this package does not report `cached` confirmations. The Capacitor SDK controls the bundle download/staging flow and can ask the live-update plugin whether a bundle already exists on the device. The Expo helper only observes the currently launched update through `expo-updates`, so it cannot distinguish a cached launch from a freshly downloaded launch with enough confidence.

## Initialized Helper Behavior

When `enabled` is omitted, `initializeUpdater()`:

- creates the low-level helper
- starts `ready()` once in the background after setup
- creates and persists a stable `deviceId` unless you provide one
- prefers and persists the Android platform ID from `expo-application` when available
- uses the iOS vendor ID from `expo-application` when available
- exposes the resolved `deviceId` through `getDeviceId()`
- no-ops outside native iOS and Android
- no-ops when `expo-updates` is disabled
- no-ops when `apiUrl`, `apiKey`, or `channel` are missing
- logs device ID storage failures and returns a no-op updater when no explicit or platform ID is available
- swallows confirmation failures and logs warnings instead

Pass `enabled: false` to force a no-op. Pass `enabled: true` only when your app has its own runtime/config gate, because it bypasses the default `expo-updates` and required config checks. Native iOS and Android platform validation still applies. With `enabled: true`, missing or invalid `apiUrl`, `apiKey`, or `channel` values can produce confirmation warnings instead of the helper silently no-oping.

If the app logs `Otalan install confirmation failed.`, the failure happened during the confirmation request. The SDK logs a serializable `{ sdkName, sdkVersion, name, message }` error payload so native consoles can show the installed SDK version, HTTP status, API message, or fetch failure instead of an empty `{}`.

`initializeUpdater()` resolves after setup and does not wait for the confirmation request to finish. Call `initialized.ready()` if your app needs to await the current-update confirmation or retry it later.

## API

### `createUpdater(config)`

Config:

- `apiUrl`: Otalan API base URL
- `apiKey`: OTA App Key
- `appId`: app identifier
- `channel`: release channel
- `deviceId`: required stable device ID
- `requestTimeoutMs`: request timeout for Otalan API calls, defaults to `15000`
- `headers`: optional extra request headers
- `logger`: optional warning logger

Returns a low-level Expo updater:

- `getCurrentUpdate()`: returns `Promise<ExpoReadyResult>`
- `confirmCurrentUpdate()`: returns `Promise<ExpoReadyResult>`
- `ready()`: returns `Promise<ExpoReadyResult>`

### `await initializeUpdater(config)`

Config:

- everything from `createUpdater(config)` except `deviceId`, which becomes optional
- `deviceId`: optional explicit stable device ID override
- `deviceIdStorage`: optional async storage adapter with `getItem()` and `setItem()`
- `deviceIdStorageKey`: optional storage key, defaults to `otalan-device-id`
- `enabled`: optional explicit gate. Omit for default platform, `expo-updates`, and required config checks, pass `false` to force-disable, or pass `true` to force initialization and bypass default `expo-updates` and required config checks. Native platform validation still applies.
- `logger`: optional warning logger

Returns:

- `getDeviceId()`: resolves the stable device ID or `null` when no updater is enabled and no explicit ID was provided
- `getUpdater()`: returns the helper or `null`
- `ready()`: awaits current-update confirmation and returns `ExpoReadyResult | null`
- `sync()`: runs a deduplicated Expo update check, fetches an available update, reloads the app, and returns `Promise<boolean>`

### `await initialized.getDeviceId()`

Returns `Promise<string | null>`.

### `initialized.getUpdater()`

Returns the low-level updater from `createUpdater(config)`, or `null` when the initialized helper is disabled.

### `await initialized.ready()`

Runs current-update confirmation through the low-level updater.

Returns `Promise<ExpoReadyResult | null>`.

### `await initialized.sync()`

Sets the OTA App Key request header, writes the resolved Otalan device ID to Expo update extra params, then calls `Updates.checkForUpdateAsync()`, `Updates.fetchUpdateAsync()`, and `Updates.reloadAsync()`.

Returns `Promise<boolean>`. It resolves `true` when a fetched update or rollback triggers reload, and `false` when updates are disabled, no update is available, fetching reports no new update, or an Expo update API call fails. `false` results are logged with compact `expo-updates` state, including enabled status, launch flags, runtime version, update ID, platform, and skip/result reason.

### Package Metadata Exports

- `OTALAN_EXPO_SDK_NAME`: package name read from `@otalan/expo`'s `package.json`
- `OTALAN_EXPO_SDK_VERSION`: package version read from `@otalan/expo`'s `package.json`

These values are included in SDK warning logs.

### `await updater.getCurrentUpdate()`

Returns `Promise<ExpoReadyResult>`:

- `enabled`
- `confirmed`
- `isEmbeddedLaunch`
- `isEmergencyLaunch`
- `bundleId`
- `runtimeVersion`
- `transferSource` (experimental)
- `updateId`

### `await updater.confirmCurrentUpdate()`

Sends install confirmation for the currently running downloaded update.

Confirmed results include experimental `transferSource: "downloaded"` metadata.

By default this skips:

- non-native platforms
- disabled `expo-updates`
- emergency launches
- embedded launches
- launched updates without Otalan bundle metadata

### `await updater.ready()`

Alias for `confirmCurrentUpdate()` with warning logging fallback.

Returns `Promise<ExpoReadyResult>`. If confirmation fails, it logs a warning and returns the current update metadata.

### Result Types

`ExpoReadyResult`:

- `enabled`: whether `expo-updates` is active for this runtime
- `confirmed`: whether the current update was confirmed by this call
- `isEmbeddedLaunch`: whether the embedded app bundle is running
- `isEmergencyLaunch`: whether Expo launched in emergency mode
- `bundleId`: Otalan bundle ID from the running manifest when available
- `runtimeVersion`: current runtime version when available
- `transferSource`: experimental transfer metadata when confirmation succeeds
- `updateId`: current Expo update ID when available

## Network Behavior

The SDK sends the OTA App Key in `x-api-key` on confirmation requests. Otalan can count an update as served when the Expo manifest endpoint selects an update; install confirmations are a separate client-reported signal that the device successfully launched that bundle. Confirmations include the app identifier, platform, channel, Otalan bundle ID, runtime version, stable device ID, and `transferSource`. Confirmation requests time out after `requestTimeoutMs`, defaulting to 15 seconds.

`transferSource` is either `downloaded` or `cached` across Otalan mobile SDKs. This package always sends `downloaded` because it does not control update fetching and cannot confidently detect cached Expo launches. Treat this field as advisory client-reported metadata only.

Update manifest requests require the OTA App Key. Manifests can include direct immutable CDN asset URLs; `expo-updates` consumes those manifest-provided URLs and this SDK only confirms the launched update.

Asset requests do not depend on this SDK or SDK-provided request headers.

This SDK does not add SDK-side SHA verification for Expo assets. Asset integrity checks belong to the Expo runtime and manifest metadata; the server manifest must still provide the correct asset hash and key values.

Only active Otalan apps are eligible for Expo updates and install confirmations. If update traffic is unavailable for the app, `ready()` logs confirmation failures and returns the current update metadata.

## Notes

- `initializeUpdater()` will create and persist `deviceId` for you unless you override it
- use `getDeviceId()` when another part of your Expo update flow needs the same SDK-managed ID
- `apiKey` is the OTA App Key and is sent in `x-api-key`
- repeated and concurrent confirmation calls for the same launched update are skipped, including later app starts when AsyncStorage is available
- Expo confirmations use `downloaded` as the experimental transfer source metadata default
- apps must be active in Otalan to receive updates
- production API URL is usually `https://api.otalan.com`
- local development API URLs must be reachable from the native runtime. Physical devices usually need your machine's LAN IP, Android emulators usually need `10.0.2.2`, and plain HTTP may require platform cleartext/ATS development settings.
