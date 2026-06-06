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
  resolveRequestTimeoutMs,
  resolvePlatform,
  serializeErrorForLog,
} from './runtime'
import {
  ensureBundleIsAvailable,
  getCurrentBundle,
  getNextBundle,
  hasDownloadedBundleSafely,
  readyLiveUpdate,
  reloadStagedBundle,
  resolveRuntimeVersion,
  setNextBundle,
} from './live-update'
import {
  clearRollbackProtectionAfterReady,
  isRollbackProtectionBlockedBundle,
  prepareRollbackProtectionBeforeReady,
  rememberPendingRollbackProtectionBundle,
  waitForRollbackProtectionValidation,
} from './capacitor-rollback-protection'
import { reportCapacitorUpdateEvent } from './update-events'
import type { LiveUpdateReadyResult } from './live-update'

import type {
  CapacitorCheckResult,
  CapacitorSyncResult,
  CapacitorTransferSource,
  CapacitorUpdaterConfig,
  DeviceIdStorage,
  InitializeCapacitorUpdaterConfig,
  OtaCheckResponse,
  OtaPlatform,
} from './types'

const DEFAULT_DEVICE_ID_STORAGE_KEY = 'otalan-device-id'
const TRANSFER_SOURCE_STORAGE_KEY_PREFIX = 'otalan:capacitor:transfer-source:'
const CONFIRMED_INSTALL_STORAGE_KEY_PREFIX = 'otalan:capacitor:confirmed-install:'

type UpdateCheckContext = {
  appId: string
  platform: OtaPlatform
  runtimeVersion: string
  allowInsecureBundleUrls?: boolean
}

type CompatibleCheckField = 'appId' | 'platform' | 'runtimeVersion'
type SyncCause = 'resume' | 'manual'

export type InitializedCapacitorUpdater = {
  getDeviceId: () => Promise<string | null>
  getUpdater: () => Promise<ReturnType<typeof createUpdater> | null>
  check: () => Promise<CapacitorCheckResult | null>
  sync: () => Promise<CapacitorSyncResult | null>
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
  let inFlightCheck: Promise<CapacitorCheckResult | null> | null = null
  let inFlightSync: Promise<CapacitorSyncResult | null> | null = null
  let resumeListenerRegistered = false

  function isEnabled() {
    return config.enabled ?? (
      Capacitor.isNativePlatform()
      && Boolean(config.apiUrl)
      && Boolean(config.apiKey)
      && Boolean(config.channel)
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

  function startSync(
    trigger: SyncCause,
    updater: ReturnType<typeof createUpdater>,
  ) {
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

  function startCheck(updater: ReturnType<typeof createUpdater>) {
    if (inFlightCheck) {
      return inFlightCheck
    }

    inFlightCheck = updater.check().catch((error) => {
      logger.warn('[ota] manual check failed', serializeErrorForLog(error))
      return null
    }).finally(() => {
      inFlightCheck = null
    })

    return inFlightCheck
  }

  async function check() {
    const updater = await getUpdater().catch((error) => {
      logger.warn('[ota] manual check failed', serializeErrorForLog(error))
      return null
    })

    if (!updater) {
      return null
    }

    return startCheck(updater)
  }

  async function runSync(trigger: SyncCause) {
    const updater = await getUpdater().catch((error) => {
      logger.warn(`[ota] ${trigger} sync failed`, serializeErrorForLog(error))
      return null
    })

    if (!updater) {
      return null
    }

    return startSync(trigger, updater)
  }

  async function sync() {
    return runSync('manual')
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
            void runSync('resume')
          })
          resumeListenerRegistered = true
        } catch (error) {
          logger.warn('Otalan resume listener registration failed.', serializeErrorForLog(error))
        }
      }

      void updater.ready().catch((error) => {
        logger.warn('Otalan ready() failed.', serializeErrorForLog(error))
      })
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
      runtimeVersion: config.runtimeVersion,
      platform,
      deviceId,
      reloadOnSync: config.reloadOnSync,
      requestTimeoutMs: config.requestTimeoutMs,
      allowInsecureBundleUrls: config.allowInsecureBundleUrls,
      rollbackProtection: config.rollbackProtection,
      headers: config.headers,
      onDownloadProgress: config.onDownloadProgress,
      logger,
    }

    return createUpdater(updaterConfig)
  }

  const updater = {
    getDeviceId,
    getUpdater,
    check,
    sync,
  }

  await initialize()
  return updater
}

export function createUpdater(config: CapacitorUpdaterConfig) {
  const logger = config.logger ?? console
  const deviceId = requireDeviceId(config)
  let confirmedBundleId: string | null = null
  let readyBundlePromise: Promise<LiveUpdateReadyResult> | null = null
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
        reportCapacitorUpdateEvent(config, {
          deviceId,
          currentBundleId: bundleId,
          targetBundleId: bundleId,
          phase: 'confirm',
          error,
        })
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

  async function resolveReadyBundle() {
    const rollbackProtection = await prepareRollbackProtectionBeforeReady(config, logger)
    if (rollbackProtection.action === 'rolled-back') {
      return rollbackProtection.result
    }

    const result = await readyLiveUpdate()
    if (result.rollback) {
      clearRollbackProtectionAfterReady(config, result)
      return result
    }

    await waitForRollbackProtectionValidation(rollbackProtection.validationDelayMs)
    clearRollbackProtectionAfterReady(config, result)

    return result
  }

  function getReadyBundle() {
    if (readyBundlePromise) {
      return readyBundlePromise
    }

    readyBundlePromise = resolveReadyBundle().finally(() => {
      readyBundlePromise = null
    })

    return readyBundlePromise
  }

  async function readyInternal(options: {
    waitForConfirmation: boolean
  }) {
    const result = await getReadyBundle()

    if (result.rollback) {
      return result
    }

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
    const currentBundle = await getCurrentBundle()
    const update = await checkForUpdateWithReport(config, {
      deviceId,
      currentBundleId: currentBundle.bundleId ?? undefined,
    })
    if (update.updateAvailable && isRollbackProtectionBlockedBundle(config, update.bundleId)) {
      logRollbackProtectionBlockedBundle(logger, update.bundleId)
      return {
        updateAvailable: false as const,
        appId: update.appId,
        platform: update.platform,
        runtimeVersion: update.runtimeVersion,
      }
    }

    return update
  }

  async function sync(): Promise<CapacitorSyncResult> {
    const readyResult = await readyInternal({ waitForConfirmation: false }).catch((error) => {
      logger.warn('Otalan ready() failed.', serializeErrorForLog(error))
      return null
    })
    if (readyResult?.rollback) {
      return { updateAvailable: false }
    }

    const currentBundle = await getCurrentBundle()
    const nextBundle = await getNextBundle()
    const currentBundleId = currentBundle.bundleId ?? undefined
    const update = await checkForUpdateWithReport(config, {
      deviceId,
      currentBundleId,
    })

    if (!update.updateAvailable) {
      return { updateAvailable: false }
    }

    if (update.bundleId === currentBundle.bundleId) {
      return { updateAvailable: false }
    }

    if (isRollbackProtectionBlockedBundle(config, update.bundleId)) {
      logRollbackProtectionBlockedBundle(logger, update.bundleId)
      return { updateAvailable: false }
    }

    if (update.bundleId === nextBundle.bundleId) {
      const transferSource = await resolveStagedTransferSource(update.bundleId)
      rememberTransferSource(config, pendingTransferSources, update.bundleId, transferSource)
      rememberPendingRollbackProtectionBundle(config, {
        targetBundleId: update.bundleId,
        previousBundleId: currentBundleId,
      })

      if (config.reloadOnSync !== false) {
        await reloadStagedBundle(update.bundleId).catch((error) => {
          reportCapacitorUpdateEvent(config, {
            deviceId,
            currentBundleId,
            targetBundleId: update.bundleId,
            phase: 'reload',
            error,
          })
          throw error
        })
      }

      return buildAppliedResult(config, update, transferSource)
    }

    const transferSource = await ensureBundleIsAvailable(update, {
      logger,
      onDownloadProgress: config.onDownloadProgress,
    }).catch((error) => {
      reportCapacitorUpdateEvent(config, {
        deviceId,
        currentBundleId,
        targetBundleId: update.bundleId,
        phase: 'download',
        error,
      })
      throw error
    })

    await setNextBundle(update.bundleId).catch((error) => {
      reportCapacitorUpdateEvent(config, {
        deviceId,
        currentBundleId,
        targetBundleId: update.bundleId,
        phase: 'stage',
        error,
      })
      throw error
    })
    rememberTransferSource(config, pendingTransferSources, update.bundleId, transferSource)
    rememberPendingRollbackProtectionBundle(config, {
      targetBundleId: update.bundleId,
      previousBundleId: currentBundleId,
    })

    if (config.reloadOnSync !== false) {
      await reloadStagedBundle(update.bundleId).catch((error) => {
        reportCapacitorUpdateEvent(config, {
          deviceId,
          currentBundleId,
          targetBundleId: update.bundleId,
          phase: 'reload',
          error,
        })
        throw error
      })
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

function logRollbackProtectionBlockedBundle(logger: Pick<Console, 'warn'>, bundleId: string) {
  logger.warn('[ota] update skipped because bundle failed rollback validation', {
    ...SDK_LOG_CONTEXT,
    bundleId,
  })
}

async function confirmInstall(
  config: CapacitorUpdaterConfig,
  input: {
    bundleId: string
    deviceId: string
    transferSource: CapacitorTransferSource
  },
) {
  const platform = resolvePlatform(config)
  const runtimeVersion = await resolveRuntimeVersion(config)
  const confirmationStorageKey = buildInstallConfirmationStorageKey({
    appId: config.appId,
    platform,
    channel: config.channel,
    runtimeVersion,
    bundleId: input.bundleId,
    deviceId: input.deviceId,
  })

  if (readStoredInstallConfirmation(confirmationStorageKey)) {
    return true
  }

  await postJson(
    joinUrl(config.apiUrl, '/capacitor/confirm'),
    {
      appId: config.appId,
      platform,
      channel: config.channel,
      runtimeVersion,
      bundleId: input.bundleId,
      deviceId: input.deviceId,
      transferSource: input.transferSource,
    },
    buildHeaders(config),
    resolveRequestTimeoutMs(config),
  )

  writeStoredInstallConfirmation(confirmationStorageKey)
  return true
}

async function checkForUpdateWithReport(
  config: CapacitorUpdaterConfig,
  input: {
    deviceId: string
    currentBundleId?: string
  },
) {
  try {
    return await checkForUpdate(config, input.deviceId, input.currentBundleId)
  } catch (error) {
    reportCapacitorUpdateEvent(config, {
      deviceId: input.deviceId,
      currentBundleId: input.currentBundleId,
      phase: 'check',
      error,
    })
    throw error
  }
}

async function checkForUpdate(config: CapacitorUpdaterConfig, deviceId: string, currentBundleId?: string) {
  const platform = resolvePlatform(config)
  const runtimeVersion = await resolveRuntimeVersion(config)
  const response = await postJson<unknown>(
    joinUrl(config.apiUrl, '/capacitor/check'),
    {
      appId: config.appId,
      platform,
      channel: config.channel,
      runtimeVersion,
      currentBundleId,
      deviceId,
    },
    buildHeaders(config),
    resolveRequestTimeoutMs(config),
  )

  return normalizeCheckResponse(response, {
    appId: config.appId,
    platform,
    runtimeVersion,
    allowInsecureBundleUrls: config.allowInsecureBundleUrls,
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
    return {
      updateAvailable: false,
      appId: context.appId,
      platform: context.platform,
      runtimeVersion: context.runtimeVersion,
    }
  }

  const bundleId = readRequiredCheckStringField(response, 'bundleId')
  const downloadUrl = readRequiredCheckStringField(response, 'downloadUrl')
  const checksum = readRequiredCheckStringField(response, 'checksum')
  const mandatory = readOptionalCheckBooleanField(response, 'mandatory') ?? false
  const rolloutPercent = readOptionalCheckNumberField(response, 'rolloutPercent')
  const releaseNotes = readOptionalCheckNullableStringField(response, 'releaseNotes')

  assertTrustedBundleUrl(downloadUrl, context.allowInsecureBundleUrls)

  return {
    updateAvailable: true,
    appId: context.appId,
    platform: context.platform,
    runtimeVersion: context.runtimeVersion,
    bundleId,
    downloadUrl,
    checksum,
    mandatory,
    ...(rolloutPercent !== undefined ? { rolloutPercent } : {}),
    ...(releaseNotes !== undefined ? { releaseNotes } : {}),
  }
}

function assertCompatibleCheckField<TField extends CompatibleCheckField>(
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

function readRequiredCheckStringField(response: Record<string, unknown>, field: string) {
  const value = readStringField(response, field)
  if (!value) {
    throw new Error(`Otalan check response field "${field}" is required.`)
  }

  return value
}

function readOptionalCheckBooleanField(response: Record<string, unknown>, field: string) {
  const value = response[field]
  if (value === undefined || value === null) {
    return undefined
  }

  if (typeof value !== 'boolean') {
    throw new Error(`Otalan check response field "${field}" was malformed.`)
  }

  return value
}

function readOptionalCheckNumberField(response: Record<string, unknown>, field: string) {
  const value = response[field]
  if (value === undefined || value === null) {
    return undefined
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Otalan check response field "${field}" was malformed.`)
  }

  return value
}

function readOptionalCheckNullableStringField(response: Record<string, unknown>, field: string) {
  const value = response[field]
  if (value === undefined) {
    return undefined
  }

  if (value === null || typeof value === 'string') {
    return value
  }

  throw new Error(`Otalan check response field "${field}" was malformed.`)
}

function assertTrustedBundleUrl(downloadUrl: string, allowInsecureBundleUrls?: boolean) {
  let parsedUrl: URL

  try {
    parsedUrl = new URL(downloadUrl)
  } catch {
    throw new Error('Otalan check response field "downloadUrl" was malformed.')
  }

  if (parsedUrl.protocol === 'https:') {
    return
  }

  if (parsedUrl.protocol === 'http:' && allowInsecureBundleUrls === true) {
    return
  }

  if (parsedUrl.protocol === 'http:') {
    throw new Error('Otalan check response field "downloadUrl" must use HTTPS.')
  }

  throw new Error(`Otalan check response field "downloadUrl" uses unsupported URL scheme "${parsedUrl.protocol}".`)
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
    mandatory: check.mandatory,
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

function readStoredInstallConfirmation(key: string) {
  const storage = getTransferSourceStorage()
  if (!storage) {
    return false
  }

  try {
    return storage.getItem(key) === '1'
  } catch {
    return false
  }
}

function writeStoredInstallConfirmation(key: string) {
  const storage = getTransferSourceStorage()
  if (!storage) {
    return
  }

  try {
    storage.setItem(key, '1')
  } catch {
    // Backend confirm idempotency still prevents duplicate first-install counts.
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
  return `otalan-capacitor-${createRandomToken()}`
}

function createRandomToken() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16)
    globalThis.crypto.getRandomValues(bytes)
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  }

  const randomPart = Math.random().toString(36).slice(2, 10)
  return `${Date.now().toString(36)}-${randomPart}`
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

function buildInstallConfirmationStorageKey(input: {
  appId: string
  platform: OtaPlatform
  channel: string
  runtimeVersion: string
  bundleId: string
  deviceId: string
}) {
  return `${CONFIRMED_INSTALL_STORAGE_KEY_PREFIX}${[
    input.appId,
    input.platform,
    input.channel,
    input.runtimeVersion,
    input.bundleId,
    input.deviceId,
  ].map(encodeURIComponent).join(':')}`
}

function isCapacitorTransferSource(value: string | null): value is CapacitorTransferSource {
  return value === 'downloaded' || value === 'cached'
}
