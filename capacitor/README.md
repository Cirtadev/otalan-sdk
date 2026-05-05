# `@otalan/capacitor`

Otalan OTA client SDK for Capacitor apps.

This package is the full client-side orchestration layer for Otalan on Capacitor. It checks for updates, downloads bundles, stages the next bundle, reloads when needed, and confirms successful installs.

## What This Package Does

- calls `POST /capacitor/check`
- decides whether a bundle should be applied
- downloads bundles through `@capawesome/capacitor-live-update`
- sets the next bundle
- reloads the app when needed
- confirms successful installs through `POST /capacitor/confirm` with experimental bundle transfer source metadata
- provides a startup helper through `initializeUpdater()`

The SDK uses Capacitor's native HTTP transport for Otalan API calls on iOS and Android, with browser `fetch()` kept as the non-native fallback.

## What You Need

- a Capacitor app
- `@capawesome/capacitor-live-update`
- `@capacitor/app`
- `@capacitor/core`
- an Otalan OTA app key
- a stable device ID, or let `initializeUpdater()` create one

Use the OTA app key in the app. Do not use a CI key in frontend code.

## Supported Versions

This package supports Capacitor 7 and 8:

- `@capacitor/core >=7.0.0 <9`
- `@capacitor/app >=7.0.0 <9`
- `@capawesome/capacitor-live-update >=7.0.0 <9`

Use the matching Capawesome Live Update major for your Capacitor major:

- Capacitor 7 with `@capawesome/capacitor-live-update` 7.x
- Capacitor 8 with `@capawesome/capacitor-live-update` 8.x

Capacitor 8 is the current upstream major. Capacitor 7 is included for the upstream maintenance window. Capacitor 6 is not in the public support range because it is no longer in upstream community support, even though the SDK code keeps the compatibility fallback used by older Live Update APIs.

Older versions may work, but they are outside the supported range. We do not offer support for unsupported versions and do not take responsibility for issues caused by using them.

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

const otalan = await initializeUpdater({
  apiUrl: 'https://api.otalan.com',
  apiKey: 'otalan_ota_xxx',
  channel: 'production',
  onResume: true,
})

const deviceId = await otalan.getDeviceId()
```

## Capacitor Example

```ts
// src/ota.ts
import { initializeUpdater, type InitializedCapacitorUpdater } from '@otalan/capacitor'

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

let otalanUpdater: Promise<InitializedCapacitorUpdater> | null = null

export function startOtalanUpdater() {
  otalanUpdater ??= initializeUpdater({
    apiUrl: 'https://api.otalan.com',
    apiKey: 'otalan_ota_xxx',
    channel: 'production',
    onResume: true,
  })

  return otalanUpdater
}

export async function syncOtalanUpdates() {
  const otalan = await startOtalanUpdater()
  return otalan.sync('manual')
}

export async function getOtalanDeviceId() {
  const otalan = await startOtalanUpdater()
  return otalan.getDeviceId()
}
```

```ts
// src/main.ts
import { startOtalanUpdater, syncOtalanUpdates } from './ota'

void startOtalanUpdater()

document.querySelector('#sync-updates')?.addEventListener('click', () => {
  void syncOtalanUpdates()
})
```

`initializeUpdater()` creates and persists a stable `deviceId` when you do not provide one. Otalan uses that ID for update checks, confirmation, and rollout targeting.

## Custom Device ID Storage

By default, `initializeUpdater()` creates and persists a stable `deviceId` with `localStorage`.

If you want different storage, provide a custom adapter:

```ts
import { Preferences } from '@capacitor/preferences'
import { initializeUpdater } from '@otalan/capacitor'

await initializeUpdater({
  apiUrl: 'https://api.otalan.com',
  apiKey: 'otalan_ota_xxx',
  channel: 'production',
  deviceIdStorage: {
    getItem: async (key) => {
      const result = await Preferences.get({ key })
      return result.value
    },
    setItem: (key, value) => Preferences.set({ key, value }),
  },
})
```

If your app already owns a stable ID, pass it explicitly:

```ts
await initializeUpdater({
  apiUrl: 'https://api.otalan.com',
  apiKey: 'otalan_ota_xxx',
  channel: 'production',
  deviceId: await loadOrCreateStableDeviceId(),
})
```

`initializeUpdater()` returns the resolved ID:

```ts
const otalan = await initializeUpdater({
  apiUrl: 'https://api.otalan.com',
  apiKey: 'otalan_ota_xxx',
  channel: 'production',
})

const deviceId = await otalan.getDeviceId()
```

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
- creates and persists a stable `deviceId` unless you provide one
- exposes the resolved `deviceId` through `getDeviceId()`
- runs one launch sync
- can register a resume listener
- logs device ID storage failures and returns a no-op updater
- logs resume listener registration failures and still runs launch sync
- deduplicates concurrent sync calls
- swallows sync failures and logs warnings instead
- keeps install confirmation best-effort during sync so a slow `POST /capacitor/confirm` cannot block the next update check

On a fresh native install, `LiveUpdate.getCurrentBundle()` and `LiveUpdate.getNextBundle()` can both return `null` bundle IDs. That is normal before the device has activated or staged an OTA bundle.

If startup or resume sync logs `[ota] ... sync failed`, the failure happened after the Live Update state checks, usually during `POST /capacitor/check` or bundle download/staging. The SDK logs a serializable `{ sdkName, sdkVersion, name, message }` error payload so native consoles can show the installed SDK version, HTTP status, API message, plugin operation, or fetch failure instead of an empty `{}`.

If the message says `failed before response`, the request did not receive an HTTP response. Check that `apiUrl` is reachable from the device, uses a trusted certificate, and is allowed by platform HTTP security settings.

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

Returns a low-level Capacitor updater:

- `ready()`: returns `Promise<LiveUpdateReadyResult>` after calling `LiveUpdate.ready()` and attempting install confirmation
- `getCurrentBundleId()`: returns `Promise<string | undefined>`
- `check()`: returns `Promise<CapacitorCheckResult>`
- `sync()`: returns `Promise<CapacitorSyncResult>`

### `await initializeUpdater(config)`

Config:

- everything from `createUpdater(config)` except `appId` and `deviceId`, which become optional
- `deviceId`: optional explicit stable device ID override
- `deviceIdStorage`: optional async storage adapter with `getItem()` and `setItem()`
- `deviceIdStorageKey`: optional storage key, defaults to `otalan-device-id`
- `enabled`: optional explicit gate
- `onResume`: defaults to `true`
- `logger`: optional warning and info logger

Returns:

- `getDeviceId()`: resolves the stable device ID or `null` when no updater is enabled and no explicit ID was provided
- `getUpdater()`: resolves the low-level updater or `null`
- `sync(trigger?)`: runs a deduplicated sync and returns `CapacitorSyncResult | null`

### `await initialized.getDeviceId()`

Returns `Promise<string | null>`.

### `await initialized.getUpdater()`

Returns the low-level updater from `createUpdater(config)`, or `null` when the startup helper is disabled or the platform is unsupported.

### `await initialized.sync(trigger?)`

Runs a deduplicated update sync through the low-level updater.

Returns `Promise<CapacitorSyncResult | null>`.

### Package Metadata Exports

- `OTALAN_CAPACITOR_SDK_NAME`: package name read from `@otalan/capacitor`'s `package.json`
- `OTALAN_CAPACITOR_SDK_VERSION`: package version read from `@otalan/capacitor`'s `package.json`

These values are included in SDK warning logs.

### `await updater.ready()`

Calls `LiveUpdate.ready()` and confirms the currently running bundle when possible.

Returns the `LiveUpdate.ready()` result from `@capawesome/capacitor-live-update`.

### `await updater.getCurrentBundleId()`

Returns the active bundle ID when one exists.

Returns `Promise<string | undefined>`.

### `await updater.check()`

Calls `POST /capacitor/check`.

Returns `Promise<CapacitorCheckResult>`.

### `await updater.sync()`

Runs the full Otalan update flow:

1. calls `ready()`
2. checks Otalan
3. skips if already current
4. reloads immediately if the target bundle is already staged
5. downloads only when needed and records experimental `transferSource` metadata
6. stages the next bundle
7. reloads unless `reloadOnSync` is `false`

When an update is applied, `CapacitorSyncResult` includes experimental `transferSource` metadata:

- `downloaded`: the SDK called `LiveUpdate.downloadBundle()` for this bundle before staging it
- `cached`: the SDK verified the bundle was already present on the device before attempting a download

The SDK uses `downloaded` as the default. If the source marker is missing, storage is unavailable, or the SDK cannot confidently prove the bundle was cached, confirmation is sent as `downloaded`. An already-staged bundle without a recorded source is reported as `cached` only when the installed Live Update plugin's bundle-listing API proves it is already present on the device. Treat this field as experimental client-reported metadata only.

Returns `Promise<CapacitorSyncResult>`.

## Result Types

`CapacitorCheckResult`:

- `updateAvailable`: whether Otalan selected an update
- `bundleId`: selected bundle ID when an update is available
- `downloadUrl`: selected bundle URL when an update is available
- `checksum`: optional bundle checksum
- `mandatory`: whether the update is mandatory
- `rolloutPercent`: rollout percentage returned by the API
- `releaseNotes`: optional release notes

`CapacitorSyncResult`:

- `updateAvailable`: whether Otalan selected an update that should be applied
- `applied`: whether the SDK staged the selected update
- `bundleId`: applied bundle ID
- `mandatory`: whether the applied update is mandatory
- `transferSource`: experimental transfer metadata when an update is applied
- `releaseNotes`: optional release notes
- `reloadRequired`: `true` when `reloadOnSync: false` leaves a staged bundle waiting for app reload

## Backend Contract

The backend must expose:

- `POST /capacitor/check`
- `POST /capacitor/confirm`

`POST /capacitor/check` requires `deviceId` so Otalan can target staged rollouts consistently.

`POST /capacitor/confirm` requires `deviceId` and still accepts `transferSource` as experimental metadata.

Confirm payload:

```json
{
  "appId": "com.example.app",
  "platform": "ios",
  "bundleId": "bundle-123",
  "deviceId": "device-1",
  "transferSource": "downloaded"
}
```

`transferSource` is either `downloaded` or `cached`. It is experimental and client-reported. The API must not use it for billing, transfer limits, quotas, or free-transfer decisions. Keep confirmation processing idempotent per app, device, and bundle so retries do not double count usage.

Only active, non-archived Otalan apps are eligible for OTA checks and install confirmations. If the app is archived, `initializeUpdater()` logs the rejected request and leaves the host app running; low-level `check()` or `sync()` calls reject with the API error.

`POST /capacitor/check` can also return `409` when the active bundle record exists but its managed archive is no longer available.

## Notes

- repeated confirmation calls for the same installed bundle are skipped after a successful confirmation
- failed confirmation calls are retried on a later `ready()` call
- experimental transfer source markers are stored until confirmation succeeds so they survive the reload between staging and activation
- `initializeUpdater()` will create and persist `deviceId` for you unless you override it
- archived apps do not receive updates until they are restored in Otalan
- production API URL is usually `https://api.otalan.com`
- local development API URL is usually `http://localhost:8787` only when the native runtime can reach that host. Physical devices usually need your machine's LAN IP, Android emulators usually need `10.0.2.2`, and plain HTTP may require platform cleartext/ATS development settings.
