import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import * as Updates from 'expo-updates'

import packageJson from '../package.json' with { type: 'json' }

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type DeviceIdStorage = {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
}

/** @experimental Advisory client-reported transfer metadata. */
export type ExpoTransferSource = 'downloaded' | 'cached'

export type ExpoUpdaterConfig = {
  apiUrl: string
  apiKey: string
  appId: string
  channel: string
  autoConfirm?: boolean
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
  ready: () => Promise<ExpoReadyResult | null>
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
) {
  const existing = await storage.getItem(storageKey)

  if (existing) {
    return existing
  }

  const nextDeviceId = createDeviceId()
  await storage.setItem(storageKey, nextDeviceId)
  return nextDeviceId
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
  let deviceId: string | null = config.deviceId || null
  let readyPromise: Promise<ExpoReadyResult | null> | null = null
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
        )
      }

      updater = createUpdater({
        apiUrl: config.apiUrl,
        apiKey: config.apiKey,
        appId: config.appId,
        channel: config.channel,
        autoConfirm: config.autoConfirm,
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

  const managedUpdater = {
    getDeviceId,
    getUpdater,
    ready,
  }

  void ready()
  return managedUpdater
}

export function createUpdater(config: ExpoUpdaterConfig) {
  const logger = config.logger ?? console
  const deviceId = requireDeviceId(config)
  let confirmedBundleKey: string | null = null
  const confirmingBundlePromises = new Map<string, Promise<ExpoReadyResult>>()

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

    if (config.autoConfirm === false) {
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
      )

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
    getCurrentUpdate,
    confirmCurrentUpdate,
    ready,
  }
}
