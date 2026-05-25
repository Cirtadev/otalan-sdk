import {
  OTALAN_CAPACITOR_SDK_NAME as SDK_NAME,
  OTALAN_CAPACITOR_SDK_VERSION as SDK_VERSION,
} from './runtime'
import { initializeUpdater as initializeUpdaterInternal } from './updater'
import { createUpdater as createUpdaterInternal } from './updater'

import type { InitializedCapacitorUpdater } from './updater'
import type {
  CapacitorCheckResult,
  CapacitorDownloadProgress,
  CapacitorDownloadProgressListener,
  CapacitorSyncResult,
  CapacitorTransferSource,
  CapacitorUpdateCompatibility,
  CapacitorUpdaterConfig,
  DeviceIdStorage,
  InitializeCapacitorUpdaterConfig,
} from './types'

export const OTALAN_CAPACITOR_SDK_NAME = SDK_NAME
export const OTALAN_CAPACITOR_SDK_VERSION = SDK_VERSION

export function createUpdater(config: CapacitorUpdaterConfig) {
  return createUpdaterInternal(config)
}

export async function initializeUpdater(
  config: InitializeCapacitorUpdaterConfig,
): Promise<InitializedCapacitorUpdater> {
  return initializeUpdaterInternal(config)
}

export type {
  CapacitorCheckResult,
  CapacitorDownloadProgress,
  CapacitorDownloadProgressListener,
  CapacitorSyncResult,
  CapacitorTransferSource,
  CapacitorUpdateCompatibility,
  CapacitorUpdaterConfig,
  DeviceIdStorage,
  InitializedCapacitorUpdater,
  InitializeCapacitorUpdaterConfig,
}
