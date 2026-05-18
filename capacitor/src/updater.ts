import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'

import {
  DEFAULT_TRANSFER_SOURCE,
  SDK_LOG_CONTEXT,
  buildHeaders,
  isNativeOtaPlatform,
  isRecord,
  joinUrl,
  postJson,
  readStringField,
  requireDeviceId,
  resolvePlatform,
  serializeErrorForLog,
} from './runtime'
import {
  ensureBundleIsAvailable,
  getCurrentBundle,
  getNextBundle,
  hasDownloadedBundleSafely,
  readyLiveUpdate,
  reloadBundle,
  resolveNativeVersion,
  setNextBundle,
} from './live-update'
import type { LiveUpdateReadyResult } from './live-update'

import type {
  CapacitorSyncResult,
  CapacitorSyncTrigger,
  CapacitorTransferSource,
  CapacitorUpdaterConfig,
  DeviceIdStorage,
  InitializeCapacitorUpdaterConfig,
  OtaCheckResponse,
  OtaPlatform,
} from './types'

const DEFAULT_DEVICE_ID_STORAGE_KEY = 'otalan-device-id'
const TRANSFER_SOURCE_STORAGE_KEY_PREFIX = 'otalan:capacitor:transfer-source:'

type UpdateCheckContext = {
  appId: string
  platform: OtaPlatform
  runtimeVersion: string
}

export type InitializedCapacitorUpdater = {
  getDeviceId: () => Promise<string | null>
  getUpdater: () => Promise<ReturnType<typeof createUpdater> | null>
  sync: (trigger?: CapacitorSyncTrigger) => Promise<CapacitorSyncResult | null>
}

export async function initializeUpdater(
  config: InitializeCapacitorUpdaterConfig,
): Promise<InitializedCapacitorUpdater> {
  const logger = config.logger ?? console
  const onResume = config.onResume ?? true

  let deviceId: string | null = config.deviceId || null
  let deviceIdPromise: Promise<string | null> | null = null
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

  async function resolveEnabledDeviceId() {
    if (deviceId !== null) {
      return deviceId
    }

    if (deviceIdPromise) {
      return deviceIdPromise
    }

    deviceIdPromise = resolveDeviceId(config).then((resolvedDeviceId) => {
      deviceId = resolvedDeviceId
      return resolvedDeviceId
    }).catch((error) => {
      logger.warn('Otalan device ID initialization failed.', serializeErrorForLog(error))
      return null
    })

    return deviceIdPromise
  }

  async function getDeviceId() {
    if (!isEnabled()) {
      return config.deviceId || null
    }

    return resolveEnabledDeviceId()
  }

  async function getUpdater(): Promise<ReturnType<typeof createUpdater> | null> {
    if (!isEnabled()) {
      return null
    }

    if (updaterPromise) {
      return updaterPromise
    }

    updaterPromise = buildUpdater().catch((error) => {
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
          ...SDK_LOG_CONTEXT,
          bundleId: result.bundleId,
          transferSource: result.transferSource,
        })
      }

      return result
    }).catch((error) => {
      logger.warn(`[ota] ${trigger} sync failed`, serializeErrorForLog(error))
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
        try {
          await CapacitorApp.addListener('resume', () => {
            void sync('resume')
          })
          resumeListenerRegistered = true
        } catch (error) {
          logger.warn('Otalan resume listener registration failed.', serializeErrorForLog(error))
        }
      }

      await sync('launch')
    })().catch((error) => {
      initializePromise = null
      logger.warn('Otalan initializeUpdater() failed.', serializeErrorForLog(error))
    })

    return initializePromise
  }

  async function buildUpdater() {
    const platform = config.platform ?? Capacitor.getPlatform()
    if (!isNativeOtaPlatform(platform)) {
      return null
    }

    const appId = config.appId ?? (await CapacitorApp.getInfo()).id
    const deviceId = await resolveEnabledDeviceId()
    if (!deviceId) {
      return null
    }

    const updaterConfig: CapacitorUpdaterConfig = {
      apiUrl: config.apiUrl,
      apiKey: config.apiKey,
      appId,
      channel: config.channel,
      nativeVersion: config.nativeVersion,
      platform,
      deviceId,
      autoConfirm: config.autoConfirm,
      reloadOnSync: config.reloadOnSync,
      headers: config.headers,
      logger,
    }

    return createUpdater(updaterConfig)
  }

  const updater = {
    getDeviceId,
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
  const confirmingBundlePromises = new Map<string, Promise<void>>()
  const pendingTransferSources = new Map<string, CapacitorTransferSource>()

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

  async function confirmReadyBundle(result: LiveUpdateReadyResult) {
    if (!result.currentBundleId || result.currentBundleId === confirmedBundleId) {
      return
    }

    const bundleId = result.currentBundleId
    const existingConfirmation = confirmingBundlePromises.get(bundleId)
    if (existingConfirmation) {
      await existingConfirmation
      return
    }

    const confirmationPromise = (async () => {
      const confirmed = await confirmInstall(config, {
        bundleId,
        deviceId,
        transferSource: resolveTransferSource(config, pendingTransferSources, bundleId),
      }).catch((error) => {
        logger.warn('Otalan install confirmation failed.', serializeErrorForLog(error))
        return false
      })

      if (confirmed) {
        clearTransferSource(config, pendingTransferSources, bundleId)
        confirmedBundleId = bundleId
      }
    })().finally(() => {
      confirmingBundlePromises.delete(bundleId)
    })

    confirmingBundlePromises.set(bundleId, confirmationPromise)
    await confirmationPromise
  }

  async function readyInternal(options: {
    waitForConfirmation: boolean
  }) {
    const result = await readyLiveUpdate()

    if (options.waitForConfirmation) {
      await confirmReadyBundle(result)
    } else {
      void confirmReadyBundle(result)
    }

    return result
  }

  async function ready() {
    return readyInternal({ waitForConfirmation: true })
  }

  async function getCurrentBundleId() {
    const current = await getCurrentBundle()
    return current.bundleId ?? undefined
  }

  async function check() {
    return checkForUpdate(config, deviceId)
  }

  async function sync(): Promise<CapacitorSyncResult> {
    await readyInternal({ waitForConfirmation: false }).catch((error) => {
      logger.warn('Otalan ready() failed.', serializeErrorForLog(error))
    })

    const currentBundle = await getCurrentBundle()
    const nextBundle = await getNextBundle()
    const update = await check()

    if (!update.updateAvailable) {
      return { updateAvailable: false }
    }

    if (update.bundleId === currentBundle.bundleId) {
      return { updateAvailable: false }
    }

    if (update.bundleId === nextBundle.bundleId) {
      const transferSource = await resolveStagedTransferSource(update.bundleId)
      rememberTransferSource(config, pendingTransferSources, update.bundleId, transferSource)

      if (config.reloadOnSync !== false) {
        await reloadBundle(update.bundleId)
      }

      return buildAppliedResult(config, update, transferSource)
    }

    const transferSource = await ensureBundleIsAvailable(update)

    await setNextBundle(update.bundleId)
    rememberTransferSource(config, pendingTransferSources, update.bundleId, transferSource)

    if (config.reloadOnSync !== false) {
      await reloadBundle(update.bundleId)
    }

    return buildAppliedResult(config, update, transferSource)
  }

  return {
    ready,
    getCurrentBundleId,
    check,
    sync,
  }
}

async function confirmInstall(
  config: CapacitorUpdaterConfig,
  input: {
    bundleId: string
    deviceId: string
    transferSource: CapacitorTransferSource
  },
) {
  if (!config.autoConfirm && config.autoConfirm !== undefined) {
    return false
  }

  await postJson(
    joinUrl(config.apiUrl, '/capacitor/confirm'),
    {
      appId: config.appId,
      platform: resolvePlatform(config),
      bundleId: input.bundleId,
      deviceId: input.deviceId,
      transferSource: input.transferSource,
    },
    buildHeaders(config),
  )

  return true
}

async function checkForUpdate(config: CapacitorUpdaterConfig, deviceId: string) {
  const currentBundle = await getCurrentBundle()
  const platform = resolvePlatform(config)
  const runtimeVersion = await resolveNativeVersion(config)
  const response = await postJson<unknown>(
    joinUrl(config.apiUrl, '/capacitor/check'),
    {
      appId: config.appId,
      platform,
      channel: config.channel,
      runtimeVersion,
      currentBundleId: currentBundle.bundleId ?? undefined,
      deviceId,
    },
    buildHeaders(config),
  )

  return normalizeCheckResponse(response, {
    appId: config.appId,
    platform,
    runtimeVersion,
  })
}

function normalizeCheckResponse(response: unknown, context: UpdateCheckContext): OtaCheckResponse {
  if (!isRecord(response)) {
    throw new Error('Otalan check response was malformed.')
  }

  assertCompatibleCheckField(response, context, 'appId')
  assertCompatibleCheckField(response, context, 'platform')
  assertCompatibleCheckField(response, context, 'runtimeVersion')

  if (typeof response.updateAvailable !== 'boolean') {
    throw new Error('Otalan check response was malformed.')
  }

  if (!response.updateAvailable) {
    return response as Extract<OtaCheckResponse, { updateAvailable: false }>
  }

  const bundleId = readStringField(response, 'bundleId')
  const downloadUrl = readStringField(response, 'downloadUrl')

  if (!bundleId || !downloadUrl) {
    throw new Error('Otalan check response was malformed.')
  }

  return response as Extract<OtaCheckResponse, { updateAvailable: true }>
}

function assertCompatibleCheckField<TField extends keyof UpdateCheckContext>(
  response: Record<string, unknown>,
  context: UpdateCheckContext,
  field: TField,
) {
  const value = response[field]

  if (value === undefined || value === null) {
    throw new Error(`Otalan check response field "${field}" is required.`)
  }

  if (typeof value !== 'string') {
    throw new Error(`Otalan check response field "${field}" was malformed.`)
  }

  if (value !== context[field]) {
    throw new Error(
      `Otalan check response is incompatible with the running app: ${field}=${value} does not match ${context[field]}.`,
    )
  }
}

function buildAppliedResult(
  config: CapacitorUpdaterConfig,
  check: Extract<OtaCheckResponse, { updateAvailable: true }>,
  transferSource: CapacitorTransferSource,
) {
  return {
    updateAvailable: true,
    applied: true,
    bundleId: check.bundleId,
    mandatory: check.mandatory ?? true,
    transferSource,
    releaseNotes: check.releaseNotes,
    reloadRequired: config.reloadOnSync === false,
  } satisfies CapacitorSyncResult
}

function resolveTransferSource(
  config: CapacitorUpdaterConfig,
  pendingTransferSources: Map<string, CapacitorTransferSource>,
  bundleId: string,
) {
  return pendingTransferSources.get(bundleId)
    ?? readStoredTransferSource(config, bundleId)
    ?? DEFAULT_TRANSFER_SOURCE
}

function rememberTransferSource(
  config: CapacitorUpdaterConfig,
  pendingTransferSources: Map<string, CapacitorTransferSource>,
  bundleId: string,
  transferSource: CapacitorTransferSource,
) {
  pendingTransferSources.set(bundleId, transferSource)
  writeStoredTransferSource(config, bundleId, transferSource)
}

function clearTransferSource(
  config: CapacitorUpdaterConfig,
  pendingTransferSources: Map<string, CapacitorTransferSource>,
  bundleId: string,
) {
  pendingTransferSources.delete(bundleId)
  removeStoredTransferSource(config, bundleId)
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

function getTransferSourceStorage() {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

function getDefaultDeviceIdStorage(): DeviceIdStorage | undefined {
  const storage = getTransferSourceStorage()

  if (!storage) {
    return undefined
  }

  return {
    getItem: async (key) => storage.getItem(key),
    setItem: async (key, value) => {
      storage.setItem(key, value)
    },
  }
}

function createDeviceId() {
  const randomPart = Math.random().toString(36).slice(2, 10)
  return `otalan-capacitor-${Date.now().toString(36)}-${randomPart}`
}

async function getOrCreateDeviceId(
  storage: DeviceIdStorage,
  storageKey: string,
) {
  const existing = await storage.getItem(storageKey)

  if (existing) {
    return existing
  }

  const nextDeviceId = createDeviceId()
  await storage.setItem(storageKey, nextDeviceId)
  return nextDeviceId
}

async function resolveDeviceId(config: Pick<
  InitializeCapacitorUpdaterConfig,
  'deviceId' | 'deviceIdStorage' | 'deviceIdStorageKey'
>) {
  if (config.deviceId) {
    return config.deviceId
  }

  const storage = config.deviceIdStorage ?? getDefaultDeviceIdStorage()

  if (!storage) {
    throw new Error('Otalan Capacitor updater requires deviceId or writable deviceIdStorage.')
  }

  return getOrCreateDeviceId(
    storage,
    config.deviceIdStorageKey ?? DEFAULT_DEVICE_ID_STORAGE_KEY,
  )
}

function buildTransferSourceStorageKey(config: Pick<CapacitorUpdaterConfig, 'appId'>, bundleId: string) {
  return `${TRANSFER_SOURCE_STORAGE_KEY_PREFIX}${config.appId}:${bundleId}`
}

function isCapacitorTransferSource(value: string | null): value is CapacitorTransferSource {
  return value === 'downloaded' || value === 'cached'
}
