# Changelog

## 1.9.0 - 2026-06-05

### Added

- Added SDK-managed rollback validation for newly launched SDK-managed bundles, with `rollbackProtection` configuration for disabling or tuning the validation window.
- Added a default `rollbackProtection.validationDelayMs` of `10000` milliseconds, exposed through both `initializeUpdater()` and low-level `createUpdater()` configuration.

### Changed

- Split Capacitor rollback protection into a platform-specific `capacitor-rollback-protection` source module.

### Tests

- Added regression coverage for pending rollback markers, validation delay handling, native ready timing, native rollback blocklisting, previous/default bundle recovery, and startup validation races.

## 1.8.0 - 2026-06-02

### Added

- Added best-effort `/capacitor/report-update-event` reporting for failed checks, failed apply phases, and install-confirmation telemetry failures.

## 1.7.0 - 2026-05-27

### Added

- Added `initialized.check()` to check Otalan availability without downloading, staging, or reloading an update.

## 1.6.2 - 2026-05-25

### Changed

- Consolidated the README quick start around Vite environment variables, explicit `initialized.sync()` usage, and download progress logging without repeating full `initializeUpdater()` examples.

## 1.6.1 - 2026-05-25

### Changed

- Updated the README sample to show explicit `initialized.sync()` usage with Vite environment variables and download progress logging.

## 1.6.0 - 2026-05-25

### Changed

- Changed `initializeUpdater()` so it initializes the Capacitor updater without starting a launch sync; apps should call `initialized.sync()` when they want to check for and apply updates.
- Removed the public `sync(trigger?)` argument from the initialized helper API. Sync cause labels are now internal logging details.
- Removed the public `autoConfirm` opt-out. Install confirmation is best-effort whenever `ready()` observes an eligible Otalan bundle.
- Started current-bundle `LiveUpdate.ready()` and install confirmation in the background during `initializeUpdater()` without running an update check.

### Added

- Added `onDownloadProgress` to report native Capacitor bundle download progress during SDK-managed downloads.

### Tests

- Added regression coverage for download progress forwarding, listener cleanup, and listener registration failures.

## 1.5.0 - 2026-05-22

### Fixed

- Rejected Capacitor check responses that omit bundle checksums, use non-HTTPS bundle download URLs by default, or provide malformed optional update fields.
- Added Otalan API request timeouts for both native HTTP and fetch paths.
- Started launch sync in the background so `initializeUpdater()` no longer waits on network or bundle download work before resolving.
- Switched generated device IDs to `crypto.randomUUID()` or `crypto.getRandomValues()` when available.
- Persisted successful install-confirmation tuples so later app starts skip already-confirmed bundle/device installs when local storage is available.

### Changed

- Default missing `mandatory` values to `false` instead of `true`.
- Added `requestTimeoutMs` and `allowInsecureBundleUrls` config options.
- Restricted Capacitor peer dependency ranges to supported Capacitor and Capawesome Live Update majors 7 and 8.

### Tests

- Added regression coverage for checksum enforcement, HTTPS bundle URL enforcement, request timeouts, nonblocking startup sync, malformed check response fields, and persisted install-confirmation skips.

## 1.4.1 - 2026-05-21

### Changed

- Renamed key documentation to use OTA App Key for app-embedded update credentials and OTA Publish Key for release automation credentials.
- Clarified that OTA App Keys can be embedded in mobile JS/TS bundles but should not be published or shared outside the app.
- Documented the `otalan_ota_...` token format for OTA App Keys and the `otalan_ci_...` token format for OTA Publish Keys.

## 1.4.0 - 2026-05-18

### Changed

- Include `channel` and `runtimeVersion` on Capacitor install confirmations.
- Treat missing `channel` like other missing required startup config when `initializeUpdater()` auto-detects enablement.

## 1.3.0 - 2026-05-18

### Breaking

- Standardized Capacitor compatibility metadata on `runtimeVersion` for `/capacitor/check` requests, successful check responses, and local SDK validation.
- Renamed the Capacitor config override to `runtimeVersion`; the SDK still derives the default value from `LiveUpdate.getVersionName()`.

### Tests

- Updated Capacitor compatibility regression coverage to assert `runtimeVersion` in both request and response metadata.

## 1.2.1 - 2026-05-18

### Fixed

- Restored `/capacitor/check` request compatibility after the 1.2.0 request field regression.
- Improved native HTTP error messages for nested API error payloads.

### Tests

- Added regression coverage for the Capacitor check request compatibility context and nested API error messages.

## 1.2.0 - 2026-05-18

### Breaking

- Required successful `/capacitor/check` responses to include matching `appId`, `platform`, and `runtimeVersion` before the SDK trusts `updateAvailable` or uses any selected bundle.

### Added

- Added required client-side validation for served `appId`, `platform`, and `runtimeVersion` metadata before update selection results or bundles are trusted.

### Tests

- Added regression coverage for Capacitor update check compatibility context, missing compatibility metadata, and mismatched runtime version responses.

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
