# `otalan-sdk`

SDK packages for Otalan mobile OTA integrations.

## Packages

### `@otalan/capacitor`

This is the real OTA client SDK for Capacitor apps.

It is responsible for:

- calling `POST /capacitor/check`
- deciding whether an update should be applied
- downloading bundles through `@capawesome/capacitor-live-update`
- setting the next bundle
- reloading the app when needed
- confirming successful installs through `POST /capacitor/confirm`
- providing a startup helper through `initializeUpdater()`

Capacitor needs this SDK because the underlying native plugin is low-level. It does not provide the full Otalan update flow by itself.

See [capacitor/README.md](/Volumes/dev/cirtadev/otalan-sdk/capacitor/README.md).

### `@otalan/expo`

This is a tiny helper for Expo and bare React Native apps that use `expo-updates`.

It is responsible for:

- exposing a small startup helper through `initializeUpdater()`
- reading the currently running Expo update metadata
- optionally confirming a successfully launched OTA update through `POST /expo/confirm`

It is not responsible for:

- update selection
- gating or rollout decisions
- manifest generation
- asset downloads
- fetching or reloading updates

Those responsibilities belong to Otalan `/expo/updates` and `/expo/assets/...` endpoints plus the `expo-updates` runtime.

See [expo/README.md](/Volumes/dev/cirtadev/otalan-sdk/expo/README.md).

## Architecture Summary

Capacitor:

- Otalan decides update eligibility through `/capacitor/check`
- SDK orchestrates download/apply/confirm

Expo and bare React Native with `expo-updates`:

- Otalan `/expo/updates` is the source of truth for selection and manifest response
- Otalan `/expo/assets/...` serves assets
- `expo-updates` fetches and applies updates
- SDK is only optional confirmation and startup glue
