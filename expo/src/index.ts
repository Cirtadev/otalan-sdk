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

export type ExpoTransferSource = 'downloaded' | 'cached'

export type ExpoUpdaterConfig = {
  apiUrl: string
  apiKey: string
  appId: string
  autoConfirm?: boolean
  deviceId: string
  headers?: HeadersInit
  logger?: Pick<Console, 'warn'>
}

export type ExpoReadyResult = {
  enabled: boolean
  confirmed: boolean
  isEmbeddedLaunch: boolean
  isEmergencyLaunch: boolean
  runtimeVersion?: string
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
  getUpdater: () => ReturnType<typeof createUpdater> | null
  ready: () => Promise<ExpoReadyResult | null>
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

const DEFAULT_DEVICE_ID_STORAGE_KEY = 'otalan-device-id'
const DEFAULT_TRANSFER_SOURCE: ExpoTransferSource = 'downloaded'

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
    throw new Error('Otalan Expo updater requires deviceId because POST /expo/confirm requires it.')
  }

  return config.deviceId
}

function createDeviceId() {
  const randomPart = Math.random().toString(36).slice(2, 10)
  return `otalan-expo-${Date.now().toString(36)}-${randomPart}`
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

async function postJson(url: string, body: unknown, headers: HeadersInit) {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }).catch((error) => {
    throw buildRequestFailureError(url, error)
  })

  if (!response.ok) {
    throw new Error(buildHttpErrorMessage(url, response, await readErrorResponseMessage(response)))
  }
}

async function readErrorResponseMessage(response: Response) {
  const contentType = response.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    const payload = await response.json().catch(() => ({})) as {
      message?: string
    }

    return payload.message
  }

  const body = await response.text().catch(() => '')
  return body.trim() || undefined
}

function buildHttpErrorMessage(url: string, response: Response, message?: string) {
  const statusMessage = `POST ${url} failed with status ${response.status}`
  return message ? `${statusMessage}: ${message}` : statusMessage
}

function buildRequestFailureError(url: string, error: unknown) {
  return new Error(`POST ${url} failed before response: ${readErrorMessage(error)}`, {
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

function readCodeField(value: Record<string, unknown>) {
  const code = value.code
  return typeof code === 'string' || typeof code === 'number' ? code : undefined
}

function serializeErrorForLog(error: unknown): unknown {
  if (!isRecord(error)) {
    return {
      ...SDK_LOG_CONTEXT,
      message: String(error),
    }
  }

  const name = error instanceof Error ? error.name : readStringField(error, 'name')
  const message = error instanceof Error ? error.message : readStringField(error, 'message')
  const code = readCodeField(error)
  const cause = 'cause' in error ? serializeErrorForLog(error.cause) : undefined

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

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export async function initializeUpdater(
  config: InitializeExpoUpdaterConfig,
): Promise<InitializedExpoUpdater> {
  const logger = config.logger ?? console
  let readyPromise: Promise<ExpoReadyResult | null> | null = null
  let updater: ReturnType<typeof createUpdater> | null = null

  function isEnabled() {
    return config.enabled ?? (
      Updates.isEnabled
      && isNativeOtaPlatform(Platform.OS)
      && Boolean(config.apiUrl)
      && Boolean(config.apiKey)
    )
  }

  if (isEnabled()) {
    try {
      updater = createUpdater({
        apiUrl: config.apiUrl,
        apiKey: config.apiKey,
        appId: config.appId,
        autoConfirm: config.autoConfirm,
        deviceId: config.deviceId ?? await getOrCreateDeviceId(
          config.deviceIdStorage ?? AsyncStorage,
          config.deviceIdStorageKey ?? DEFAULT_DEVICE_ID_STORAGE_KEY,
        ),
        headers: config.headers,
        logger,
      })
    } catch (error) {
      logger.warn('Otalan device ID initialization failed.', serializeErrorForLog(error))
    }
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
    getUpdater,
    ready,
  }

  await ready()
  return managedUpdater
}

export function createUpdater(config: ExpoUpdaterConfig) {
  const logger = config.logger ?? console
  const deviceId = requireDeviceId(config)
  let confirmedUpdateId: string | null = null
  const confirmingUpdatePromises = new Map<string, Promise<ExpoReadyResult>>()

  async function getCurrentUpdate() {
    if (!Updates.isEnabled) {
      return {
        enabled: false,
        confirmed: false,
        isEmbeddedLaunch: false,
        isEmergencyLaunch: false,
      } satisfies ExpoReadyResult
    }

    return {
      enabled: true,
      confirmed: false,
      isEmbeddedLaunch: Updates.isEmbeddedLaunch,
      isEmergencyLaunch: Updates.isEmergencyLaunch,
      runtimeVersion: Updates.runtimeVersion ?? undefined,
      updateId: Updates.updateId ?? undefined,
    } satisfies ExpoReadyResult
  }

  async function confirmCurrentUpdate() {
    const current = await getCurrentUpdate()

    if (!current.enabled) {
      return current
    }

    if (!config.autoConfirm && config.autoConfirm !== undefined) {
      return current
    }

    if (!current.updateId) {
      return current
    }

    if (current.isEmergencyLaunch) {
      return current
    }

    if (current.isEmbeddedLaunch) {
      return current
    }

    const updateId = current.updateId

    if (updateId === confirmedUpdateId) {
      return {
        ...current,
        confirmed: true,
        transferSource: DEFAULT_TRANSFER_SOURCE,
      } satisfies ExpoReadyResult
    }

    const existingConfirmation = confirmingUpdatePromises.get(updateId)
    if (existingConfirmation) {
      return existingConfirmation
    }

    const confirmationPromise = (async () => {
      await postJson(
        joinUrl(config.apiUrl, '/expo/confirm'),
        {
          appId: config.appId,
          platform: resolvePlatform(),
          updateId,
          runtimeVersion: current.runtimeVersion,
          deviceId,
          transferSource: DEFAULT_TRANSFER_SOURCE,
        },
        buildHeaders(config),
      )

      confirmedUpdateId = updateId

      return {
        ...current,
        confirmed: true,
        transferSource: DEFAULT_TRANSFER_SOURCE,
      } satisfies ExpoReadyResult
    })().finally(() => {
      confirmingUpdatePromises.delete(updateId)
    })

    confirmingUpdatePromises.set(updateId, confirmationPromise)
    return confirmationPromise
  }

  async function ready() {
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
