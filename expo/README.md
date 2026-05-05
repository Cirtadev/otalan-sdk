# `@otalan/expo`

Otalan startup confirmation helper for Expo and bare React Native apps using `expo-updates`.

This package is intentionally small. It does not replace `expo-updates`. Otalan update selection, manifest responses, authenticated asset delivery, fetching, and reloading still belong to your Otalan backend plus the `expo-updates` runtime.

## What This Package Does

- exposes `initializeUpdater()` for app startup
- reads the currently running Expo update metadata
- confirms eligible launched OTA updates through `POST /expo/confirm` with experimental transfer source metadata
- sends the OTA app key through the `x-api-key` header on that confirm request

## What This Package Does Not Do

- it does not call `/expo/updates`
- it does not fetch updates
- it does not reload updates
- it does not decide rollout eligibility
- it does not replace `expo-updates`

## What You Need

- an Expo app or bare React Native app using `expo-updates`
- a working Otalan `expo-updates` endpoint
- an Otalan OTA app key

## Supported Versions

This package supports Expo SDK 54 and 55:

- Expo SDK 54 through `expo-updates >=29.0.0 <30`
- Expo SDK 55 through `expo-updates >=55.0.0 <56`
- bare React Native 0.84 and 0.85 with a compatible `expo-updates` setup

The `react-native` peer dependency also accepts the React Native versions bundled by supported Expo SDKs: React Native 0.81 for Expo SDK 54 and React Native 0.83 for Expo SDK 55. Those versions are accepted for Expo apps only; bare React Native support is limited to React Native 0.84 and 0.85.

Older versions may work, but they are outside the supported range. We do not offer support for unsupported versions and do not take responsibility for issues caused by using them.

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

Your backend is still responsible for manifest responses and authenticated asset delivery.

Use `checkAutomatically` with an active update policy such as `ON_LOAD` or `ALWAYS` when your rollout selection does not depend on runtime headers. For staged rollouts that need a runtime `x-device-id`, use manual checks so JS can set the real header first.

Otalan protects Expo asset URLs with the same OTA API key. Include `x-api-key` or `authorization` on the `/expo/updates` request; the manifest response will pass the matching `assetRequestHeaders` to the Expo runtime for `/expo/assets/...` downloads.

Partial rollouts for Expo require a stable `x-device-id` header on update checks. Static config alone is not enough for that. If you need Expo staged rollouts, either pass your own stable `deviceId` to `initializeUpdater()` or read the SDK-managed value with `getDeviceId()`, then wire that same value into your `expo-updates` request headers before calling `Updates.checkForUpdateAsync()`.

If you use `Updates.setUpdateRequestHeadersOverride()`, Expo requires every runtime-overridden header to already be declared in `updates.requestHeaders` in native config. For staged rollouts, declare `x-device-id` there and use manual checks when you need JS to set the real device ID before checking for updates.

## Quick Start

Call `initializeUpdater()` once during app startup:

```ts
import { initializeUpdater } from '@otalan/expo'

const otalan = await initializeUpdater({
  apiUrl: 'https://api.otalan.com',
  apiKey: 'otalan_ota_xxx',
  appId: 'com.example.app',
})

const deviceId = await otalan.getDeviceId()
```

## Expo Example

```ts
import { useEffect } from 'react'
import { Text, View } from 'react-native'
import { initializeUpdater } from '@otalan/expo'

export default function App() {
  useEffect(() => {
    void initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
    })
  }, [])

  return (
    <View>
      <Text>Otalan Expo app</Text>
    </View>
  )
}
```

## Bare React Native Example

The same helper works in bare React Native as long as `expo-updates` is installed and configured:

```ts
import { useEffect } from 'react'
import { initializeUpdater } from '@otalan/expo'

export function App() {
  useEffect(() => {
    void initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
    })
  }, [])

  return null
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
  deviceIdStorage: {
    getItem: (key) => SecureStore.getItemAsync(key),
    setItem: (key, value) => SecureStore.setItemAsync(key, value),
  },
})
```

## Staged Rollout Example

Use this shape when the rollout decision depends on `x-device-id`.

Declare the header in native config before building the app:

```json
{
  "expo": {
    "updates": {
      "requestHeaders": {
        "x-api-key": "otalan_ota_xxx",
        "x-device-id": ""
      },
      "checkAutomatically": "NEVER"
    }
  }
}
```

```ts
import * as Updates from 'expo-updates'
import { initializeUpdater } from '@otalan/expo'

export async function startOtalanUpdates() {
  const otalan = await initializeUpdater({
    apiUrl: 'https://api.otalan.com',
    apiKey: 'otalan_ota_xxx',
    appId: 'com.example.app',
  })

  const deviceId = await otalan.getDeviceId()
  if (!deviceId) {
    return otalan
  }

  Updates.setUpdateRequestHeadersOverride({
    'x-api-key': 'otalan_ota_xxx',
    'x-device-id': deviceId,
  })

  const update = await Updates.checkForUpdateAsync()
  if (update.isAvailable) {
    await Updates.fetchUpdateAsync()
    await Updates.reloadAsync()
  }

  return otalan
}
```

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

The helper does not fetch or stage Expo updates itself, so it cannot reliably prove whether the Expo runtime loaded a cached update or a freshly downloaded one. `@otalan/expo` sends `transferSource: "downloaded"` by default on confirmation, but this field is experimental client-reported metadata. The API must not use it for billing, transfer limits, quotas, or free-transfer decisions.

Unlike `@otalan/capacitor`, this package does not report `cached` confirmations. The Capacitor SDK controls the bundle download/staging flow and can ask the live-update plugin whether a bundle already exists on the device. The Expo helper only observes the currently launched update through `expo-updates`, so it cannot distinguish a cached launch from a freshly downloaded launch with enough confidence.

## Startup Helper Behavior

`initializeUpdater()`:

- creates the low-level helper
- runs `ready()` once during startup
- creates and persists a stable `deviceId` unless you provide one
- exposes the resolved `deviceId` through `getDeviceId()`
- no-ops outside native iOS and Android
- no-ops when `expo-updates` is disabled
- no-ops when `apiUrl` or `apiKey` are missing
- logs device ID storage failures and returns a no-op updater
- swallows confirmation failures and logs warnings instead

If startup logs `Otalan install confirmation failed.`, the failure happened during `POST /expo/confirm`. The SDK logs a serializable `{ sdkName, sdkVersion, name, message }` error payload so native consoles can show the installed SDK version, HTTP status, API message, or fetch failure instead of an empty `{}`.

## API

### `createUpdater(config)`

Config:

- `apiUrl`: Otalan API base URL
- `apiKey`: public OTA app key
- `appId`: app identifier
- `autoConfirm`: defaults to `true`
- `deviceId`: required stable device ID
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
- `enabled`: optional explicit gate
- `logger`: optional warning logger

Returns:

- `getDeviceId()`: resolves the stable device ID or `null` when no updater is enabled and no explicit ID was provided
- `getUpdater()`: returns the helper or `null`
- `ready()`: runs startup confirmation and returns `ExpoReadyResult | null`

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
- `runtimeVersion`
- `transferSource` (experimental)
- `updateId`

### `await updater.confirmCurrentUpdate()`

Calls `POST /expo/confirm` for the currently running downloaded update.

Confirmed results include experimental `transferSource: "downloaded"` metadata.

By default this skips:

- non-native platforms
- disabled `expo-updates`
- emergency launches
- embedded launches
- launches with no `updateId`

### `await updater.ready()`

Alias for `confirmCurrentUpdate()` with warning logging fallback.

Returns `Promise<ExpoReadyResult>`. If confirmation fails, it logs a warning and returns the current update metadata.

### Result Types

`ExpoReadyResult`:

- `enabled`: whether `expo-updates` is active for this runtime
- `confirmed`: whether the current update was confirmed by this call
- `isEmbeddedLaunch`: whether the embedded app bundle is running
- `isEmergencyLaunch`: whether Expo launched in emergency mode
- `runtimeVersion`: current runtime version when available
- `transferSource`: experimental transfer metadata when confirmation succeeds
- `updateId`: current Expo update ID when available

## Backend Contract

The backend must expose:

- an `expo-updates` compatible manifest endpoint
- authenticated asset routes referenced by that manifest
- `POST /expo/confirm` when confirmation tracking is enabled

`POST /expo/confirm` requires `deviceId` and still accepts `transferSource` as experimental metadata.

The SDK calls `POST /expo/confirm` by default for eligible launched OTA updates. If you do not expose this endpoint, disable confirmation with `autoConfirm: false` or expect warning logs and missing confirmation analytics.

Confirm payload:

```json
{
  "appId": "com.example.app",
  "platform": "ios",
  "updateId": "update-123",
  "runtimeVersion": "1.0.0",
  "deviceId": "device-1",
  "transferSource": "downloaded"
}
```

`transferSource` is either `downloaded` or `cached` across Otalan mobile SDKs. This package always sends `downloaded` because it does not control update fetching and cannot confidently detect cached Expo launches. Treat this field as experimental client-reported metadata only. Keep confirmation processing idempotent per app, device, and update so retries do not double count usage.

Asset requests require the project OTA API key. Otalan's manifest response supplies `assetRequestHeaders` when the update request includes `x-api-key` or `authorization`.

Only active, non-archived Otalan apps are eligible for Expo updates and install confirmations. Archived apps return API errors until they are restored; `ready()` logs confirmation failures and returns the current update metadata.

## Notes

- `initializeUpdater()` will create and persist `deviceId` for you unless you override it
- use `getDeviceId()` when another part of your Expo update flow needs the same SDK-managed ID
- `apiKey` is the public OTA app key and is sent in `x-api-key`
- repeated and concurrent confirmation calls for the same launched update are skipped
- Expo and bare React Native confirmations use `downloaded` as the experimental transfer source metadata default
- archived apps do not receive updates until they are restored in Otalan
- production API URL is usually `https://api.otalan.com`
- local development API URLs must be reachable from the native runtime. Physical devices usually need your machine's LAN IP, Android emulators usually need `10.0.2.2`, and plain HTTP may require platform cleartext/ATS development settings.
