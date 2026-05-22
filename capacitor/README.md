# `@otalan/capacitor`

Otalan OTA client SDK for Capacitor apps.

This package is the full client-side orchestration layer for Otalan on Capacitor. It checks for updates, downloads bundles, stages the next bundle, reloads when needed, and confirms successful installs.

## What This Package Does

- checks Otalan for updates
- requires and verifies served compatibility results before staging a bundle
- decides whether a bundle should be applied
- downloads bundles through `@capawesome/capacitor-live-update`
- sets the next bundle
- reloads the app when needed
- confirms successful installs with advisory bundle transfer source metadata
- provides a startup helper through `initializeUpdater()`

The SDK uses Capacitor's native HTTP transport for Otalan API calls on iOS and Android, with browser `fetch()` kept as the non-native fallback.

## What You Need

- a Capacitor app
- `@capawesome/capacitor-live-update`
- `@capacitor/app`
- `@capacitor/core`
- an Otalan OTA App Key
- a stable device ID, or let `initializeUpdater()` create one

Use the OTA App Key in the app. It can be embedded in mobile JS/TS bundles for update checks and install confirmations, but it is not a public identifier. OTA App Key values use the `otalan_ota_...` token format. Do not publish them in docs, issue trackers, logs, source control, or backend examples.

OTA Publish Key values use the `otalan_ci_...` token format and are for release automation only. Do not use OTA Publish Keys in app code.

## Supported Versions

This package officially supports Capacitor 7 and 8:

Use the matching Capawesome Live Update major for your Capacitor major:

- Capacitor 7 with `@capawesome/capacitor-live-update` 7.x
- Capacitor 8 with `@capawesome/capacitor-live-update` 8.x

Capacitor 8 is the current upstream major. Capacitor 7 is included for the upstream maintenance window.

The package peer dependencies warn outside Capacitor and Capawesome Live Update majors 7 and 8. Older Capacitor versions may work with package-manager overrides, but they are outside the official support range for the moment. We do not offer support for unsupported combinations and do not take responsibility for issues caused by using them.

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

## Vue/Vite Example

If you want to use environment variables, store your local Otalan values in your app's `.env` file and expose only client-bundled variables, such as `VITE_OTALAN_API_URL`, `VITE_OTALAN_API_KEY`, `VITE_OTALAN_APP_ID`, and `VITE_OTALAN_CHANNEL`.

```dotenv
VITE_OTALAN_API_URL=https://api.otalan.com
VITE_OTALAN_API_KEY=otalan_ota_xxx
VITE_OTALAN_APP_ID=com.example.app
VITE_OTALAN_CHANNEL=production
```

```ts
// src/composables/useOtalanUpdates.ts
import { computed, ref } from 'vue'
import { initializeUpdater, type InitializedCapacitorUpdater } from '@otalan/capacitor'

let otalanPromise: Promise<InitializedCapacitorUpdater> | null = null

function getOtalanUpdater() {
  otalanPromise ??= initializeUpdater({
    apiUrl: import.meta.env.VITE_OTALAN_API_URL ?? 'https://api.otalan.com',
    apiKey: import.meta.env.VITE_OTALAN_API_KEY ?? '',
    appId: import.meta.env.VITE_OTALAN_APP_ID ?? 'com.example.app',
    channel: import.meta.env.VITE_OTALAN_CHANNEL ?? 'production',
    onResume: true,
  })

  return otalanPromise
}

export function useOtalanUpdates() {
  const isSyncing = ref(false)
  const status = ref<'idle' | 'skipped' | 'syncing' | 'none' | 'applied' | 'failed'>('idle')

  const canSync = computed(() => Boolean(import.meta.env.VITE_OTALAN_API_KEY))

  async function syncUpdates() {
    if (!canSync.value || isSyncing.value) {
      status.value = 'skipped'
      return null
    }

    isSyncing.value = true
    status.value = 'syncing'

    try {
      const otalan = await getOtalanUpdater()
      const result = await otalan.sync('manual')

      if (!result) {
        status.value = 'skipped'
        return null
      }

      status.value = result.updateAvailable ? 'applied' : 'none'
      return result
    } catch {
      status.value = 'failed'
      return null
    } finally {
      isSyncing.value = false
    }
  }

  return {
    canSync,
    isSyncing,
    status,
    syncUpdates,
  }
}
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

When `enabled` is omitted, `initializeUpdater()`:

- no-ops outside native iOS and Android
- no-ops when `apiUrl`, `apiKey`, or `channel` are missing
- resolves `appId` from `App.getInfo()` unless you provide one
- creates and persists a stable `deviceId` unless you provide one
- exposes the resolved `deviceId` through `getDeviceId()`
- starts one launch sync in the background
- can register a resume listener
- logs device ID storage failures and returns a no-op updater
- logs resume listener registration failures and still starts launch sync
- deduplicates concurrent sync calls
- swallows sync failures and logs warnings instead
- keeps install confirmation best-effort during sync so a slow confirmation request cannot block the next update check

Pass `enabled: false` to force a no-op. Pass `enabled: true` only when your app has its own runtime/config gate, because it bypasses the default required config checks. Native iOS and Android platform validation still applies. With `enabled: true`, missing or invalid `apiUrl`, `apiKey`, or `channel` values can produce startup sync warnings instead of the helper silently no-oping.

On a fresh native install, `LiveUpdate.getCurrentBundle()` and `LiveUpdate.getNextBundle()` can both return `null` bundle IDs. That is normal before the device has activated or staged an OTA bundle.

If startup or resume sync logs `[ota] ... sync failed`, the failure happened after the Live Update state checks, usually during an update check or bundle download/staging. The SDK logs a serializable `{ sdkName, sdkVersion, name, message }` error payload so native consoles can show the installed SDK version, HTTP status, API message, plugin operation, or fetch failure instead of an empty `{}`.

If the message says `failed before response`, the request did not receive an HTTP response. Check that `apiUrl` is reachable from the device, uses a trusted certificate, and is allowed by platform HTTP security settings.

`initializeUpdater()` resolves after setup and does not wait for launch sync network work to finish. Call `initialized.sync()` if your app needs to await the current launch sync or run a manual sync later.

## API

### `createUpdater(config)`

Config:

- `apiUrl`: Otalan API base URL
- `apiKey`: OTA App Key
- `appId`: app identifier
- `channel`: release channel
- `runtimeVersion`: optional local runtime version override, sent to Otalan as `runtimeVersion`
- `platform`: optional platform override
- `deviceId`: required stable device ID
- `autoConfirm`: defaults to `true`
- `reloadOnSync`: defaults to `true`
- `requestTimeoutMs`: request timeout for Otalan API calls, defaults to `15000`
- `allowInsecureBundleUrls`: defaults to `false`; set only for development bundle URLs served over plain HTTP
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
- `enabled`: optional explicit gate. Omit for default native-platform and required config checks, pass `false` to force-disable, or pass `true` to force initialization and bypass default required config checks. Native platform validation still applies.
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

Checks Otalan for the selected update.

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

- `appId`: compatibility app identifier
- `platform`: compatibility platform
- `runtimeVersion`: compatibility runtime version
- `updateAvailable`: whether Otalan selected an update
- `bundleId`: selected bundle ID when an update is available
- `downloadUrl`: selected HTTPS bundle URL when an update is available. Treat this value as opaque; downloads may come from immutable CDN URLs.
- `checksum`: required bundle checksum. Treat this value as opaque; current Otalan APIs return SHA-256 hex and the SDK passes it through to `LiveUpdate.downloadBundle()` unchanged.
- `mandatory`: whether the update is mandatory. Missing values are normalized to `false`.
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

## Network Behavior

The SDK sends the OTA App Key with Otalan requests. Update checks include `appId`, `platform`, `channel`, `runtimeVersion`, `currentBundleId` when available, and the stable `deviceId`. Successful check responses must include matching `appId`, `platform`, `runtimeVersion`, `bundleId`, `downloadUrl`, and `checksum`; the SDK validates those fields before trusting `updateAvailable` or using any selected bundle. Missing or mismatched compatibility metadata rejects `check()` or `sync()`; `initializeUpdater()` logs the sync failure and leaves the host app running. Install confirmations include the app identifier, platform, channel, runtime version, bundle ID, stable device ID, and `transferSource`.

Otalan API requests time out after `requestTimeoutMs`, defaulting to 15 seconds. Bundle downloads are still performed by `@capawesome/capacitor-live-update`, but the SDK only passes HTTPS `downloadUrl` values to the plugin by default. Set `allowInsecureBundleUrls: true` only for local development environments that intentionally serve bundles over plain HTTP.

`transferSource` is either `downloaded` or `cached`. Treat it as advisory client-reported metadata only.

Only active Otalan apps are eligible for OTA checks and install confirmations. If update traffic is unavailable for the app, `initializeUpdater()` logs the rejected request and leaves the host app running; low-level `check()` or `sync()` calls reject with the API error.

## Notes

- repeated confirmation calls for the same installed bundle are skipped after a successful confirmation, including later app starts when local storage is available
- failed confirmation calls are retried on a later `ready()` call
- experimental transfer source markers are stored until confirmation succeeds so they survive the reload between staging and activation
- `initializeUpdater()` will create and persist `deviceId` for you unless you override it
- apps must be active in Otalan to receive updates
- production API URL is usually `https://api.otalan.com`
- local development API URL is usually `http://localhost:8787` only when the native runtime can reach that host. Physical devices usually need your machine's LAN IP, Android emulators usually need `10.0.2.2`, and plain HTTP may require platform cleartext/ATS development settings. Plain HTTP bundle URLs additionally require `allowInsecureBundleUrls: true`.
