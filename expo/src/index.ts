import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import * as Updates from 'expo-updates'

import packageJson from '../package.json' with { type: 'json' }
import { reportExpoUpdateEvent, resolveExpoCheckTargetBundleId } from './update-events'

export type {
  ExpoUpdateEventCategory,
  ExpoUpdateEventErrorType,
  ExpoUpdateEventPhase,
  ExpoUpdateEventReport,
} from './update-events'

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type DeviceIdStorage = {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
}

type ExpoApplicationModule = {
  getAndroidId?: () => string | null
  getIosIdForVendorAsync?: () => Promise<string | null>
}

/** @experimental Advisory client-reported transfer metadata. */
export type ExpoTransferSource = 'downloaded' | 'cached'

export type ExpoUpdaterConfig = {
  apiUrl: string
  apiKey: string
  appId: string
  channel: string
  deviceId: string
  requestTimeoutMs?: number
  headers?: HeadersInit
  logger?: Pick<Console, 'warn'>
}

export type ExpoReadyResult = {
  enabled: boolean
  confirmed: boolean
  isEmbeddedLaunch: boolean
  isEmergencyLaunch: boolean
  bundleId?: string
  runtimeVersion?: string
  /** @experimental Advisory client-reported transfer metadata. */
  transferSource?: ExpoTransferSource
  updateId?: string
}

export type ExpoCheckResult = {
  updateAvailable: boolean
}

export type InitializeExpoUpdaterConfig = Omit<ExpoUpdaterConfig, 'deviceId' | 'logger'> & {
  deviceId?: string
  deviceIdStorage?: DeviceIdStorage
  deviceIdStorageKey?: string
  enabled?: boolean
  logger?: Pick<Console, 'warn'>
}

export type InitializedExpoUpdater = {
  getDeviceId: () => Promise<string | null>
  getUpdater: () => ReturnType<typeof createUpdater> | null
  check: () => Promise<ExpoCheckResult>
  ready: () => Promise<ExpoReadyResult | null>
  sync: () => Promise<boolean>
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

const DEFAULT_DEVICE_ID_STORAGE_KEY = 'otalan-device-id'
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_TRANSFER_SOURCE: ExpoTransferSource = 'downloaded'
const CONFIRMED_INSTALL_STORAGE_KEY_PREFIX = 'otalan:expo:confirmed-install:'
const MAX_SERIALIZED_CAUSE_DEPTH = 5

export const OTALAN_EXPO_SDK_NAME = packageJson.name
export const OTALAN_EXPO_SDK_VERSION = packageJson.version
export const OTALAN_EXPO_DEVICE_ID_EXTRA_PARAM_KEY = 'otalan-device-id'

const SDK_LOG_CONTEXT = {
  sdkName: OTALAN_EXPO_SDK_NAME,
  sdkVersion: OTALAN_EXPO_SDK_VERSION,
}

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

function buildHeaders(config: ExpoUpdaterConfig, extra?: HeadersInit) {
  const headers = mergeHeaders(config.headers, extra)

  headers.set('Content-Type', 'application/json')
  headers.set('x-api-key', config.apiKey)

  return headers
}

function resolvePlatform() {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    throw new Error(`Unsupported Expo platform: ${Platform.OS}`)
  }

  return Platform.OS
}

function isNativeOtaPlatform(platform: string): platform is 'ios' | 'android' {
  return platform === 'ios' || platform === 'android'
}

function requireDeviceId(config: Pick<ExpoUpdaterConfig, 'deviceId'>) {
  if (!config.deviceId) {
    throw new Error('Otalan Expo updater requires a stable deviceId.')
  }

  return config.deviceId
}

function createDeviceId() {
  return `otalan-expo-${createRandomToken()}`
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
  logger: Pick<Console, 'warn'>,
) {
  const platformDeviceId = await getPlatformDeviceId(logger)
  const storedDeviceId = await readStoredDeviceId(storage, storageKey)

  if (platformDeviceId) {
    if (storedDeviceId.error) {
      logger.warn('Otalan device ID storage read failed.', serializeErrorForLog(storedDeviceId.error))
    }

    await persistDeviceId(storage, storageKey, platformDeviceId, storedDeviceId.value, logger)
    return platformDeviceId
  }

  if (storedDeviceId.error) {
    throw storedDeviceId.error
  }

  if (storedDeviceId.value) {
    return storedDeviceId.value
  }

  const nextDeviceId = createDeviceId()
  await storage.setItem(storageKey, nextDeviceId)
  return nextDeviceId
}

async function readStoredDeviceId(storage: DeviceIdStorage, storageKey: string) {
  try {
    return {
      value: await storage.getItem(storageKey),
      error: null,
    }
  } catch (error) {
    return {
      value: null,
      error,
    }
  }
}

async function getPlatformDeviceId(logger: Pick<Console, 'warn'>) {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    return null
  }

  try {
    const application = await import('expo-application') as ExpoApplicationModule

    if (Platform.OS === 'android') {
      return normalizeDeviceId(application.getAndroidId?.())
    }

    return normalizeDeviceId(await application.getIosIdForVendorAsync?.())
  } catch (error) {
    if (Platform.OS === 'android') {
      logger.warn('Otalan Android device ID lookup failed.', serializeErrorForLog(error))
    }

    return null
  }
}

async function persistDeviceId(
  storage: DeviceIdStorage,
  storageKey: string,
  deviceId: string,
  existingDeviceId: string | null,
  logger: Pick<Console, 'warn'>,
) {
  if (existingDeviceId === deviceId) {
    return
  }

  try {
    await storage.setItem(storageKey, deviceId)
  } catch (error) {
    logger.warn('Otalan device ID storage migration failed.', serializeErrorForLog(error))
  }
}

async function setExpoUpdateDeviceIdExtraParam(
  deviceId: string,
  logger: Pick<Console, 'warn'>,
) {
  try {
    await Updates.setExtraParamAsync(OTALAN_EXPO_DEVICE_ID_EXTRA_PARAM_KEY, deviceId)
  } catch (error) {
    logger.warn('Otalan Expo update device ID extra param failed.', serializeErrorForLog(error))
  }
}

function setExpoUpdateRequestHeaders(
  config: Pick<ExpoUpdaterConfig, 'apiKey'>,
  logger: Pick<Console, 'warn'>,
) {
  try {
    Updates.setUpdateRequestHeadersOverride({ 'x-api-key': config.apiKey })
  } catch (error) {
    logger.warn('Otalan Expo update request header override failed.', serializeErrorForLog(error))
  }
}

function buildExpoUpdatesSyncLogContext(extra?: Record<string, unknown>) {
  return {
    ...SDK_LOG_CONTEXT,
    platform: Platform.OS,
    expoUpdates: {
      isEnabled: Updates.isEnabled,
      isEmbeddedLaunch: Updates.isEmbeddedLaunch,
      isEmergencyLaunch: Updates.isEmergencyLaunch,
      runtimeVersion: Updates.runtimeVersion ?? null,
      updateId: Updates.updateId ?? null,
    },
    ...extra,
  }
}

function resolveExpoSyncUnavailableReason(
  config: InitializeExpoUpdaterConfig,
  deviceId: string | null,
  updater: ReturnType<typeof createUpdater> | null,
) {
  if (config.enabled === false) {
    return 'disabled-by-config'
  }

  if (config.enabled !== true && !Updates.isEnabled) {
    return 'expo-updates-disabled'
  }

  if (config.enabled !== true && !isNativeOtaPlatform(Platform.OS)) {
    return 'unsupported-platform'
  }

  if (config.enabled !== true && !config.apiUrl) {
    return 'missing-api-url'
  }

  if (config.enabled !== true && !config.apiKey) {
    return 'missing-api-key'
  }

  if (config.enabled !== true && !config.channel) {
    return 'missing-channel'
  }

  if (!deviceId) {
    return 'missing-device-id'
  }

  if (!updater) {
    return 'updater-unavailable'
  }

  return 'unavailable'
}

function summarizeExpoUpdateCheckResult(result: {
  isAvailable?: boolean
  isRollBackToEmbedded?: boolean
  reason?: unknown
}) {
  return {
    isAvailable: result.isAvailable,
    isRollBackToEmbedded: result.isRollBackToEmbedded,
    ...(typeof result.reason === 'string' ? { reason: result.reason } : {}),
  }
}

function hasAvailableExpoUpdate(result: {
  isAvailable?: boolean
  isRollBackToEmbedded?: boolean
}) {
  return Boolean(result.isAvailable || result.isRollBackToEmbedded)
}

function buildExpoCheckResult(result: {
  isAvailable?: boolean
  isRollBackToEmbedded?: boolean
}): ExpoCheckResult {
  return {
    updateAvailable: hasAvailableExpoUpdate(result),
  }
}

async function checkExpoUpdates(
  config: Pick<ExpoUpdaterConfig, 'apiKey'>,
  deviceId: string,
  logger: Pick<Console, 'warn'>,
) {
  await setExpoUpdateDeviceIdExtraParam(deviceId, logger)
  setExpoUpdateRequestHeaders(config, logger)

  return Updates.checkForUpdateAsync()
}

function summarizeExpoUpdateFetchResult(result: {
  isNew?: boolean
  isRollBackToEmbedded?: boolean
}) {
  return {
    isNew: result.isNew,
    isRollBackToEmbedded: result.isRollBackToEmbedded,
  }
}

function normalizeDeviceId(deviceId: unknown) {
  return typeof deviceId === 'string' && deviceId.trim() ? deviceId : null
}

function resolveRequestTimeoutMs(config: Pick<ExpoUpdaterConfig, 'requestTimeoutMs'>) {
  return typeof config.requestTimeoutMs === 'number'
    && Number.isFinite(config.requestTimeoutMs)
    && config.requestTimeoutMs > 0
    ? config.requestTimeoutMs
    : DEFAULT_REQUEST_TIMEOUT_MS
}

async function postJson(url: string, body: unknown, headers: HeadersInit, timeoutMs: number) {
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort()
  }, timeoutMs)

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: controller.signal,
  }).catch((error) => {
    throw controller.signal.aborted
      ? buildRequestTimeoutError(url, timeoutMs, error)
      : buildRequestFailureError(url, error)
  }).finally(() => {
    clearTimeout(timeout)
  })

  if (!response.ok) {
    throw new Error(buildHttpErrorMessage(url, response, await readErrorResponseMessage(response)))
  }
}

async function readErrorResponseMessage(response: Response) {
  const contentType = response.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    const payload = await response.json().catch(() => ({}))
    return readErrorPayloadMessage(payload)
  }

  const body = await response.text().catch(() => '')
  return body.trim() || undefined
}

function buildHttpErrorMessage(url: string, response: Response, message?: string) {
  const statusMessage = `POST ${url} failed with status ${response.status}`
  return message ? `${statusMessage}: ${message}` : statusMessage
}

function readErrorPayloadMessage(payload: unknown) {
  if (!isRecord(payload)) {
    return undefined
  }

  const message = readStringField(payload, 'message')
  if (message) {
    return message
  }

  const error = payload.error
  if (typeof error === 'string' && error) {
    return error
  }

  if (isRecord(error)) {
    return readStringField(error, 'message')
  }

  return undefined
}

function buildRequestFailureError(url: string, error: unknown) {
  return new Error(`POST ${url} failed before response: ${readErrorMessage(error)}`, {
    cause: error,
  })
}

function buildRequestTimeoutError(url: string, timeoutMs: number, error: unknown) {
  return new Error(`POST ${url} timed out after ${timeoutMs}ms.`, {
    cause: error,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readStringField(value: Record<string, unknown>, field: string) {
  const fieldValue = value[field]
  return typeof fieldValue === 'string' && fieldValue ? fieldValue : undefined
}

function readRecordField(value: Record<string, unknown>, field: string) {
  const fieldValue = value[field]
  return isRecord(fieldValue) ? fieldValue : undefined
}

function readCodeField(value: Record<string, unknown>) {
  const code = value.code
  return typeof code === 'string' || typeof code === 'number' ? code : undefined
}

function serializeErrorForLog(error: unknown, depth = 0): unknown {
  if (depth > MAX_SERIALIZED_CAUSE_DEPTH) {
    return {
      ...SDK_LOG_CONTEXT,
      message: 'Error cause depth exceeded.',
    }
  }

  if (!isRecord(error)) {
    return {
      ...SDK_LOG_CONTEXT,
      message: String(error),
    }
  }

  const name = error instanceof Error ? error.name : readStringField(error, 'name')
  const message = error instanceof Error ? error.message : readStringField(error, 'message')
  const code = readCodeField(error)
  const cause = 'cause' in error ? serializeErrorForLog(error.cause, depth + 1) : undefined

  if (!name && !message && code === undefined && cause === undefined) {
    return {
      ...SDK_LOG_CONTEXT,
      value: error,
    }
  }

  return {
    ...SDK_LOG_CONTEXT,
    ...(name ? { name } : {}),
    message: message ?? String(error),
    ...(code !== undefined ? { code } : {}),
    ...(cause !== undefined ? { cause } : {}),
  }
}

function readErrorMessage(error: unknown) {
  const serialized = serializeErrorForLog(error)
  return isRecord(serialized) && typeof serialized.message === 'string'
    ? serialized.message
    : String(error)
}

function resolveOtalanManifestMetadata(manifest: unknown) {
  if (!isRecord(manifest)) {
    return {}
  }

  const metadata = readRecordField(manifest, 'metadata')
  const extra = readRecordField(manifest, 'extra')
  const otalan = extra ? readRecordField(extra, 'otalan') : undefined
  const metadataBundleId = metadata ? readStringField(metadata, 'bundleId') : undefined
  const otalanBundleId = otalan ? readStringField(otalan, 'bundleId') : undefined

  return {
    bundleId: metadataBundleId ?? otalanBundleId,
    runtimeVersion: readStringField(manifest, 'runtimeVersion')
      ?? (otalan ? readStringField(otalan, 'runtimeVersion') : undefined),
  }
}

function buildConfirmationKey(input: {
  appId: string
  platform: 'ios' | 'android'
  channel: string
  runtimeVersion: string
  bundleId: string
  deviceId: string
}) {
  return [
    input.appId,
    input.platform,
    input.channel,
    input.runtimeVersion,
    input.bundleId,
    input.deviceId,
  ].map(encodeURIComponent).join(':')
}

async function hasStoredInstallConfirmation(confirmationKey: string) {
  try {
    return await AsyncStorage.getItem(buildInstallConfirmationStorageKey(confirmationKey)) === '1'
  } catch {
    return false
  }
}

async function writeStoredInstallConfirmation(confirmationKey: string) {
  try {
    await AsyncStorage.setItem(buildInstallConfirmationStorageKey(confirmationKey), '1')
  } catch {
    // Backend confirm idempotency still prevents duplicate first-install counts.
  }
}

function buildInstallConfirmationStorageKey(confirmationKey: string) {
  return `${CONFIRMED_INSTALL_STORAGE_KEY_PREFIX}${confirmationKey}`
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export async function initializeUpdater(
  config: InitializeExpoUpdaterConfig,
): Promise<InitializedExpoUpdater> {
  const logger = config.logger ?? console
  let deviceId = normalizeDeviceId(config.deviceId)
  let checkPromise: Promise<ExpoCheckResult> | null = null
  let readyPromise: Promise<ExpoReadyResult | null> | null = null
  let syncPromise: Promise<boolean> | null = null
  let updater: ReturnType<typeof createUpdater> | null = null

  function isEnabled() {
    return config.enabled ?? (
      Updates.isEnabled
      && isNativeOtaPlatform(Platform.OS)
      && Boolean(config.apiUrl)
      && Boolean(config.apiKey)
      && Boolean(config.channel)
    )
  }

  if (isEnabled()) {
    try {
      if (deviceId === null) {
        deviceId = await getOrCreateDeviceId(
          config.deviceIdStorage ?? AsyncStorage,
          config.deviceIdStorageKey ?? DEFAULT_DEVICE_ID_STORAGE_KEY,
          logger,
        )
      }

      updater = createUpdater({
        apiUrl: config.apiUrl,
        apiKey: config.apiKey,
        appId: config.appId,
        channel: config.channel,
        deviceId,
        requestTimeoutMs: config.requestTimeoutMs,
        headers: config.headers,
        logger,
      })
    } catch (error) {
      logger.warn('Otalan device ID initialization failed.', serializeErrorForLog(error))
    }
  }

  async function getDeviceId() {
    return deviceId
  }

  function getUpdater() {
    return updater
  }

  async function ready() {
    const currentUpdater = getUpdater()
    if (!currentUpdater) {
      return null
    }

    if (readyPromise) {
      return readyPromise
    }

    readyPromise = currentUpdater.ready().catch((error) => {
      logger.warn('Otalan initializeUpdater() failed.', serializeErrorForLog(error))
      return null
    }).finally(() => {
      readyPromise = null
    })

    return readyPromise
  }

  function buildSkippedCheckResult() {
    return {
      updateAvailable: false,
    } satisfies ExpoCheckResult
  }

  async function runCheck() {
    if (!isEnabled() || !deviceId || !updater) {
      logger.warn('Otalan Expo check skipped.', buildExpoUpdatesSyncLogContext({
        reason: resolveExpoSyncUnavailableReason(config, deviceId, updater),
        hasDeviceId: Boolean(deviceId),
        hasUpdater: Boolean(updater),
      }))
      return buildSkippedCheckResult()
    }

    return updater.check()
  }

  async function check() {
    if (checkPromise) {
      return checkPromise
    }

    checkPromise = runCheck().catch((error) => {
      logger.warn('Otalan Expo check failed.', buildExpoUpdatesSyncLogContext({
        error: serializeErrorForLog(error),
      }))
      return buildSkippedCheckResult()
    }).finally(() => {
      checkPromise = null
    })

    return checkPromise
  }

  async function runSync() {
    if (!isEnabled() || !deviceId || !updater) {
      logger.warn('Otalan Expo sync skipped.', buildExpoUpdatesSyncLogContext({
        reason: resolveExpoSyncUnavailableReason(config, deviceId, updater),
        hasDeviceId: Boolean(deviceId),
        hasUpdater: Boolean(updater),
      }))
      return false
    }

    const reportConfig: ExpoUpdaterConfig = {
      apiUrl: config.apiUrl,
      apiKey: config.apiKey,
      appId: config.appId,
      channel: config.channel,
      deviceId,
      requestTimeoutMs: config.requestTimeoutMs,
      headers: config.headers,
      logger,
    }
    const update = await checkExpoUpdates(config, deviceId, logger).catch((error) => {
      reportExpoUpdateEvent(reportConfig, {
        deviceId,
        phase: 'check',
        error,
      })
      throw error
    })
    if (!hasAvailableExpoUpdate(update)) {
      logger.warn('Otalan Expo sync found no available update.', buildExpoUpdatesSyncLogContext({
        update: summarizeExpoUpdateCheckResult(update),
      }))
      return false
    }

    const targetBundleId = resolveExpoCheckTargetBundleId(update)
    const fetchResult = await Updates.fetchUpdateAsync().catch((error) => {
      reportExpoUpdateEvent(reportConfig, {
        deviceId,
        targetBundleId,
        phase: 'fetch',
        error,
      })
      throw error
    })
    if (!fetchResult.isNew && !fetchResult.isRollBackToEmbedded) {
      logger.warn('Otalan Expo sync fetch returned no new update.', buildExpoUpdatesSyncLogContext({
        fetchResult: summarizeExpoUpdateFetchResult(fetchResult),
      }))
      return false
    }

    await Updates.reloadAsync().catch((error) => {
      reportExpoUpdateEvent(reportConfig, {
        deviceId,
        targetBundleId,
        phase: 'reload',
        error,
      })
      throw error
    })
    return true
  }

  async function sync() {
    if (syncPromise) {
      return syncPromise
    }

    syncPromise = runSync().catch((error) => {
      logger.warn('Otalan Expo sync failed.', buildExpoUpdatesSyncLogContext({
        error: serializeErrorForLog(error),
      }))
      return false
    }).finally(() => {
      syncPromise = null
    })

    return syncPromise
  }

  const managedUpdater = {
    getDeviceId,
    getUpdater,
    check,
    ready,
    sync,
  }

  void ready()
  return managedUpdater
}

export function createUpdater(config: ExpoUpdaterConfig) {
  const logger = config.logger ?? console
  const deviceId = requireDeviceId(config)
  let confirmedBundleKey: string | null = null
  const confirmingBundlePromises = new Map<string, Promise<ExpoReadyResult>>()

  async function check(): Promise<ExpoCheckResult> {
    const update = await checkExpoUpdates(config, deviceId, logger).catch((error) => {
      reportExpoUpdateEvent(config, {
        deviceId,
        phase: 'check',
        error,
      })
      throw error
    })
    return buildExpoCheckResult(update)
  }

  async function getCurrentUpdate(): Promise<ExpoReadyResult> {
    if (!Updates.isEnabled) {
      return {
        enabled: false,
        confirmed: false,
        isEmbeddedLaunch: false,
        isEmergencyLaunch: false,
      } satisfies ExpoReadyResult
    }

    const otalanManifestMetadata = resolveOtalanManifestMetadata(Updates.manifest)

    return {
      enabled: true,
      confirmed: false,
      isEmbeddedLaunch: Updates.isEmbeddedLaunch,
      isEmergencyLaunch: Updates.isEmergencyLaunch,
      bundleId: otalanManifestMetadata.bundleId,
      runtimeVersion: Updates.runtimeVersion ?? otalanManifestMetadata.runtimeVersion,
      updateId: Updates.updateId ?? undefined,
    } satisfies ExpoReadyResult
  }

  async function confirmCurrentUpdate(): Promise<ExpoReadyResult> {
    const current = await getCurrentUpdate()

    if (!current.enabled) {
      return current
    }

    if (current.isEmergencyLaunch) {
      return current
    }

    if (current.isEmbeddedLaunch) {
      return current
    }

    if (!current.bundleId || !current.runtimeVersion) {
      return current
    }

    const platform = resolvePlatform()
    const confirmationKey = buildConfirmationKey({
      appId: config.appId,
      platform,
      channel: config.channel,
      runtimeVersion: current.runtimeVersion,
      bundleId: current.bundleId,
      deviceId,
    })

    if (confirmationKey === confirmedBundleKey) {
      return {
        ...current,
        confirmed: true,
        transferSource: DEFAULT_TRANSFER_SOURCE,
      } satisfies ExpoReadyResult
    }

    if (await hasStoredInstallConfirmation(confirmationKey)) {
      confirmedBundleKey = confirmationKey

      return {
        ...current,
        confirmed: true,
        transferSource: DEFAULT_TRANSFER_SOURCE,
      } satisfies ExpoReadyResult
    }

    const existingConfirmation = confirmingBundlePromises.get(confirmationKey)
    if (existingConfirmation) {
      return existingConfirmation
    }

    const confirmationPromise = (async () => {
      await postJson(
        joinUrl(config.apiUrl, '/expo/confirm'),
        {
          appId: config.appId,
          platform,
          channel: config.channel,
          bundleId: current.bundleId,
          runtimeVersion: current.runtimeVersion,
          deviceId,
          transferSource: DEFAULT_TRANSFER_SOURCE,
        },
        buildHeaders(config),
        resolveRequestTimeoutMs(config),
      ).catch((error) => {
        reportExpoUpdateEvent(config, {
          deviceId,
          currentBundleId: current.bundleId,
          targetBundleId: current.bundleId,
          runtimeVersion: current.runtimeVersion,
          phase: 'confirm',
          error,
        })
        throw error
      })

      await writeStoredInstallConfirmation(confirmationKey)
      confirmedBundleKey = confirmationKey

      return {
        ...current,
        confirmed: true,
        transferSource: DEFAULT_TRANSFER_SOURCE,
      } satisfies ExpoReadyResult
    })().finally(() => {
      confirmingBundlePromises.delete(confirmationKey)
    })

    confirmingBundlePromises.set(confirmationKey, confirmationPromise)
    return confirmationPromise
  }

  async function ready(): Promise<ExpoReadyResult> {
    return confirmCurrentUpdate().catch((error) => {
      logger.warn('Otalan install confirmation failed.', serializeErrorForLog(error))
      return getCurrentUpdate()
    })
  }

  return {
    check,
    getCurrentUpdate,
    confirmCurrentUpdate,
    ready,
  }
}
