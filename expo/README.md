# `@otalan/expo`

Otalan startup confirmation helper for Expo and bare React Native apps using `expo-updates`.

This package is intentionally small. It does not replace `expo-updates`. Otalan update selection, manifest responses, authenticated asset delivery, fetching, and reloading still belong to your Otalan backend plus the `expo-updates` runtime.

## What This Package Does

- exposes `initializeUpdater()` for app startup
- reads the currently running Expo update metadata
- optionally confirms a launched OTA update through `POST /expo/confirm` with transfer source
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

Use `checkAutomatically` with an active update policy such as `ON_LOAD` or `ALWAYS`.

Otalan protects Expo asset URLs with the same OTA API key. Include `x-api-key` or `authorization` on the `/expo/updates` request; the manifest response will pass the matching `assetRequestHeaders` to the Expo runtime for `/expo/assets/...` downloads.

Partial rollouts for Expo require a stable `x-device-id` header on update checks. Static config alone is not enough for that. If you need Expo staged rollouts, create or load the stable ID in your app, pass it as `deviceId` to `initializeUpdater()`, and wire that same value into your `expo-updates` request headers before calling `Updates.checkForUpdateAsync()`.

## Quick Start

Call `initializeUpdater()` once during app startup:

```ts
import { initializeUpdater } from '@otalan/expo'

await initializeUpdater({
  apiUrl: 'https://api.otalan.com',
  apiKey: 'otalan_ota_xxx',
  appId: 'com.example.app',
})
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

The helper does not fetch or stage Expo updates itself, so it cannot reliably prove whether the Expo runtime loaded a cached update or a freshly downloaded one. For billing, analytics, and limits, `@otalan/expo` sends `transferSource: "downloaded"` by default on confirmation. This is the conservative source for Expo and bare React Native because cached-source detection is not available in this helper.

## Startup Helper Behavior

`initializeUpdater()`:

- creates the low-level helper
- runs `ready()` once during startup
- creates and persists a stable `deviceId` unless you provide one
- no-ops outside native iOS and Android
- no-ops when `expo-updates` is disabled
- swallows confirmation failures and logs warnings instead

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

### `await initializeUpdater(config)`

Config:

- everything from `createUpdater(config)` except `deviceId`, which becomes optional
- `deviceId`: optional explicit stable device ID override
- `deviceIdStorage`: optional async storage adapter with `getItem()` and `setItem()`
- `deviceIdStorageKey`: optional storage key, defaults to `otalan-device-id`
- `enabled`: optional explicit gate
- `logger`: optional warning logger

Returns:

- `getUpdater()`: returns the helper or `null`
- `ready()`: runs startup confirmation and returns `ExpoReadyResult | null`

### `await updater.getCurrentUpdate()`

Returns:

- `enabled`
- `confirmed`
- `isEmbeddedLaunch`
- `isEmergencyLaunch`
- `runtimeVersion`
- `transferSource`
- `updateId`

### `await updater.confirmCurrentUpdate()`

Calls `POST /expo/confirm` for the currently running downloaded update.

Confirmed results include `transferSource: "downloaded"`.

By default this skips:

- non-native platforms
- disabled `expo-updates`
- emergency launches
- embedded launches
- launches with no `updateId`

### `await updater.ready()`

Alias for `confirmCurrentUpdate()` with warning logging fallback.

## Backend Contract

The backend must expose:

- an `expo-updates` compatible manifest endpoint
- authenticated asset routes referenced by that manifest
- optional `POST /expo/confirm`

`POST /expo/confirm` requires `deviceId` and `transferSource`.

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

`transferSource` is either `downloaded` or `cached` across Otalan mobile SDKs. This package always sends `downloaded` because it does not control update fetching and cannot confidently detect cached Expo launches. Keep confirmation processing idempotent per app, device, and update so retries do not double count usage.

Asset requests require the project OTA API key. Otalan's manifest response supplies `assetRequestHeaders` when the update request includes `x-api-key` or `authorization`.

Only active, non-archived Otalan apps are eligible for Expo updates and install confirmations. Archived apps return API errors until they are restored; `ready()` logs confirmation failures and returns the current update metadata.

## Notes

- `initializeUpdater()` will create and persist `deviceId` for you unless you override it
- `apiKey` is the public OTA app key and is sent in `x-api-key`
- repeated confirmation calls for the same launched update are skipped
- Expo and bare React Native confirmations use `downloaded` as the transfer source default
- archived apps do not receive updates until they are restored in Otalan
- production API URL is usually `https://api.otalan.com`
