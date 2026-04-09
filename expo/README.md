# `@otalan/expo`

Tiny Otalan helper for Expo and bare React Native apps using `expo-updates`.

## Responsibility

This package is intentionally small.

It is responsible for:

- exposing a small startup helper through `initializeUpdater()`
- reading the currently running Expo update metadata
- optionally confirming a successfully launched OTA update through `POST /expo/confirm`
- sending the public OTA app key through the `x-api-key` header on that confirm request

It is not the OTA client runtime. Update selection, manifest generation, asset downloads, fetch, and apply belong to Otalan `/expo/updates` plus `/expo/assets/...` and the `expo-updates` runtime.

## What It Does

- confirms a successfully launched OTA update to Otalan
- exposes a small `ready()` helper for app startup
- no-ops when `expo-updates` is disabled or the app is not running on native iOS/Android

## What It Does Not Do

- it does not select updates
- it does not call `/expo/updates` itself
- it does not fetch or reload updates
- it does not replace `expo-updates`

Otalan must expose an `expo-updates` compatible endpoint for update selection and manifests, plus assets.

Typical backend shape:

- `/updates`: selection + manifest response
- `/assets/...`: asset hosting
- optional `/expo/confirm`: install success tracking

## Install

```bash
bun add @otalan/expo expo-updates react-native
```

## Expo Config

Point `expo-updates` at the Otalan updates endpoint, not `u.expo.dev`.

Example:

```json
{
  "expo": {
    "updates": {
      "enabled": true,
      "url": "https://api.otalan.com/expo/updates?appId=com.example.app&channel=production",
      "requestHeaders": {
        "x-api-key": "otalan_ota_xxx"
      },
      "checkAutomatically": "NEVER",
      "fallbackToCacheTimeout": 0
    }
  }
}
```

Use the real Otalan `expo-updates` endpoint.

For Otalan, that means the exact Expo manifest URL plus the public OTA app key in `updates.requestHeaders.x-api-key`.

## Startup Helper

Call the helper once during app startup so a downloaded update can be confirmed after launch.

```ts
import { initializeUpdater } from '@otalan/expo'

await initializeUpdater({
  apiUrl: 'https://api.otalan.com',
  apiKey: 'otalan_ota_xxx',
  appId: 'com.example.app',
  deviceId: 'stable-device-id',
})
```

This helper:

- creates the low-level updater
- calls `ready()` once
- requires `deviceId` because `POST /expo/confirm` expects it
- swallows confirmation failures

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

## API

### `createUpdater(config)`

Creates a tiny updater helper.

Config:

- `apiUrl`: Otalan API base URL
- `apiKey`: public OTA app key, sent as `x-api-key`
- `appId`: app identifier
- `autoConfirm`: defaults to `true`
- `deviceId`: required stable device ID
- `headers`: optional extra request headers
- `logger`: optional warning logger

### `await initializeUpdater(config)`

Opinionated startup helper.

Config:

- everything from `createUpdater(config)`
- `enabled`: optional explicit gate, otherwise `expo-updates` enabled plus native platform plus `apiUrl` and `apiKey`
- `logger`: optional warning logger

Returns an object with:

- `getUpdater()`: returns the underlying helper or `null`
- `ready()`: runs the startup confirmation flow and returns `ExpoReadyResult | null`

### `await updater.getCurrentUpdate()`

Returns the currently running update metadata from `expo-updates`.

Return shape:

- `enabled`
- `confirmed`
- `isEmbeddedLaunch`
- `isEmergencyLaunch`
- `runtimeVersion`
- `updateId`

### `await updater.confirmCurrentUpdate()`

Calls `POST /expo/confirm` for the currently running downloaded update.

By default this skips:

- non-native platforms
- disabled `expo-updates`
- embedded launches
- launches with no `updateId`

Payload:

- `x-api-key` header with the public OTA app key
- `appId`
- `platform`
- `updateId`
- `runtimeVersion`
- `deviceId`

### `await updater.ready()`

Alias for `confirmCurrentUpdate()` with warning logging fallback.

Use this once during startup.

## Notes

- `apiUrl` is the Otalan API, for example `https://api.otalan.com`.
- `updates.url` is the Otalan `expo-updates` manifest endpoint. It may be the same domain, but it is a different concern.
- This SDK only needs `POST /expo/confirm` on the backend side.
- `POST /expo/confirm` currently requires `deviceId`.
- `apiKey` here is the public OTA app key and is sent in `x-api-key`.
- Production API URL is `https://api.otalan.com`.
- The key used here must be the OTA app key.
