# `@otalan/expo`

Otalan Expo SDK built on top of `expo-updates`.

## What It Does

- checks Otalan before applying an update
- keeps track of pending and current Otalan bundle IDs
- avoids reapplying the same pending bundle
- reloads the app when needed
- confirms successful installs after the app comes back up
- calls `ready()` as part of the lifecycle

## Key Requirement

This SDK uses the **OTA app key**.

Do not use the CI key in the frontend app.

## Install

```bash
bun add @otalan/expo expo-updates react-native
```

## Important Constraint

Your app must already be configured correctly with `expo-updates`.

This SDK does not replace Expo's native update setup. It adds Otalan gating and bundle tracking around the Expo update flow.

## Basic Usage

```ts
import { createUpdater } from '@otalan/expo'

const updater = createUpdater({
  apiUrl: 'https://api.otalan.com',
  apiKey: 'otalan_ota_xxx',
  appId: 'com.example.app',
  channel: 'production',
})

await updater.sync()
```

## Recommended Startup Flow

```ts
import { AppState } from 'react-native'
import { createUpdater } from '@otalan/expo'

const updater = createUpdater({
  apiUrl: 'https://api.otalan.com',
  apiKey: 'otalan_ota_xxx',
  appId: 'com.example.app',
  channel: 'production',
})

await updater.ready()
await updater.sync()

AppState.addEventListener('change', async (state) => {
  if (state === 'active') {
    await updater.sync()
  }
})
```

## API

### `createUpdater(config)`

Creates an updater instance.

Config:

- `apiUrl`: Otalan API base URL
- `apiKey`: OTA app key
- `appId`: app identifier
- `channel`: target channel
- `runtimeVersion`: optional override, otherwise read from `expo-updates`
- `currentBundleId`: optional current Otalan bundle ID or async resolver used to seed confirmation on first run
- `deviceId`: optional stable device ID
- `autoConfirm`: defaults to `true`
- `reloadOnSync`: defaults to `true`
- `headers`: optional extra request headers
- `logger`: optional warning logger
- `storage`: optional persistence adapter for current and pending bundle IDs
- `storageKeyPrefix`: optional storage key namespace

### `await updater.ready()`

Marks a pending Otalan bundle as current after app restart and sends install confirmation when possible.

Call this during startup before `sync()`.

If the app may already be running an Otalan-managed bundle from an older integration, pass `currentBundleId` on first run so the SDK can seed the current bundle and confirm it once.

### `await updater.check()`

Calls `POST /otalan/check` with:

- `appId`
- `channel`
- `runtimeVersion`
- current Otalan bundle ID
- optional stable `deviceId`

### `await updater.sync()`

End-to-end update flow:

1. calls `ready()`
2. checks Otalan
3. skips if already current
4. reloads if the same bundle is already pending
5. runs `expo-updates` check/fetch flow
6. marks the fetched bundle as pending
7. reloads unless `reloadOnSync` is `false`

## Storage

The SDK stores two values:

- current bundle ID
- pending bundle ID

If you do not pass a storage adapter, the SDK falls back to in-memory storage. For real apps, pass persistent storage.

Example storage adapter:

```ts
import AsyncStorage from '@react-native-async-storage/async-storage'

const updater = createUpdater({
  apiUrl: 'https://api.otalan.com',
  apiKey: 'otalan_ota_xxx',
  appId: 'com.example.app',
  channel: 'production',
  storage: {
    getItem: (key) => AsyncStorage.getItem(key),
    setItem: (key, value) => AsyncStorage.setItem(key, value),
    removeItem: (key) => AsyncStorage.removeItem(key),
  },
})
```

Example first-run migration:

```ts
const updater = createUpdater({
  apiUrl: 'https://api.otalan.com',
  apiKey: 'otalan_ota_xxx',
  appId: 'com.example.app',
  channel: 'production',
  currentBundleId: async () => {
    return await AsyncStorage.getItem('legacy_otalan_bundle_id')
  },
  storage: {
    getItem: (key) => AsyncStorage.getItem(key),
    setItem: (key, value) => AsyncStorage.setItem(key, value),
    removeItem: (key) => AsyncStorage.removeItem(key),
  },
})
```

## Notes

- `runtimeVersion` must match.
- Partial rollouts require a stable device ID.
- Production API URL is `https://api.otalan.com`.
- Local development API URL is `http://localhost:8787`.
- The key used here must be the OTA app key.
