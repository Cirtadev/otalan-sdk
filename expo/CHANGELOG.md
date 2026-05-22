# Changelog

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
