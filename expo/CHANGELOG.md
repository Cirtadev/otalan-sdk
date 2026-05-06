# Changelog

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

- Added Expo and bare React Native startup confirmation with `expo-updates`.
- Added authenticated Expo asset request documentation.
- Added package support ranges for Expo SDK 54 and 55, plus supported bare React Native versions.

### Changed

- Improved updater warning logs so native consoles show serializable error details for failed confirmation calls.
- Added SDK package name and version to warning logs.
- Documented native local development API URL caveats.
