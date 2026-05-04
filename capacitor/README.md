# `@otalan/capacitor`

Otalan OTA client SDK for Capacitor apps.

This package is the full client-side orchestration layer for Otalan on Capacitor. It checks for updates, downloads bundles, stages the next bundle, reloads when needed, and confirms successful installs.

## What This Package Does

- calls `POST /capacitor/check`
- decides whether a bundle should be applied
- downloads bundles through `@capawesome/capacitor-live-update`
- sets the next bundle
- reloads the app when needed
- confirms successful installs through `POST /capacitor/confirm` with the bundle transfer source
- provides a startup helper through `initializeUpdater()`

The SDK uses Capacitor's native HTTP transport for Otalan API calls on iOS and Android, with browser `fetch()` kept as the non-native fallback.

## What You Need

- a Capacitor app
- `@capawesome/capacitor-live-update`
- `@capacitor/app`
- `@capacitor/core`
- an Otalan OTA app key
- a stable device ID

Use the OTA app key in the app. Do not use a CI key in frontend code.

## Supported Versions

This package supports Capacitor 8 and Capacitor 7:

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

### `await initializeUpdater(config)`

Config:

- everything from `createUpdater(config)` except `appId`, which becomes optional
- `enabled`: optional explicit gate
- `onResume`: defaults to `true`
- `logger`: optional warning and info logger

Returns:

- `getUpdater()`: resolves the low-level updater or `null`
- `sync(trigger?)`: runs a deduplicated sync and returns `CapacitorSyncResult | null`

### Package Metadata Exports

- `OTALAN_CAPACITOR_SDK_NAME`: package name read from `@otalan/capacitor`'s `package.json`
- `OTALAN_CAPACITOR_SDK_VERSION`: package version read from `@otalan/capacitor`'s `package.json`

These values are included in SDK warning logs.

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
5. downloads only when needed and records `transferSource`
6. stages the next bundle
7. reloads unless `reloadOnSync` is `false`

When an update is applied, `CapacitorSyncResult` includes `transferSource`:

- `downloaded`: the SDK called `LiveUpdate.downloadBundle()` for this bundle before staging it
- `cached`: the SDK verified the bundle was already present on the device before attempting a download

The SDK uses `downloaded` as the default. If the source marker is missing, storage is unavailable, or the SDK cannot confidently prove the bundle was cached, confirmation is sent as `downloaded`. An already-staged bundle without a recorded source is reported as `cached` only when the installed Live Update plugin's bundle-listing API proves it is already present on the device.

## Backend Contract

The backend must expose:

- `POST /capacitor/check`
- `POST /capacitor/confirm`

`POST /capacitor/confirm` requires `deviceId` and `transferSource`.

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

`transferSource` is either `downloaded` or `cached`. Use it for transfer analytics, billing, and transfer limits:

- count R2 transfer usage when `transferSource` is `downloaded`
- treat `cached` confirmations as activations without a new R2 transfer only when the SDK explicitly verified the cached source
- keep confirmation processing idempotent per app, device, and bundle so retries do not double count usage

Only active, non-archived Otalan apps are eligible for OTA checks and install confirmations. If the app is archived, `initializeUpdater()` logs the rejected request and leaves the host app running; low-level `check()` or `sync()` calls reject with the API error.

`POST /capacitor/check` can also return `409` when the active bundle record exists but its managed archive is no longer available.

## Notes

- repeated confirmation calls for the same installed bundle are skipped after a successful confirmation
- failed confirmation calls are retried on a later `ready()` call
- transfer source markers are stored until confirmation succeeds so they survive the reload between staging and activation
- partial rollouts require a stable device ID
- archived apps do not receive updates until they are restored in Otalan
- production API URL is usually `https://api.otalan.com`
- local development API URL is usually `http://localhost:8787` only when the native runtime can reach that host. Physical devices usually need your machine's LAN IP, Android emulators usually need `10.0.2.2`, and plain HTTP may require platform cleartext/ATS development settings.
