# Changelog

## 1.2.0 - 2026-05-18

### Breaking

- Changed Capacitor update checks to send `runtimeVersion` instead of `nativeVersion` to `/capacitor/check`.
- Required successful `/capacitor/check` responses to include matching `appId`, `platform`, and `runtimeVersion` before the SDK trusts `updateAvailable` or uses any selected bundle.

### Added

- Added required client-side validation for served `appId`, `platform`, and `runtimeVersion` metadata before update selection results or bundles are trusted.

### Tests

- Added regression coverage for Capacitor update check compatibility context, missing compatibility metadata, and mismatched native version responses.

## 1.1.5 - 2026-05-15

### Changed

- Documented optional `.env` configuration for Vite-based Capacitor apps, including the expected `VITE_OTALAN_*` variables.

## 1.1.4 - 2026-05-13

### Changed

- Documented that `enabled: true` force-enables `initializeUpdater()` and bypasses the startup helper's default platform and credential checks.

### Tests

- Split the oversized Capacitor test suite into focused suites with a shared test harness.

## 1.1.3 - 2026-05-11

### Changed

- Documented that selected bundle download URLs are opaque and may point at immutable CDN URLs.
- Clarified that bundle checksums are passed through unchanged to `LiveUpdate.downloadBundle()`.

### Tests

- Added regression coverage proving Capacitor sync passes selected bundle checksums to the live update plugin.

## 1.1.2 - 2026-05-07

### Changed

- Clarified that official support covers Capacitor 7 and 8 for the moment.
- Reworded unsupported-version guidance so older Capacitor versions are not described as broken.
- Made peer dependency ranges permissive so unsupported Capacitor versions are not blocked at install time.

## 1.1.1 - 2026-05-06

### Changed

- Reworked public README wording to remove backend-only contract details from the npm package page.
- Replaced the generic Capacitor example with a Vue/Vite composable example.
- Reworded transfer source type comments and missing device ID errors as SDK-facing guidance.

## 1.1.0 - 2026-05-05

### Added

- Added storage-backed device ID generation to `initializeUpdater()` when no explicit `deviceId` is provided.
- Added `getDeviceId()` on initialized Capacitor updaters.
- Added `deviceIdStorage` and `deviceIdStorageKey` startup helper options.
- Exported `CapacitorCheckResult` and `DeviceIdStorage` types.

### Changed

- Made `deviceId` optional for `initializeUpdater()` while keeping it required for low-level `createUpdater()`.
- Logged device ID storage initialization failures from `initializeUpdater()` and returned a no-op updater.
- Expanded README examples, API return documentation, and network behavior notes for device ID handling.

## 1.0.1 - 2026-05-05

### Fixed

- Awaited Capacitor resume listener registration so native registration failures are logged instead of becoming unhandled promise rejections.
- Kept launch sync running even when resume listener registration fails.

### Changed

- Clarified Capacitor 7 and 8 support wording in the package README.

## 1.0.0 - 2026-05-04

Initial public release of `@otalan/capacitor`.

### Added

- Added Capacitor OTA checks, bundle download and staging, reloads, and install confirmation.
- Added transfer source reporting for downloaded and cached Capacitor bundles.
- Added package support ranges for Capacitor 7 and 8.

### Changed

- Switched Otalan API calls to Capacitor's native HTTP transport on iOS and Android.
- Kept install confirmation best-effort during sync so confirming the current bundle cannot block checks for newer bundles.
- Improved updater warning logs so native consoles show serializable error details for failed sync and confirmation calls.
- Added SDK package name and version to warning logs and included Live Update operation context for plugin failures.
- Documented first-install `null` bundle IDs and native local development API URL caveats.
