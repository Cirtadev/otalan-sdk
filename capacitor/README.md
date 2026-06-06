# `@otalan/capacitor`

Otalan OTA client SDK for Capacitor apps.

This package is the full client-side orchestration layer for Otalan on Capacitor. It checks for updates, downloads bundles, stages the next bundle, reloads when needed, and confirms successful installs.

## What This Package Does

- checks Otalan for updates
- requires and verifies served compatibility results before staging a bundle
- decides whether a bundle should be applied
- downloads bundles through `@capawesome/capacitor-live-update`
- reports native bundle download progress when requested
- sets the next bundle
- reloads the app when needed
- protects newly launched OTA bundles with SDK-managed rollback validation
- confirms successful installs with advisory bundle transfer source metadata
- provides an initialized helper through `initializeUpdater()`

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

Store your Otalan values in your app's `.env` file and expose only client-bundled variables, such as Vite's `VITE_` variables.

```dotenv
VITE_OTALAN_API_URL=https://api.otalan.com
VITE_OTALAN_APP_KEY=otalan_ota_xxx
VITE_OTALAN_APP_ID=com.example.app
VITE_OTALAN_CHANNEL=production
VITE_OTALAN_RUNTIME_VERSION=1.0.0
VITE_OTALAN_ROLLBACK_VALIDATION_DELAY_MS=10000
```

Create the updater when your app is ready to manage OTA updates, then reuse it for later checks or syncs:

```ts
import { initializeUpdater, type InitializedCapacitorUpdater } from '@otalan/capacitor'

let updater: InitializedCapacitorUpdater | undefined

export async function syncOtalanUpdates() {
  if (!updater) {
    updater = await initializeUpdater({
      apiUrl: import.meta.env.VITE_OTALAN_API_URL,
      apiKey: import.meta.env.VITE_OTALAN_APP_KEY,
      appId: import.meta.env.VITE_OTALAN_APP_ID,
      channel: import.meta.env.VITE_OTALAN_CHANNEL,
      runtimeVersion: import.meta.env.VITE_OTALAN_RUNTIME_VERSION || undefined,
      rollbackProtection: {
        validationDelayMs: Number(import.meta.env.VITE_OTALAN_ROLLBACK_VALIDATION_DELAY_MS || 10000),
      },
      onResume: true,
      onDownloadProgress: (event) => {
        console.log(
          event.bundleId,
          event.progress,
          event.downloadedBytes,
          event.totalBytes,
        )
      },
    })
  }

  return updater.sync()
}
```

`initializeUpdater()` creates and persists a stable `deviceId` when you do not provide one. Otalan uses that ID for update checks, install confirmation, and rollout targeting.

## Custom Device ID Storage

By default, `initializeUpdater()` creates and persists a stable `deviceId` with `localStorage`.

If you want different storage, provide a custom adapter:

```ts
import { Preferences } from '@capacitor/preferences'

const deviceIdStorage = {
  getItem: async (key: string) => {
    const result = await Preferences.get({ key })
    return result.value
  },
  setItem: (key: string, value: string) => Preferences.set({ key, value }),
}
```

Pass `deviceIdStorage` in the `initializeUpdater()` options from the quick start.

If your app already owns a stable ID, pass it explicitly:

```ts
deviceId: await loadOrCreateStableDeviceId(),
```

`initializeUpdater()` returns the resolved ID:

```ts
const deviceId = await updater.getDeviceId()
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
  rollbackProtection: {
    validationDelayMs: 10000,
  },
})

await updater.ready()
await updater.sync()
```

## Download Progress

The quick-start sample passes `onDownloadProgress` to receive native bundle download progress during `sync()`.

`progress` is a number from `0` to `1`. The callback is only called for bundles downloaded by this SDK; cached or already-staged bundles do not emit download progress. The SDK filters native progress events to the selected bundle and removes the native listener after the download settles.

This callback is specific to `@otalan/capacitor` because the Capacitor SDK owns the bundle download call. Expo apps should listen to `expo-updates` download state directly, for example `useUpdates().downloadProgress` while `useUpdates().isDownloading` is true.

## Initialized Helper Behavior

When `enabled` is omitted, `initializeUpdater()`:

- no-ops outside native iOS and Android
- no-ops when `apiUrl`, `apiKey`, or `channel` are missing
- resolves `appId` from `App.getInfo()` unless you provide one
- creates and persists a stable `deviceId` unless you provide one
- exposes the resolved `deviceId` through `getDeviceId()`
- starts `LiveUpdate.ready()` and install confirmation once in the background
- does not run a launch sync
- can register a resume listener
- logs device ID storage failures and returns a no-op updater
- logs resume listener registration failures and still returns the initialized helper
- deduplicates concurrent check calls
- deduplicates concurrent sync calls
- swallows sync failures and logs warnings instead
- keeps install confirmation best-effort during sync so a slow confirmation request cannot block the next update check

Pass `enabled: false` to force a no-op. Pass `enabled: true` only when your app has its own runtime/config gate, because it bypasses the default required config checks. Native iOS and Android platform validation still applies. With `enabled: true`, missing or invalid `apiUrl`, `apiKey`, or `channel` values can produce sync warnings when your app calls `sync()` instead of the helper silently no-oping.

On a fresh native install, `LiveUpdate.getCurrentBundle()` and `LiveUpdate.getNextBundle()` can both return `null` bundle IDs. That is normal before the device has activated or staged an OTA bundle.

If manual or resume sync logs `[ota] ... sync failed`, the failure happened after the Live Update state checks, usually during an update check or bundle download/staging. The SDK logs a serializable `{ sdkName, sdkVersion, name, message }` error payload so native consoles can show the installed SDK version, HTTP status, API message, plugin operation, or fetch failure instead of an empty `{}`.

If the message says `failed before response`, the request did not receive an HTTP response. Check that `apiUrl` is reachable from the device, uses a trusted certificate, and is allowed by platform HTTP security settings.

`initializeUpdater()` resolves after setup and does not start launch update check, download, staging, or reload work. It may send a best-effort install confirmation for the currently launched bundle. Call `initialized.check()` when your app should check availability without applying an update, or `initialized.sync()` when it should check, download, stage, and optionally reload. If `onResume` is enabled, the registered resume listener also runs a deduplicated sync when the app resumes.

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
- `reloadOnSync`: defaults to `true`
- `requestTimeoutMs`: request timeout for Otalan API calls, defaults to `15000`
- `allowInsecureBundleUrls`: defaults to `false`; set only for development bundle URLs served over plain HTTP
- `rollbackProtection`: defaults to `true`; set `false` to disable SDK-managed rollback validation, or pass `{ validationDelayMs }` to tune the launch validation window
- `headers`: optional extra request headers
- `onDownloadProgress`: optional callback for native bundle download progress events
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
- `check()`: checks availability without downloading, staging, or reloading and returns `CapacitorCheckResult | null`
- `sync()`: runs a deduplicated sync and returns `CapacitorSyncResult | null`

### `await initialized.getDeviceId()`

Returns `Promise<string | null>`.

### `await initialized.getUpdater()`

Returns the low-level updater from `createUpdater(config)`, or `null` when the initialized helper is disabled or the platform is unsupported.

### `await initialized.check()`

Runs a deduplicated update check through the low-level updater without downloading, staging, or reloading an update.

Returns `Promise<CapacitorCheckResult | null>`. The initialized helper logs setup or check failures and returns `null`, so normal app code can handle a skipped or failed check without wrapping this call in `try`/`catch`. Low-level `createUpdater().check()` still rejects on API or validation failures.

### `await initialized.sync()`

Runs a deduplicated update sync through the low-level updater.

Returns `Promise<CapacitorSyncResult | null>`. The initialized helper logs setup or sync failures and returns `null`, so normal app startup code can handle a skipped or failed sync without wrapping this call in `try`/`catch`. Low-level `createUpdater().check()` and `createUpdater().sync()` still reject on API, validation, download, or staging failures.

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

Before reloading into a newly staged bundle, the SDK records the target bundle and previous bundle in local storage. On the next launch of that target bundle, `ready()` calls native `LiveUpdate.ready()` promptly, then waits for the rollback protection validation window before confirming the bundle. If the previous launch of the same pending target did not survive long enough to validate, the SDK stages the previous bundle when possible, otherwise resets to the default bundle, then reloads.

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

`CapacitorDownloadProgress`:

- `bundleId`: bundle ID being downloaded
- `downloadedBytes`: downloaded byte count
- `totalBytes`: total byte count reported by the native plugin
- `progress`: download progress from `0` to `1`

`CapacitorSyncResult`:

- `updateAvailable`: whether Otalan selected an update that should be applied
- `applied`: whether the SDK staged the selected update
- `bundleId`: applied bundle ID
- `mandatory`: whether the applied update is mandatory
- `transferSource`: experimental transfer metadata when an update is applied
- `releaseNotes`: optional release notes
- `reloadRequired`: `true` when `reloadOnSync: false` leaves a staged bundle waiting for app reload

## Network Behavior

The SDK sends the OTA App Key with Otalan requests. Update checks include `appId`, `platform`, `channel`, `runtimeVersion`, `currentBundleId` when available, and the stable `deviceId`. Successful check responses must include matching `appId`, `platform`, `runtimeVersion`, `bundleId`, `downloadUrl`, and `checksum`; the SDK validates those fields before trusting `updateAvailable` or using any selected bundle. Missing or mismatched compatibility metadata rejects low-level `check()` or `sync()` calls; initialized helper checks and syncs log the failure and leave the host app running. Otalan can count an update as served when the check response selects a bundle with `downloadUrl`; install confirmations are a separate client-reported signal that the device successfully launched or applied that bundle. Install confirmations include the app identifier, platform, channel, runtime version, bundle ID, stable device ID, and `transferSource`.

Update failure and telemetry events are reported best-effort to `/capacitor/report-update-event` with the same OTA App Key auth. Event payloads include `eventId`, `appId`, `platform`, `channel`, optional `runtimeVersion`, optional `deviceId`, optional `currentBundleId`, optional `targetBundleId`, `phase`, `category`, `errorType`, `errorMessage`, `sdkName`, and `sdkVersion`. Capacitor reports `phase: "check"` as `category: "check_failed"`, `download`, `stage`, and `reload` as `apply_failed`, and `confirm` as `telemetry_failed`. Confirmation failures are not failed updates; they only mean the SDK could not send telemetry for an already launched bundle. Apply failures include `targetBundleId` only when the SDK has a selected target bundle; unmatched apply failures stay diagnostic in Otalan analytics.

Otalan API requests time out after `requestTimeoutMs`, defaulting to 15 seconds. Bundle downloads are still performed by `@capawesome/capacitor-live-update`, but the SDK only passes HTTPS `downloadUrl` values to the plugin by default. Download progress is forwarded from the plugin's `downloadBundleProgress` event when `onDownloadProgress` is configured. Set `allowInsecureBundleUrls: true` only for local development environments that intentionally serve bundles over plain HTTP.

SDK-managed rollback protection is enabled by default for Capacitor. It calls native `LiveUpdate.ready()` promptly, then delays Otalan install confirmation for newly launched SDK-managed bundles by `rollbackProtection.validationDelayMs`, defaulting to `10000`. This protects bundles that reach SDK initialization and then fail before validation completes. Locally rolled-back target bundles are skipped on later checks and syncs for the same app, channel, and device. Native failures before the app starts the SDK still require native runtime rollback support such as Capawesome Live Update `readyTimeout`.

`transferSource` is either `downloaded` or `cached`. Treat it as advisory client-reported metadata only.

Only active Otalan apps are eligible for OTA checks and install confirmations. If update traffic is unavailable for the app, initialized helper checks and syncs log the rejected request and leave the host app running; low-level `check()` or `sync()` calls reject with the API error.

## Notes

- repeated confirmation calls for the same installed bundle are skipped after a successful confirmation, including later app starts when local storage is available
- failed confirmation calls are retried on a later `ready()` call
- experimental transfer source markers are stored until confirmation succeeds so they survive the reload between staging and activation
- `initializeUpdater()` will create and persist `deviceId` for you unless you override it
- apps must be active in Otalan to receive updates
- production API URL is usually `https://api.otalan.com`
- local development API URL is usually `http://localhost:8787` only when the native runtime can reach that host. Physical devices usually need your machine's LAN IP, Android emulators usually need `10.0.2.2`, and plain HTTP may require platform cleartext/ATS development settings. Plain HTTP bundle URLs additionally require `allowInsecureBundleUrls: true`.
