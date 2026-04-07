# `@otalan/capacitor`

Otalan Capacitor SDK built on top of `@capawesome/capacitor-live-update`.

## What It Does

- checks Otalan for an available update
- avoids re-downloading bundles that already exist
- sets the next bundle
- reloads the app when needed
- confirms successful installs
- calls `ready()` so rollback protection behaves correctly

## Key Requirement

This SDK uses the **OTA app key**.

Do not use the CI key in the frontend app.

## Install

```bash
bun add @otalan/capacitor @capawesome/capacitor-live-update @capacitor/core
```

## Basic Usage

```ts
import { createUpdater } from '@otalan/capacitor'

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
import { App } from '@capacitor/app'
import { createUpdater } from '@otalan/capacitor'

const updater = createUpdater({
  apiUrl: 'https://api.otalan.com',
  apiKey: 'otalan_ota_xxx',
  appId: 'com.example.app',
  channel: 'production',
})

await updater.ready()
await updater.sync()

App.addListener('resume', async () => {
  await updater.sync()
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
- `nativeVersion`: optional override, otherwise read from Live Update
- `platform`: optional override
- `deviceId`: optional stable device ID override
- `autoConfirm`: defaults to `true`
- `reloadOnSync`: defaults to `true`
- `headers`: optional extra request headers
- `logger`: optional warning logger

### `await updater.ready()`

Calls `LiveUpdate.ready()` and confirms the currently running bundle when possible.

Use this early in app startup.

### `await updater.getCurrentBundleId()`

Returns the currently active bundle ID if one exists.

### `await updater.check()`

Calls `POST /otalan/check` and returns the Otalan update response.

### `await updater.sync()`

End-to-end update flow:

1. calls `ready()`
2. checks Otalan
3. skips if already current
4. reloads immediately if the bundle is already set as next
5. downloads only when needed
6. sets next bundle
7. reloads the app unless `reloadOnSync` is `false`

## Behavior

Current handled cases:

- already on the current bundle
- target bundle already downloaded
- target bundle already set as the next bundle
- install confirmation on app startup after `ready()`

## Notes

- This SDK expects your backend to expose the Otalan OTA endpoints.
- Partial rollouts require a stable device ID.
- Production API URL is `https://api.otalan.com`.
- Local development API URL is `http://localhost:8787`.
- The key used here must be the OTA app key.
