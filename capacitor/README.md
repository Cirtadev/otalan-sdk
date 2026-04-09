# `@otalan/capacitor`

Otalan Capacitor SDK built on top of `@capawesome/capacitor-live-update`.

## Responsibility

This package is the real OTA client SDK for Capacitor apps.

It is responsible for:

- calling `POST /capacitor/check`
- deciding whether an update should be applied
- downloading bundles
- setting the next bundle
- reloading the app when needed
- confirming successful installs through `POST /capacitor/confirm`
- providing the one-call startup helper `initializeUpdater()`

Capacitor needs this orchestration layer because the underlying live-update plugin is low-level and does not implement the full Otalan flow by itself.

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
bun add @otalan/capacitor @capawesome/capacitor-live-update @capacitor/app @capacitor/core
```

## App Lifecycle Helper

```ts
import { initializeUpdater } from '@otalan/capacitor'

await initializeUpdater({
  apiUrl: 'https://api.otalan.com',
  apiKey: 'otalan_ota_xxx',
  channel: 'production',
  deviceId: 'stable-device-id',
  onResume: true,
})
```

This helper:

- no-ops when not running on native iOS/Android
- no-ops when `apiUrl` or `apiKey` are missing
- resolves `appId` from `App.getInfo()` unless you provide one
- runs a launch sync once
- optionally registers `App.addListener('resume', ...)`
- deduplicates concurrent sync calls and swallows sync failures

## Low-Level Usage

```ts
import { createUpdater } from '@otalan/capacitor'

const updater = createUpdater({
  apiUrl: 'https://api.otalan.com',
  apiKey: 'otalan_ota_xxx',
  appId: 'com.example.app',
  channel: 'production',
  deviceId: 'stable-device-id',
})

await updater.ready()
await updater.sync()
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
- `deviceId`: required stable device ID
- `autoConfirm`: defaults to `true`
- `reloadOnSync`: defaults to `true`
- `headers`: optional extra request headers
- `logger`: optional warning logger

### `await initializeUpdater(config)`

Opinionated startup helper for Capacitor apps.

Config:

- everything from `createUpdater(config)` except `appId`, which becomes optional
- `enabled`: optional explicit gate, otherwise native platform plus `apiUrl` and `apiKey`
- `onResume`: defaults to `true`
- `logger`: optional warning/info logger

Returns an object with:

- `getUpdater()`: resolves the underlying low-level updater or `null`
- `sync(trigger?)`: runs a deduplicated sync and returns `CapacitorSyncResult | null`

### `await updater.ready()`

Calls `LiveUpdate.ready()` and confirms the currently running bundle when possible.

`deviceId` is required because `POST /capacitor/confirm` expects it.

Use this early in app startup.

### `await updater.getCurrentBundleId()`

Returns the currently active bundle ID if one exists.

### `await updater.check()`

Calls `POST /capacitor/check` and returns the Otalan update response.

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

- This SDK expects Otalan to expose `POST /capacitor/check` and `POST /capacitor/confirm`.
- `POST /capacitor/confirm` currently requires `deviceId`.
- Partial rollouts require a stable device ID.
- Production API URL is `https://api.otalan.com`.
- Local development API URL is `http://localhost:8787`.
- The key used here must be the OTA app key.
