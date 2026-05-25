# `@otalan/expo`

Otalan startup confirmation helper for Expo apps using `expo-updates`.

This package is intentionally small. It does not replace `expo-updates`. Update selection, manifest responses, asset URL delivery, fetching, and reloading are handled by Otalan plus the `expo-updates` runtime.

## What This Package Does

- exposes `initializeUpdater()` for app startup
- reads the currently running Expo update metadata
- confirms eligible launched OTA updates with advisory transfer source metadata
- sends the OTA App Key through the `x-api-key` header on that confirm request

## What This Package Does Not Do

- it does not call the Expo update manifest endpoint
- it does not fetch updates
- it does not reload updates
- it does not decide rollout eligibility
- it does not replace `expo-updates`

## What You Need

- an Expo app using `expo-updates`
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

Install with any package manager:

```bash
npm install @otalan/expo expo-updates
```

```bash
pnpm add @otalan/expo expo-updates
```

```bash
yarn add @otalan/expo expo-updates
```

```bash
bun add @otalan/expo expo-updates
```

## Configure `expo-updates`

Point `expo-updates` at your Otalan manifest endpoint, not `u.expo.dev`.

Example `app.json` or `app.config.json`:

```json
{
  "expo": {
    "runtimeVersion": "1.0.0",
    "updates": {
      "enabled": true,
      "url": "https://api.otalan.com/expo/updates?appId=com.example.app&channel=production",
      "requestHeaders": {
        "x-api-key": "otalan_ota_xxx"
      },
      "checkAutomatically": "ON_LOAD",
      "fallbackToCacheTimeout": 0
    }
  }
}
```

Your configured update service is still responsible for manifest responses and asset URLs. Manifests can include direct immutable CDN asset URLs.

`expo-updates` and the configured Otalan manifest endpoint own update selection and runtime compatibility. This helper observes the already launched update metadata and confirms it with the Otalan bundle ID from the manifest; it does not fetch, stage, or independently verify Expo manifest compatibility.

Use `checkAutomatically` with an active update policy such as `ON_LOAD` or `WIFI_ONLY` when your rollout selection does not depend on runtime headers. If `x-device-id` is part of Expo update request headers, Android requires the value used for download to match the value in native config when the cached update is selected for launch.

Otalan protects Expo update checks with the OTA App Key. Include `x-api-key` or `authorization` on update checks so the manifest endpoint can authenticate the request and apply rollout and quota rules.

The OTA App Key can be embedded in mobile JS/TS bundles for update checks and install confirmations, but it is not a public identifier. OTA App Key values use the `otalan_ota_...` token format. Do not publish them in docs, issue trackers, logs, source control, or backend examples.

OTA Publish Key values use the `otalan_ci_...` token format and are for release automation only. Do not use OTA Publish Keys in app code.

Partial rollouts for Expo require a stable `x-device-id` header on update checks. For Android, that value must be available before the native app is built and must be reused consistently in:

- `updates.requestHeaders`
- `initializeUpdater({ deviceId })`
- `Updates.setUpdateRequestHeadersOverride()`

Do not use the SDK-managed AsyncStorage device ID as a runtime-only `x-device-id` override on Android. Android `expo-updates` can download an update with the overridden header and then refuse to relaunch it because the cached update no longer matches native config.

If you use `Updates.setUpdateRequestHeadersOverride()`, Expo requires every runtime-overridden header to already be declared in `updates.requestHeaders` in native config. For Android launch safety, the runtime override must not change the native `x-device-id` value.

Set `checkAutomatically` to `NEVER` for device-targeted rollouts that call `Updates.setUpdateRequestHeadersOverride()` from JS. `ON_LOAD` runs from the native update startup flow before app JS can call the override.

Minimal Android-safe staged-rollout config:

```js
const otalanDeviceId = process.env.EXPO_PUBLIC_OTALAN_DEVICE_ID

if (!otalanDeviceId) {
  throw new Error('EXPO_PUBLIC_OTALAN_DEVICE_ID is required when x-device-id is configured for expo-updates.')
}

export default {
  expo: {
    updates: {
      requestHeaders: {
        'x-api-key': process.env.EXPO_PUBLIC_OTALAN_API_KEY ?? '',
        'x-device-id': otalanDeviceId,
      },
      checkAutomatically: 'NEVER',
    },
  },
}
```

## Quick Start

Call `initializeUpdater()` once during app startup:

```ts
import { initializeUpdater } from '@otalan/expo'

const otalan = await initializeUpdater({
  apiUrl: 'https://api.otalan.com',
  apiKey: 'otalan_ota_xxx',
  appId: 'com.example.app',
  channel: 'production',
})

const deviceId = await otalan.getDeviceId()
```

## Expo Example

```ts
import { useCallback, useMemo, useState } from 'react'
import { initializeUpdater, type InitializedExpoUpdater } from '@otalan/expo'
import * as Updates from 'expo-updates'

let otalanPromise: Promise<InitializedExpoUpdater> | null = null

function getOtalanUpdater() {
  const deviceId = process.env.EXPO_PUBLIC_OTALAN_DEVICE_ID || undefined

  otalanPromise ??= initializeUpdater({
    apiUrl: process.env.EXPO_PUBLIC_OTALAN_API_URL ?? 'https://api.otalan.com',
    apiKey: process.env.EXPO_PUBLIC_OTALAN_API_KEY ?? '',
    appId: process.env.EXPO_PUBLIC_OTALAN_APP_ID ?? 'com.example.app',
    channel: process.env.EXPO_PUBLIC_OTALAN_CHANNEL ?? 'production',
    deviceId,
  })

  return otalanPromise
}

export function useOtalanUpdates() {
  const [isChecking, setIsChecking] = useState(false)
  const [status, setStatus] = useState<'idle' | 'skipped' | 'checking' | 'none' | 'reloading' | 'failed'>('idle')

  const canCheck = useMemo(() => Updates.isEnabled && !__DEV__ && Boolean(process.env.EXPO_PUBLIC_OTALAN_API_KEY), [])

  const checkForUpdate = useCallback(async () => {
    if (!canCheck || isChecking) {
      setStatus('skipped')
      return
    }

    setIsChecking(true)
    setStatus('checking')

    try {
      await getOtalanUpdater()

      const deviceId = process.env.EXPO_PUBLIC_OTALAN_DEVICE_ID

      if (deviceId) {
        Updates.setUpdateRequestHeadersOverride({
          'x-api-key': process.env.EXPO_PUBLIC_OTALAN_API_KEY ?? '',
          'x-device-id': deviceId,
        })
      }

      const update = await Updates.checkForUpdateAsync()

      if (!update.isAvailable) {
        setStatus('none')
        return
      }

      await Updates.fetchUpdateAsync()
      setStatus('reloading')
      await Updates.reloadAsync()
    } catch {
      setStatus('failed')
    } finally {
      setIsChecking(false)
    }
  }, [canCheck, isChecking])

  return {
    canCheck,
    isChecking,
    status,
    checkForUpdate,
  }
}
```

## Custom Device ID Storage

By default, `initializeUpdater()` creates and persists a stable `deviceId` with AsyncStorage.

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

## Staged Rollout Example

Use this shape when the rollout decision depends on `x-device-id`.

Declare the exact header value in native config before building the app:

```js
const otalanDeviceId = process.env.EXPO_PUBLIC_OTALAN_DEVICE_ID

if (!otalanDeviceId) {
  throw new Error('EXPO_PUBLIC_OTALAN_DEVICE_ID is required when x-device-id is configured for expo-updates.')
}

export default {
  expo: {
    runtimeVersion: '1.0.0',
    updates: {
      enabled: true,
      url: 'https://api.otalan.com/expo/updates?appId=com.example.app&channel=production',
      requestHeaders: {
        'x-api-key': process.env.EXPO_PUBLIC_OTALAN_API_KEY ?? '',
        'x-device-id': otalanDeviceId,
      },
      checkAutomatically: 'NEVER',
    },
  },
}
```

The `x-device-id` value must be the same value passed to `initializeUpdater({ deviceId })` and `Updates.setUpdateRequestHeadersOverride()`. For smoke tests, use a deterministic value such as `ota-smoke-com.example.app-android`. Do not configure native `x-device-id` as an empty placeholder on Android.

Use the same value at runtime:

```ts
import { initializeUpdater } from '@otalan/expo'
import * as Updates from 'expo-updates'

const otalanDeviceId = process.env.EXPO_PUBLIC_OTALAN_DEVICE_ID

if (!otalanDeviceId) {
  throw new Error('EXPO_PUBLIC_OTALAN_DEVICE_ID is required when x-device-id is configured for expo-updates.')
}

await initializeUpdater({
  apiUrl: process.env.EXPO_PUBLIC_OTALAN_API_URL ?? 'https://api.otalan.com',
  apiKey: process.env.EXPO_PUBLIC_OTALAN_API_KEY ?? '',
  appId: process.env.EXPO_PUBLIC_OTALAN_APP_ID ?? 'com.example.app',
  channel: process.env.EXPO_PUBLIC_OTALAN_CHANNEL ?? 'production',
  deviceId: otalanDeviceId,
})

Updates.setUpdateRequestHeadersOverride({
  'x-api-key': process.env.EXPO_PUBLIC_OTALAN_API_KEY ?? '',
  'x-device-id': otalanDeviceId,
})
```

Because Expo native config is static for a given build, this pattern is best for smoke tests, device-specific builds, or deterministic cohort headers. If your only per-install device ID is generated after app startup, use rollout rules that do not depend on `x-device-id` on Android.

`checkAutomatically: "NEVER"` is intentional when JS calls `Updates.setUpdateRequestHeadersOverride()` before `Updates.checkForUpdateAsync()`.

## Update Flow

Use `expo-updates` directly for check, fetch, and reload:

```ts
import * as Updates from 'expo-updates'

const update = await Updates.checkForUpdateAsync()

if (update.isAvailable) {
  await Updates.fetchUpdateAsync()
  await Updates.reloadAsync()
}
```

`@otalan/expo` imports `expo-updates`, but it only reads launch metadata such as `Updates.isEnabled`, `Updates.manifest`, `Updates.isEmbeddedLaunch`, `Updates.isEmergencyLaunch`, `Updates.runtimeVersion`, and `Updates.updateId`. It does not call `Updates.checkForUpdateAsync()`, `Updates.fetchUpdateAsync()`, or `Updates.reloadAsync()`.

Unlike `@otalan/capacitor`, `@otalan/expo` does not expose an Otalan `onDownloadProgress` callback because this helper does not own the update download. For Expo download UI, listen to `expo-updates` download state directly. In React components, `useUpdates().downloadProgress` reports progress from `0` to `1` while `useUpdates().isDownloading` is true.

The helper does not fetch or stage Expo updates itself, so it cannot reliably prove whether the Expo runtime loaded a cached update or a freshly downloaded one. `@otalan/expo` sends `transferSource: "downloaded"` by default on confirmation, but this field is advisory client-reported metadata.

Unlike `@otalan/capacitor`, this package does not report `cached` confirmations. The Capacitor SDK controls the bundle download/staging flow and can ask the live-update plugin whether a bundle already exists on the device. The Expo helper only observes the currently launched update through `expo-updates`, so it cannot distinguish a cached launch from a freshly downloaded launch with enough confidence.

## Startup Helper Behavior

When `enabled` is omitted, `initializeUpdater()`:

- creates the low-level helper
- starts `ready()` once in the background during startup
- creates and persists a stable `deviceId` unless you provide one
- exposes the resolved `deviceId` through `getDeviceId()`
- no-ops outside native iOS and Android
- no-ops when `expo-updates` is disabled
- no-ops when `apiUrl`, `apiKey`, or `channel` are missing
- logs device ID storage failures and returns a no-op updater
- swallows confirmation failures and logs warnings instead

Pass `enabled: false` to force a no-op. Pass `enabled: true` only when your app has its own runtime/config gate, because it bypasses the default `expo-updates` and required config checks. Native iOS and Android platform validation still applies. With `enabled: true`, missing or invalid `apiUrl`, `apiKey`, or `channel` values can produce startup confirmation warnings instead of the helper silently no-oping.

If startup logs `Otalan install confirmation failed.`, the failure happened during the confirmation request. The SDK logs a serializable `{ sdkName, sdkVersion, name, message }` error payload so native consoles can show the installed SDK version, HTTP status, API message, or fetch failure instead of an empty `{}`.

`initializeUpdater()` resolves after setup and does not wait for the confirmation request to finish. Call `initialized.ready()` if your app needs to await the current startup confirmation or retry it later.

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
- `ready()`: awaits the startup confirmation helper and returns `ExpoReadyResult | null`

### `await initialized.getDeviceId()`

Returns `Promise<string | null>`.

### `initialized.getUpdater()`

Returns the low-level updater from `createUpdater(config)`, or `null` when the startup helper is disabled.

### `await initialized.ready()`

Runs startup confirmation through the low-level updater.

Returns `Promise<ExpoReadyResult | null>`.

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
