# `@otalan/capacitor`

Otalan OTA client SDK for Capacitor apps.

This package is the full client-side orchestration layer for Otalan on Capacitor. It checks for updates, downloads bundles, stages the next bundle, reloads when needed, and confirms successful installs.

## What This Package Does

- calls `POST /capacitor/check`
- decides whether a bundle should be applied
- downloads bundles through `@capawesome/capacitor-live-update`
- sets the next bundle
- reloads the app when needed
- confirms successful installs through `POST /capacitor/confirm`
- provides a startup helper through `initializeUpdater()`

## What You Need

- a Capacitor app
- `@capawesome/capacitor-live-update`
- `@capacitor/app`
- `@capacitor/core`
- an Otalan OTA app key
- a stable device ID

Use the OTA app key in the app. Do not use a CI key in frontend code.

## Install

You do not need Bun to use this package in your app.

Install with any package manager:

```bash
npm install @otalan/capacitor @capawesome/capacitor-live-update @capacitor/app @capacitor/core
```

```bash
pnpm add @otalan/capacitor @capawesome/capacitor-live-update @capacitor/app @capacitor/core
```

```bash
yarn add @otalan/capacitor @capawesome/capacitor-live-update @capacitor/app @capacitor/core
```

```bash
bun add @otalan/capacitor @capawesome/capacitor-live-update @capacitor/app @capacitor/core
```

## Quick Start

Call `initializeUpdater()` once during app startup:

```ts
import { initializeUpdater } from '@otalan/capacitor'

async function getStableDeviceId() {
  return loadOrCreateStableDeviceId()
}

await initializeUpdater({
  apiUrl: 'https://api.otalan.com',
  apiKey: 'otalan_ota_xxx',
  channel: 'production',
  deviceId: await getStableDeviceId(),
  onResume: true,
})
```

## Capacitor Example

```ts
// src/ota.ts
import { initializeUpdater } from '@otalan/capacitor'

async function getStableDeviceId() {
  return loadOrCreateStableDeviceId()
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export async function startOtalanUpdater() {
  return initializeUpdater({
    apiUrl: 'https://api.otalan.com',
    apiKey: 'otalan_ota_xxx',
    channel: 'production',
    deviceId: await getStableDeviceId(),
    onResume: true,
  })
}
```

```ts
// src/main.ts
import { startOtalanUpdater } from './ota'

void startOtalanUpdater()
```

The `deviceId` must stay stable across launches. Otalan uses it for confirmation and rollout targeting.

## Low-Level Usage

If you want to control the flow yourself, use `createUpdater()`:

```ts
import { createUpdater } from '@otalan/capacitor'

const updater = createUpdater({
  apiUrl: 'https://api.otalan.com',
  apiKey: 'otalan_ota_xxx',
  appId: 'com.example.app',
  channel: 'production',
  deviceId: await loadOrCreateStableDeviceId(),
})

await updater.ready()
await updater.sync()
```

## Startup Helper Behavior

`initializeUpdater()`:

- no-ops outside native iOS and Android
- no-ops when `apiUrl` or `apiKey` are missing
- resolves `appId` from `App.getInfo()` unless you provide one
- runs one launch sync
- can register a resume listener
- deduplicates concurrent sync calls
- swallows sync failures and logs warnings instead

## API

### `createUpdater(config)`

Config:

- `apiUrl`: Otalan API base URL
- `apiKey`: OTA app key
- `appId`: app identifier
- `channel`: release channel
- `nativeVersion`: optional native version override
- `platform`: optional platform override
- `deviceId`: required stable device ID
- `autoConfirm`: defaults to `true`
- `reloadOnSync`: defaults to `true`
- `headers`: optional extra request headers
- `logger`: optional warning logger

### `await initializeUpdater(config)`

Config:

- everything from `createUpdater(config)` except `appId`, which becomes optional
- `enabled`: optional explicit gate
- `onResume`: defaults to `true`
- `logger`: optional warning and info logger

Returns:

- `getUpdater()`: resolves the low-level updater or `null`
- `sync(trigger?)`: runs a deduplicated sync and returns `CapacitorSyncResult | null`

### `await updater.ready()`

Calls `LiveUpdate.ready()` and confirms the currently running bundle when possible.

### `await updater.getCurrentBundleId()`

Returns the active bundle ID when one exists.

### `await updater.check()`

Calls `POST /capacitor/check`.

### `await updater.sync()`

Runs the full Otalan update flow:

1. calls `ready()`
2. checks Otalan
3. skips if already current
4. reloads immediately if the target bundle is already staged
5. downloads only when needed
6. stages the next bundle
7. reloads unless `reloadOnSync` is `false`

## Backend Contract

The backend must expose:

- `POST /capacitor/check`
- `POST /capacitor/confirm`

`POST /capacitor/confirm` currently requires `deviceId`.

## Notes

- repeated confirmation calls for the same installed bundle are skipped
- partial rollouts require a stable device ID
- production API URL is usually `https://api.otalan.com`
- local development API URL is usually `http://localhost:8787`
