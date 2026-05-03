import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { LiveUpdate } from '@capawesome/capacitor-live-update'

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type OtaCheckResponse =
  | { updateAvailable: false }
  | {
    updateAvailable: true
    bundleId: string
    downloadUrl: string
    checksum?: string | null
    mandatory?: boolean
    rolloutPercent?: number
    releaseNotes?: string | null
  }

type OtaPlatform = 'ios' | 'android'

export type CapacitorTransferSource = 'downloaded' | 'cached'

type BundleListResult = {
  bundleIds: string[]
}

const BUNDLE_LIST_METHODS = ['getDownloadedBundles', 'getBundles'] as const

type BundleListMethod = typeof BUNDLE_LIST_METHODS[number]

type BundleListProvider = Partial<Record<BundleListMethod, () => Promise<BundleListResult>>>

export type CapacitorUpdaterConfig = {
  apiUrl: string
  apiKey: string
  appId: string
  channel: string
  nativeVersion?: string
  platform?: 'ios' | 'android'
  deviceId: string
  autoConfirm?: boolean
  reloadOnSync?: boolean
  headers?: HeadersInit
  logger?: Pick<Console, 'warn'>
}

export type CapacitorSyncResult =
  | { updateAvailable: false }
  | {
    updateAvailable: true
    applied: boolean
    bundleId: string
    mandatory: boolean
    transferSource: CapacitorTransferSource
    releaseNotes?: string | null
    reloadRequired?: boolean
  }

export type CapacitorSyncTrigger = 'launch' | 'resume' | 'manual'

export type InitializeCapacitorUpdaterConfig = Omit<CapacitorUpdaterConfig, 'appId' | 'logger'> & {
  appId?: string
  enabled?: boolean
  onResume?: boolean
  logger?: Pick<Console, 'warn' | 'info'>
}

export type InitializedCapacitorUpdater = {
  getUpdater: () => Promise<ReturnType<typeof createUpdater> | null>
  sync: (trigger?: CapacitorSyncTrigger) => Promise<CapacitorSyncResult | null>
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

const DEFAULT_TRANSFER_SOURCE: CapacitorTransferSource = 'downloaded'
const TRANSFER_SOURCE_STORAGE_KEY_PREFIX = 'otalan:capacitor:transfer-source:'

function joinUrl(base: string, pathname: string) {
  return `${base.replace(/\/+$/, '')}/${pathname.replace(/^\/+/, '')}`
}

function mergeHeaders(...sources: Array<HeadersInit | undefined>) {
  const headers = new Headers()

  for (const source of sources) {
    if (!source) {
      continue
    }

    new Headers(source).forEach((value, key) => {
      headers.set(key, value)
    })
  }

  return headers
}

function buildHeaders(config: CapacitorUpdaterConfig, extra?: HeadersInit) {
  const headers = mergeHeaders(config.headers, extra)

  headers.set('Content-Type', 'application/json')
  headers.set('x-api-key', config.apiKey)

  return headers
}

async function parseJsonResponse<T>(response: Response) {
  if (response.status === 204 || response.status === 205) {
    return undefined as T
  }

  const contentLength = response.headers.get('content-length')
  if (contentLength === '0') {
    return undefined as T
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

async function postJson<T>(url: string, body: unknown, headers: HeadersInit) {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as {
      message?: string
    }

    throw new Error(payload.message ?? `Request failed with status ${response.status}`)
  }

  return parseJsonResponse<T>(response)
}

async function resolveNativeVersion(config: CapacitorUpdaterConfig) {
  if (config.nativeVersion) {
    return config.nativeVersion
  }

  const result = await LiveUpdate.getVersionName()
  return result.versionName
}

function resolvePlatform(config: CapacitorUpdaterConfig) {
  const platform = config.platform ?? Capacitor.getPlatform()

  if (platform !== 'ios' && platform !== 'android') {
    throw new Error(`Unsupported Capacitor platform: ${platform}`)
  }

  return platform
}

function requireDeviceId(config: Pick<CapacitorUpdaterConfig, 'deviceId'>) {
  if (!config.deviceId) {
    throw new Error('Otalan Capacitor updater requires deviceId because POST /capacitor/confirm requires it.')
  }

  return config.deviceId
}

function isNativeOtaPlatform(platform: string): platform is OtaPlatform {
  return platform === 'ios' || platform === 'android'
}

function isCapacitorTransferSource(value: string | null): value is CapacitorTransferSource {
  return value === 'downloaded' || value === 'cached'
}

function getTransferSourceStorage() {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

function buildTransferSourceStorageKey(config: Pick<CapacitorUpdaterConfig, 'appId'>, bundleId: string) {
  return `${TRANSFER_SOURCE_STORAGE_KEY_PREFIX}${config.appId}:${bundleId}`
}

function readStoredTransferSource(config: CapacitorUpdaterConfig, bundleId: string) {
  const storage = getTransferSourceStorage()
  if (!storage) {
    return undefined
  }

  try {
    const value = storage.getItem(buildTransferSourceStorageKey(config, bundleId))
    return isCapacitorTransferSource(value) ? value : undefined
  } catch {
    return undefined
  }
}

function writeStoredTransferSource(
  config: CapacitorUpdaterConfig,
  bundleId: string,
  transferSource: CapacitorTransferSource,
) {
  const storage = getTransferSourceStorage()
  if (!storage) {
    return
  }

  try {
    storage.setItem(buildTransferSourceStorageKey(config, bundleId), transferSource)
  } catch {
    // The in-memory marker still covers the current JS context.
  }
}

function removeStoredTransferSource(config: CapacitorUpdaterConfig, bundleId: string) {
  const storage = getTransferSourceStorage()
  if (!storage) {
    return
  }

  try {
    storage.removeItem(buildTransferSourceStorageKey(config, bundleId))
  } catch {
    // Best effort cleanup only.
  }
}

async function confirmInstall(config: CapacitorUpdaterConfig, input: {
  platform: 'ios' | 'android'
  bundleId: string
  deviceId: string
  transferSource: CapacitorTransferSource
}) {
  if (!config.autoConfirm && config.autoConfirm !== undefined) {
    return false
  }

  await postJson(
    joinUrl(config.apiUrl, '/capacitor/confirm'),
    {
      appId: config.appId,
      platform: input.platform,
      bundleId: input.bundleId,
      deviceId: input.deviceId,
      transferSource: input.transferSource,
    },
    buildHeaders(config),
  )

  return true
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

async function hasDownloadedBundleSafely(bundleId: string) {
  return hasDownloadedBundle(bundleId).catch(() => false)
}

async function ensureBundleIsAvailable(
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

    throw error
  }
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export async function initializeUpdater(
  config: InitializeCapacitorUpdaterConfig,
): Promise<InitializedCapacitorUpdater> {
  const logger = config.logger ?? console
  const onResume = config.onResume ?? true

  let initializePromise: Promise<void> | null = null
  let updaterPromise: Promise<ReturnType<typeof createUpdater> | null> | null = null
  let inFlightSync: Promise<CapacitorSyncResult | null> | null = null
  let resumeListenerRegistered = false

  function isEnabled() {
    return config.enabled ?? (
      Capacitor.isNativePlatform()
      && Boolean(config.apiUrl)
      && Boolean(config.apiKey)
    )
  }

  async function getUpdater(): Promise<ReturnType<typeof createUpdater> | null> {
    if (!isEnabled()) {
      return null
    }

    if (updaterPromise) {
      return updaterPromise
    }

    updaterPromise = (async () => {
      const platform = config.platform ?? Capacitor.getPlatform()
      if (!isNativeOtaPlatform(platform)) {
        return null
      }

      const appId = config.appId ?? (await CapacitorApp.getInfo()).id
      const updaterConfig: CapacitorUpdaterConfig = {
        apiUrl: config.apiUrl,
        apiKey: config.apiKey,
        appId,
        channel: config.channel,
        nativeVersion: config.nativeVersion,
        platform,
        deviceId: config.deviceId,
        autoConfirm: config.autoConfirm,
        reloadOnSync: config.reloadOnSync,
        headers: config.headers,
        logger,
      }

      return createUpdater(updaterConfig)
    })().catch((error) => {
      updaterPromise = null
      throw error
    })

    return updaterPromise
  }

  async function sync(trigger: CapacitorSyncTrigger = 'manual') {
    const updater = await getUpdater()
    if (!updater) {
      return null
    }

    if (inFlightSync) {
      return inFlightSync
    }

    inFlightSync = updater.sync().then((result) => {
      if (result.updateAvailable && result.reloadRequired) {
        logger.info?.('[ota] update staged', {
          bundleId: result.bundleId,
          transferSource: result.transferSource,
        })
      }

      return result
    }).catch((error) => {
      logger.warn(`[ota] ${trigger} sync failed`, error)
      return null
    }).finally(() => {
      inFlightSync = null
    })

    return inFlightSync
  }

  async function initialize() {
    if (initializePromise) {
      return initializePromise
    }

    initializePromise = (async () => {
      const updater = await getUpdater()
      if (!updater) {
        return
      }

      if (onResume && !resumeListenerRegistered) {
        CapacitorApp.addListener('resume', () => {
          void sync('resume')
        })
        resumeListenerRegistered = true
      }

      await sync('launch')
    })().catch((error) => {
      initializePromise = null
      logger.warn('Otalan initializeUpdater() failed.', error)
    })

    return initializePromise
  }

  const updater = {
    getUpdater,
    sync,
  }

  await initialize()
  return updater
}

export function createUpdater(config: CapacitorUpdaterConfig) {
  const logger = config.logger ?? console
  const deviceId = requireDeviceId(config)
  let confirmedBundleId: string | null = null
  const pendingTransferSources = new Map<string, CapacitorTransferSource>()

  function rememberTransferSource(bundleId: string, transferSource: CapacitorTransferSource) {
    pendingTransferSources.set(bundleId, transferSource)
    writeStoredTransferSource(config, bundleId, transferSource)
  }

  function resolveTransferSource(bundleId: string) {
    return pendingTransferSources.get(bundleId)
      ?? readStoredTransferSource(config, bundleId)
      ?? DEFAULT_TRANSFER_SOURCE
  }

  async function resolveStagedTransferSource(bundleId: string) {
    const knownTransferSource = pendingTransferSources.get(bundleId)
      ?? readStoredTransferSource(config, bundleId)

    if (knownTransferSource) {
      return knownTransferSource
    }

    return await hasDownloadedBundleSafely(bundleId)
      ? 'cached'
      : DEFAULT_TRANSFER_SOURCE
  }

  function clearTransferSource(bundleId: string) {
    pendingTransferSources.delete(bundleId)
    removeStoredTransferSource(config, bundleId)
  }

  return {
    async ready() {
      const result = await LiveUpdate.ready()

      if (result.currentBundleId && result.currentBundleId !== confirmedBundleId) {
        const bundleId = result.currentBundleId
        const platform = resolvePlatform(config)

        const confirmed = await confirmInstall(config, {
          platform,
          bundleId,
          deviceId,
          transferSource: resolveTransferSource(bundleId),
        }).catch((error) => {
          logger.warn('Otalan install confirmation failed.', error)
          return false
        })

        if (confirmed) {
          clearTransferSource(bundleId)
          confirmedBundleId = bundleId
        }
      }

      return result
    },

    async getCurrentBundleId() {
      const current = await LiveUpdate.getCurrentBundle()
      return current.bundleId ?? undefined
    },

    async check() {
      const platform = resolvePlatform(config)
      const nativeVersion = await resolveNativeVersion(config)
      const currentBundle = await LiveUpdate.getCurrentBundle()

      return postJson<OtaCheckResponse>(
        joinUrl(config.apiUrl, '/capacitor/check'),
        {
          appId: config.appId,
          platform,
          channel: config.channel,
          nativeVersion,
          currentBundleId: currentBundle.bundleId ?? undefined,
          deviceId,
        },
        buildHeaders(config),
      )
    },

    async sync(): Promise<CapacitorSyncResult> {
      await this.ready().catch((error) => {
        logger.warn('Otalan ready() failed.', error)
      })

      const currentBundle = await LiveUpdate.getCurrentBundle()
      const nextBundle = await LiveUpdate.getNextBundle()
      const check = await this.check()

      if (!check.updateAvailable) {
        return { updateAvailable: false }
      }

      if (check.bundleId === currentBundle.bundleId) {
        return { updateAvailable: false }
      }

      if (check.bundleId === nextBundle.bundleId) {
        const transferSource = await resolveStagedTransferSource(check.bundleId)
        rememberTransferSource(check.bundleId, transferSource)

        if (config.reloadOnSync !== false) {
          await LiveUpdate.reload()
        }

        return {
          updateAvailable: true,
          applied: true,
          bundleId: check.bundleId,
          mandatory: check.mandatory ?? true,
          transferSource,
          releaseNotes: check.releaseNotes,
          reloadRequired: config.reloadOnSync === false,
        }
      }

      const transferSource = await ensureBundleIsAvailable(check)

      await LiveUpdate.setNextBundle({
        bundleId: check.bundleId,
      })
      rememberTransferSource(check.bundleId, transferSource)

      if (config.reloadOnSync !== false) {
        await LiveUpdate.reload()
      }

      return {
        updateAvailable: true,
        applied: true,
        bundleId: check.bundleId,
        mandatory: check.mandatory ?? true,
        transferSource,
        releaseNotes: check.releaseNotes,
        reloadRequired: config.reloadOnSync === false,
      }
    },
  }
}
