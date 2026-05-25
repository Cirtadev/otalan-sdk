import { LiveUpdate } from '@capawesome/capacitor-live-update'

import { buildLiveUpdateFailureError, serializeErrorForLog } from './runtime'

import type {
  CapacitorDownloadProgress,
  CapacitorDownloadProgressListener,
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

type DownloadProgressListenerHandle = {
  remove: () => Promise<void>
}

type EnsureBundleIsAvailableOptions = Pick<CapacitorUpdaterConfig, 'logger' | 'onDownloadProgress'>

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

export async function reloadStagedBundle(bundleIdForLog: string) {
  await LiveUpdate.reload().catch((error) => {
    throw buildLiveUpdateFailureError('LiveUpdate.reload', error, {
      bundleId: bundleIdForLog,
    })
  })
}

export async function resolveRuntimeVersion(config: CapacitorUpdaterConfig) {
  if (config.runtimeVersion) {
    return config.runtimeVersion
  }

  const result = await LiveUpdate.getVersionName().catch((error) => {
    throw buildLiveUpdateFailureError('LiveUpdate.getVersionName', error)
  })
  return result.versionName
}

export async function ensureBundleIsAvailable(
  bundle: Extract<OtaCheckResponse, { updateAvailable: true }>,
  options: EnsureBundleIsAvailableOptions = {},
): Promise<CapacitorTransferSource> {
  if (await hasDownloadedBundleSafely(bundle.bundleId)) {
    return 'cached'
  }

  const progressListener = await addDownloadProgressListener(bundle.bundleId, options)

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
  } finally {
    await removeDownloadProgressListener(progressListener)
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

async function addDownloadProgressListener(
  bundleId: string,
  options: EnsureBundleIsAvailableOptions,
): Promise<DownloadProgressListenerHandle | undefined> {
  const onDownloadProgress = options.onDownloadProgress

  if (!onDownloadProgress) {
    return undefined
  }

  return LiveUpdate.addListener(
    'downloadBundleProgress',
    (event) => {
      if (event.bundleId !== bundleId) {
        return
      }

      notifyDownloadProgress(onDownloadProgress, event)
    },
  ).catch((error) => {
    options.logger?.warn?.(
      'Otalan download progress listener registration failed.',
      serializeErrorForLog(error),
    )
    return undefined
  })
}

async function removeDownloadProgressListener(listener: DownloadProgressListenerHandle | undefined) {
  await listener?.remove().catch(() => undefined)
}

function notifyDownloadProgress(
  listener: CapacitorDownloadProgressListener,
  event: CapacitorDownloadProgress,
) {
  try {
    listener({
      bundleId: event.bundleId,
      downloadedBytes: event.downloadedBytes,
      totalBytes: event.totalBytes,
      progress: event.progress,
    })
  } catch {
    // App progress callbacks should not break the update flow.
  }
}
