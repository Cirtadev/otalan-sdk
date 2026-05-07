# Changelog

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
