# `otalan-sdk`

Monorepo for the Otalan mobile OTA SDK packages:

- `@otalan/capacitor`: full Otalan OTA client for Capacitor apps
- `@otalan/expo`: confirmation, check, and manual sync helper for Expo apps using `expo-updates`

Website: [otalan.com](https://otalan.com)

## Which Package To Use

### `@otalan/capacitor`

Use this when your app is built with Capacitor and Otalan should handle:

- update checks against Otalan
- bundle download and staging
- SDK-managed download progress through `onDownloadProgress`
- reload after install
- install confirmation with advisory transfer source metadata

Package docs: [capacitor/README.md](capacitor/README.md)

### `@otalan/expo`

Use this when your app uses Expo with `expo-updates` and you only need:

- install confirmation for launched OTA updates
- current update metadata
- check-only update availability
- a small `initializeUpdater()` helper with manual sync
- SDK-managed rollback validation for updates applied through `initialized.sync()`

It delegates update checks, fetching, and reloads to `expo-updates`; it does not replace Expo's runtime or report SDK-managed download progress itself.

For Expo download progress, listen to `expo-updates` download state directly, for example `useUpdates().downloadProgress` while `useUpdates().isDownloading` is true. The Expo package docs include a small adapter example for apps that want an `onProgress` callback shape.

Package docs: [expo/README.md](expo/README.md)

## App Lifecycle

Otalan serves OTA traffic only for apps that are active in Otalan. If update traffic is unavailable for an app, the mobile SDKs keep the host app running and surface or log the request failure according to the helper being used.

## Update Compatibility

Capacitor update checks include `appId`, `platform`, `channel`, `runtimeVersion`, `currentBundleId` when available, and stable `deviceId`. Successful `/capacitor/check` responses must include matching `appId`, `platform`, and `runtimeVersion`; `@otalan/capacitor` validates those values before trusting `updateAvailable` or using any selected bundle.

Capacitor applies SDK-managed rollback validation to newly launched SDK-managed bundles. Before reloading into a target bundle, the SDK stores the previous/target bundle pair. On the target launch, `ready()` calls native `LiveUpdate.ready()` promptly, then waits for the validation window before confirming the install; if a previous launch of the same target did not validate, the SDK stages the previous bundle when possible, otherwise resets to the default bundle, then reloads. Native failures before SDK initialization still depend on native runtime rollback support such as Capawesome Live Update `readyTimeout`.

Expo update selection is handled by `expo-updates` and the Otalan manifest endpoint. `@otalan/expo` can run a check-only `expo-updates` flow through `initialized.check()` or the manual check/fetch/reload flow through `initialized.sync()`, and it observes and confirms the launched update with its app, platform, channel, runtime version, Otalan bundle ID, and device ID context. Expo rollback protection records pending targets before reload, validates launched targets before confirmation, blocks failed targets locally, and asks the Otalan manifest endpoint for Expo rollback-to-embedded behavior when a pending target failed validation.

## Rollback Support

Both packages expose `rollbackProtection.validationDelayMs`, defaulting to `10000` milliseconds. Pass `rollbackProtection: false` to disable SDK-managed rollback protection.

| Capability | `@otalan/capacitor` | `@otalan/expo` |
| --- | --- | --- |
| Records pending update before reload | Yes. Stores the previous and target bundle IDs before native reload. | Yes. Stores the target Otalan bundle ID before `Updates.reloadAsync()`. |
| Validation delay | Yes. `ready()` calls native `LiveUpdate.ready()` promptly, then waits before Otalan install confirmation. | Yes. `ready()` waits before Otalan install confirmation for the launched pending target. |
| Default `validationDelayMs` | `10000` ms | `10000` ms |
| Failed target blocklist | Yes. Skips locally blocked target bundles on later checks and syncs. | Yes. Skips locally blocked targets and sends blocked IDs to Expo update checks. |
| SDK-triggered rollback after failed validation | Yes. Stages the previous bundle when available, otherwise resets to the default bundle, then reloads. | Yes, through `expo-updates`. The SDK sends rollback context, checks/fetches, and reloads when Expo returns rollback-to-embedded. |
| Native failure before JS starts | Covered by native runtime support such as Capawesome Live Update `readyTimeout`; SDK validation runs once JS starts. | Covered only by Expo runtime behavior such as emergency launch or rollback-to-embedded; SDK validation runs once JS starts. |
| Main limitation | Requires native Live Update rollback support for failures before JS initializes. | Expo has no JS API for directly staging a previous update bundle, so the manifest endpoint must return Expo rollback-to-embedded. |

## Otalan API Requirements

Capacitor rollback protection does not require a new API endpoint. The SDK records pending bundles locally, filters locally blocked targets after `/capacitor/check`, and restores the previous/default bundle through the native Live Update plugin.

Expo rollback protection does require `/expo/updates` support. The manifest endpoint must read the SDK rollback context from the request, avoid selecting locally blocked bundle IDs, and return an Expo rollback-to-embedded response when the rollback target is still the active bundle or no safe active bundle exists. If operators have already activated a safe non-blocked bundle, the endpoint can serve that bundle normally. The SDK sends this context through Expo extra params and, when present, declared request headers:

- `otalan-blocked-bundle-ids` / `x-otalan-blocked-bundle-ids`: JSON array of target bundle IDs that failed local validation
- `otalan-rollback-target-bundle-id` / `x-otalan-rollback-target-bundle-id`: failed target bundle ID that should roll back to embedded

If `/expo/updates` ignores this context, the Expo SDK can still avoid confirming and locally block failed targets, but it cannot force a rollback because Expo does not expose a JavaScript API for staging a previous update. During a rollback request the SDK rejects locally blocked targets, reloads when `expo-updates` reports rollback-to-embedded, and can also reload a safe non-blocked active update selected by the endpoint.

## Update Event Reporting

Both helpers report update failure and telemetry events to Otalan in the background. Capacitor reports to `/capacitor/report-update-event`; Expo reports to `/expo/report-update-event`. These calls use the same OTA App Key auth, headers, and timeout settings as check and confirm requests, and failures in the report request itself do not change app behavior.

Reported events include `eventId`, app/platform/channel/runtime/device context, optional `currentBundleId` and `targetBundleId`, `phase`, `category`, `errorType`, `errorMessage`, and SDK name/version. Categories are constrained by phase: `check` maps to `check_failed`, `download`/`fetch`/`stage`/`reload` map to `apply_failed`, and `confirm` maps to `telemetry_failed`.

The SDK generates an `eventId` for each report so the API can dedupe retries or repeated sends. Server-side fallback dedupe may use a derived key such as API key, app, platform, channel, device, phase, target bundle, and error type, and should stay time-bounded so recurring client errors are not collapsed forever.

Dashboard metrics should keep these streams separate. Failed checks are diagnostics. Confirmation failures are telemetry failures, not failed updates. Apply failures should only affect served-update metrics when `targetBundleId` is present and the API can tie the event to a served update context; unmatched apply failures belong in diagnostics.

## Helper Enablement

When `enabled` is omitted, both helpers auto-enable only when their runtime and required config are available. Pass `enabled: false` to force a no-op. Pass `enabled: true` only when your app has its own gate, because it bypasses the helper's default config checks and can surface missing or invalid config as request failures when helper network work runs. Native iOS and Android platform validation still applies.

Both helpers start current-bundle confirmation in the background after setup. The Capacitor helper does not run a launch update sync; updates are checked only when `initialized.check()` or `initialized.sync()` is called, or when the configured resume listener fires.

## Device IDs

Both package helpers can create and persist a stable device ID unless the app provides one. Low-level `createUpdater()` APIs still require an explicit `deviceId`. Expo Android apps treat `Application.getAndroidId()` as authoritative when available and migrate storage to it; Expo iOS apps use the vendor ID when available and otherwise fall back to the stored SDK ID.

Expo apps can call `initialized.check()` to check availability without fetching, or `initialized.sync()` to check, fetch, and reload. The SDK resolves the stable device ID, passes it to Expo update requests through Expo extra params for Otalan rollout bucketing, and sets the OTA App Key request header before calling `expo-updates`. App code does not need to know or set an Otalan device header.

Capacitor checks go through `@otalan/capacitor`, so the SDK sends the resolved ID itself.

## Basic Usage

These values are bundled into the mobile client; do not publish or share the OTA App Key outside the app.

OTA App Key values use the `otalan_ota_...` token format. OTA Publish Key values use the `otalan_ci_...` token format and are for release automation only; never bundle OTA Publish Keys into app code.

### Capacitor

For Capacitor apps using Vite:

```dotenv
VITE_OTALAN_API_URL=https://api.otalan.com
VITE_OTALAN_APP_KEY=otalan_ota_xxx
VITE_OTALAN_APP_ID=com.example.app
VITE_OTALAN_CHANNEL=production
VITE_OTALAN_RUNTIME_VERSION=1.0.0
VITE_OTALAN_ROLLBACK_VALIDATION_DELAY_MS=10000
```

Capacitor sync:

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

### Expo

For Expo apps:

```dotenv
EXPO_PUBLIC_OTALAN_API_URL=https://api.otalan.com
EXPO_PUBLIC_OTALAN_APP_KEY=otalan_ota_xxx
EXPO_PUBLIC_OTALAN_APP_ID=com.example.app
EXPO_PUBLIC_OTALAN_CHANNEL=production
EXPO_PUBLIC_OTALAN_ROLLBACK_VALIDATION_DELAY_MS=10000
```

Expo update sync:

```ts
import { initializeUpdater, type InitializedExpoUpdater } from '@otalan/expo'

let updater: InitializedExpoUpdater | undefined

export async function syncOtalanUpdates() {
  if (!updater) {
    updater = await initializeUpdater({
      apiUrl: process.env.EXPO_PUBLIC_OTALAN_API_URL!,
      apiKey: process.env.EXPO_PUBLIC_OTALAN_APP_KEY!,
      appId: process.env.EXPO_PUBLIC_OTALAN_APP_ID!,
      channel: process.env.EXPO_PUBLIC_OTALAN_CHANNEL!,
      rollbackProtection: {
        validationDelayMs: Number(process.env.EXPO_PUBLIC_OTALAN_ROLLBACK_VALIDATION_DELAY_MS || 10000),
      },
    })
  }

  return updater.sync()
}
```

## API Return Summary

`@otalan/capacitor`:

- `initializeUpdater(config)`: returns an initialized helper with `getDeviceId()`, `getUpdater()`, `check()`, and `sync()`
- `initialized.getDeviceId()`: returns `Promise<string | null>`
- `initialized.getUpdater()`: returns a promise resolving to the low-level updater or `null`
- `initialized.check()`: returns `Promise<CapacitorCheckResult | null>`
- `initialized.sync()`: returns `Promise<CapacitorSyncResult | null>`
- `createUpdater(config)`: returns a low-level updater with `ready()`, `getCurrentBundleId()`, `check()`, and `sync()`
- `updater.ready()`: returns the Live Update ready result
- `updater.getCurrentBundleId()`: returns `Promise<string | undefined>`
- `updater.check()`: returns `Promise<CapacitorCheckResult>`
- `updater.sync()`: returns `Promise<CapacitorSyncResult>`

`@otalan/expo`:

- `initializeUpdater(config)`: returns an initialized helper with `getDeviceId()`, `getUpdater()`, `check()`, `ready()`, and `sync()`
- `initialized.getDeviceId()`: returns `Promise<string | null>`
- `initialized.getUpdater()`: returns the low-level updater or `null`
- `initialized.check()`: returns `Promise<ExpoCheckResult>`
- `initialized.ready()`: returns `Promise<ExpoReadyResult | null>`
- `initialized.sync()`: returns `Promise<boolean>`
- `createUpdater(config)`: returns a low-level updater with `check()`, `getCurrentUpdate()`, `confirmCurrentUpdate()`, and `ready()`
- `updater.check()`: returns `Promise<ExpoCheckResult>`
- `updater.getCurrentUpdate()`: returns `Promise<ExpoReadyResult>`
- `updater.confirmCurrentUpdate()`: returns `Promise<ExpoReadyResult>`
- `updater.ready()`: returns `Promise<ExpoReadyResult>`

## Platform Support

The SDK packages can be installed and used from development machines running Windows, macOS, or Linux.

Runtime support is for native mobile apps:

- iOS and Android apps built with Capacitor through `@otalan/capacitor`
- iOS and Android apps using supported Expo SDK versions with `expo-updates` through `@otalan/expo`

## Version Support

- `@otalan/capacitor` officially supports Capacitor 7 and 8.
- `@otalan/expo` officially supports Expo SDK 54, 55, and 56.

The package peer dependencies warn outside those supported major ranges. Other runtimes and older Expo or Capacitor versions may work with package-manager overrides, but they are outside the official support range for the moment. We do not offer support for unsupported combinations and do not take responsibility for issues caused by using them.

## Consumer Install

You do not need Bun to use either package in an app.

Install only the package that matches your app runtime.

For Capacitor apps:

```bash
npm install @otalan/capacitor @capawesome/capacitor-live-update @capacitor/app @capacitor/core
```

For Expo apps using `expo-updates`:

```bash
npm install @otalan/expo expo-updates expo-application
```

Official support ranges are documented in each package README.

## Repo Layout

- `capacitor/`: `@otalan/capacitor` source, package docs, and tests
- `expo/`: `@otalan/expo` source, package docs, and tests
- root scripts: workspace-level install, lint, typecheck, test, and build commands

## Repo Development

Bun 1.3.11 or newer is required to build and validate this repo. The pinned package manager is `bun@1.3.13`.

```bash
bun install
bun run lint
bun run check
bun test
bun run build
```

Package tests live under each workspace `tests/` directory.

For package-specific work:

```bash
bun run build:capacitor
bun run build:expo
```
