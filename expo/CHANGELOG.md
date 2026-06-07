# Changelog

## 1.8.2 - 2026-06-07

### Fixed

- Fixed stale Expo rollback request context by clearing rollback extra params and request-header overrides after rollback-to-embedded fetches.

### Tests

- Added regression coverage for clearing stale rollback request headers after rollback-to-embedded fetches.

## 1.8.1 - 2026-06-07

### Fixed

- Fixed Expo rollback protection for minimal `initializeUpdater().sync()` and low-level `check()` flows by sharing startup rollback preparation across `sync()`, `check()`, and `ready()` before normal update checks run.
- Fixed `requestExpoRollbackToEmbedded()` to return whether rollback recovery actually fetched and reloaded a rollback or safe active update.

### Tests

- Added regression coverage for minimal `initializeUpdater().sync()` rollback recovery before normal Expo update checks.

## 1.8.0 - 2026-06-05

### Added

- Added SDK-managed rollback validation for Expo update syncs. The SDK now records pending target bundles before reload, validates launched targets before confirming them, blocks targets that fail validation, and sends rollback context to Expo update checks through extra params and declared request headers.
- Added `rollbackProtection` configuration with a default `validationDelayMs` of `10000` milliseconds, exposed through both `initializeUpdater()` and low-level `createUpdater()`.
- Added rollback-request recovery for safe active updates: when the Otalan manifest endpoint serves a non-blocked active bundle instead of rollback-to-embedded, the SDK records that target for validation and reloads it.

### Changed

- Split Expo rollback protection into a platform-specific `expo-rollback-protection` source module.

### Tests

- Added regression coverage for pending rollback markers, launched-update validation, blocked target filtering, rollback-to-embedded requests, safe active updates during rollback requests, embedded rollback launches, and disabled rollback protection.

## 1.7.0 - 2026-06-02

### Added

- Added best-effort `/expo/report-update-event` reporting for failed checks, failed apply phases, and install-confirmation telemetry failures.

## 1.6.0 - 2026-05-27

### Added

- Added `check()` to initialized and low-level Expo updaters for availability checks that do not fetch or reload updates.

## 1.5.1 - 2026-05-25

### Changed

- Documented how Expo apps can mirror callback-style download progress with `useUpdates().downloadProgress` while keeping `expo-updates` as the owner of update downloads.
- Corrected the Expo quick-start sample to show lazy `initialized.sync()` usage instead of startup-only initialization.
- Consolidated Expo configuration and staged-rollout documentation to avoid repeated app config and runtime sync samples.
- Refined root README and package metadata wording so Expo is described as a confirmation and manual sync helper.

## 1.5.0 - 2026-05-25

### Added

- Added `initialized.sync()` for Expo apps so `@otalan/expo` owns the `expo-updates` check, fetch, and reload flow.
- Logged compact `expo-updates` state when `initialized.sync()` returns `false`.

### Fixed

- Moved Expo rollout device identity out of app code by writing the resolved SDK device ID to Expo update extra params as `otalan-device-id` before update checks.
- Stopped documenting dynamic `x-device-id` request-header overrides for Expo update checks.

## 1.4.3 - 2026-05-25

### Fixed

- Prefer `Application.getAndroidId()` for Expo Android device IDs whenever it is available, compare and migrate stored values to that ID, and fall back to storage only when the platform ID cannot be resolved. iOS now uses `Application.getIosIdForVendorAsync()` when available and falls back to storage when it returns `null` or fails.

## 1.4.2 - 2026-05-25

### Fixed

- Prefer `Application.getAndroidId()` for Expo Android device IDs and migrate older generated SDK IDs in storage so staged rollout checks and install confirmations use the same device identity. Expo iOS keeps the existing stored SDK ID behavior.

## 1.4.1 - 2026-05-25

### Changed

- Updated Expo staged-rollout documentation so JS-driven checks use `initializeUpdater()`, read the SDK-managed device ID, set `Updates.setUpdateRequestHeadersOverride()`, and return `false` instead of crashing when update support is unavailable.

## 1.4.0 - 2026-05-25

### Changed

- Removed the public `autoConfirm` opt-out. Install confirmation is best-effort whenever `ready()` observes an eligible Otalan update.

## 1.3.1 - 2026-05-22

### Fixed

- Corrected the `expo-updates` peer dependency range for Expo SDK 54 support.

## 1.3.0 - 2026-05-22

### Fixed

- Confirm Expo installs with Otalan bundle metadata from the running manifest, sending the required bundle ID, channel, runtime version, platform, and device ID tuple to the current API.
- Added Otalan API request timeouts for Expo confirmation requests.
- Switched generated device IDs to `crypto.randomUUID()` or `crypto.getRandomValues()` when available.
- Surfaced nested API error messages from Expo confirmation responses.
- Persisted successful install-confirmation tuples so later app starts skip already-confirmed launched updates when AsyncStorage is available.

### Changed

- Added Expo SDK 56 to the official support range.
- Started startup confirmation in the background so `initializeUpdater()` no longer waits on network work before resolving.
- Restricted Expo peer dependency ranges to supported Expo SDK 54, 55, and 56 update runtimes.

## 1.2.1 - 2026-05-21

### Changed

- Renamed key documentation to use OTA App Key for app-embedded update credentials and OTA Publish Key for release automation credentials.
- Clarified that OTA App Keys can be embedded in mobile JS/TS bundles but should not be published or shared outside the app.
- Documented the `otalan_ota_...` token format for OTA App Keys and the `otalan_ci_...` token format for OTA Publish Keys.

## 1.2.0 - 2026-05-18

### Breaking

- `channel` is now required in Expo updater config. Existing callers must pass the release channel used by the Expo update URL.

### Changed

- Documented that Expo update selection and runtime compatibility are owned by `expo-updates` and the Otalan manifest endpoint.
- Include `channel` on Expo install confirmations.

## 1.1.5 - 2026-05-15

### Changed

- Documented optional `.env` configuration for Expo apps, including the expected `EXPO_PUBLIC_OTALAN_*` variables.

## 1.1.4 - 2026-05-13

### Changed

- Documented that `enabled: true` force-enables `initializeUpdater()` and bypasses the startup helper's default platform, `expo-updates`, and credential checks.

## 1.1.3 - 2026-05-11

### Changed

- Reworded Expo update documentation for direct immutable CDN asset URLs in manifests.
- Clarified that manifest requests require the OTA App Key, while asset requests do not depend on SDK-provided request headers.
- Clarified that Expo asset integrity belongs to the Expo runtime and manifest hash/key metadata, not to SDK-side SHA verification.

## 1.1.2 - 2026-05-07

### Changed

- Clarified that official support covers Expo SDK 54 and 55 for the moment.
- Removed unsupported-runtime support wording and examples from the package docs.
- Made peer dependency ranges permissive so unsupported Expo SDK and runtime combinations are not blocked at install time.

## 1.1.1 - 2026-05-06

### Changed

- Reworked public README wording to remove backend-only contract details from the npm package page.
- Replaced the generic Expo example with a React hook example.
- Clarified staged rollout config with `x-api-key`, placeholder `x-device-id`, and `checkAutomatically: "NEVER"`.
- Reworded transfer source type comments and missing device ID errors as SDK-facing guidance.

## 1.1.0 - 2026-05-05

### Added

- Added `getDeviceId()` on initialized Expo updaters.
- Added custom `deviceIdStorage` and `deviceIdStorageKey` startup helper options.
- Added staged rollout documentation showing how to reuse the SDK-managed device ID with `expo-updates` request headers.

### Changed

- Made `deviceId` optional for `initializeUpdater()` while keeping it required for low-level `createUpdater()`.
- Expanded README examples, API return documentation, and network behavior notes for device ID handling.

## 1.0.1 - 2026-05-05

### Fixed

- Deduplicated concurrent Expo install confirmation calls for the same launched update.
- Logged device ID storage initialization failures from `initializeUpdater()` and returned a no-op updater instead of rejecting during app startup.

## 1.0.0 - 2026-05-04

Initial public release of `@otalan/expo`.

### Added

- Added Expo startup confirmation with `expo-updates`.
- Added authenticated Expo asset request documentation.
- Added package support ranges for Expo SDK 54 and 55.

### Changed

- Improved updater warning logs so native consoles show serializable error details for failed confirmation calls.
- Added SDK package name and version to warning logs.
- Documented native local development API URL caveats.
