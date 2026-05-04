import { LiveUpdate } from '@capawesome/capacitor-live-update'

import { buildLiveUpdateFailureError } from './runtime'

import type {
  CapacitorTransferSource,
  CapacitorUpdaterConfig,
  OtaCheckResponse,
} from './types'

type BundleListResult = {
  bundleIds: string[]
}

const BUNDLE_LIST_METHODS = ['getDownloadedBundles', 'getBundles'] as const

type BundleListMethod = typeof BUNDLE_LIST_METHODS[number]

type BundleListProvider = Partial<Record<BundleListMethod, () => Promise<BundleListResult>>>

export type LiveUpdateReadyResult = Awaited<ReturnType<typeof LiveUpdate.ready>>

export async function readyLiveUpdate() {
  return LiveUpdate.ready().catch((error) => {
    throw buildLiveUpdateFailureError('LiveUpdate.ready', error)
  })
}

export async function getCurrentBundle() {
  return LiveUpdate.getCurrentBundle().catch((error) => {
    throw buildLiveUpdateFailureError('LiveUpdate.getCurrentBundle', error)
  })
}

export async function getNextBundle() {
  return LiveUpdate.getNextBundle().catch((error) => {
    throw buildLiveUpdateFailureError('LiveUpdate.getNextBundle', error)
  })
}

export async function setNextBundle(bundleId: string) {
  await LiveUpdate.setNextBundle({
    bundleId,
  }).catch((error) => {
    throw buildLiveUpdateFailureError('LiveUpdate.setNextBundle', error, {
      bundleId,
    })
  })
}

export async function reloadBundle(bundleId: string) {
  await LiveUpdate.reload().catch((error) => {
    throw buildLiveUpdateFailureError('LiveUpdate.reload', error, {
      bundleId,
    })
  })
}

export async function resolveNativeVersion(config: CapacitorUpdaterConfig) {
  if (config.nativeVersion) {
    return config.nativeVersion
  }

  const result = await LiveUpdate.getVersionName().catch((error) => {
    throw buildLiveUpdateFailureError('LiveUpdate.getVersionName', error)
  })
  return result.versionName
}

export async function ensureBundleIsAvailable(
  bundle: Extract<OtaCheckResponse, { updateAvailable: true }>,
): Promise<CapacitorTransferSource> {
  if (await hasDownloadedBundleSafely(bundle.bundleId)) {
    return 'cached'
  }

  try {
    await LiveUpdate.downloadBundle({
      url: bundle.downloadUrl,
      bundleId: bundle.bundleId,
      checksum: bundle.checksum ?? undefined,
    })
    return 'downloaded'
  } catch (error) {
    if (await hasDownloadedBundleSafely(bundle.bundleId)) {
      return 'downloaded'
    }

    throw buildLiveUpdateFailureError('LiveUpdate.downloadBundle', error, {
      bundleId: bundle.bundleId,
      url: bundle.downloadUrl,
    })
  }
}

export async function hasDownloadedBundleSafely(bundleId: string) {
  return hasDownloadedBundle(bundleId).catch(() => false)
}

async function hasDownloadedBundle(bundleId: string) {
  const liveUpdate = LiveUpdate as BundleListProvider

  for (const method of BUNDLE_LIST_METHODS) {
    const listBundles = liveUpdate[method]
    if (listBundles) {
      const result = await listBundles()
      return result.bundleIds.includes(bundleId)
    }
  }

  throw new Error('Installed @capawesome/capacitor-live-update does not expose bundle listing APIs.')
}
