import { Platform } from 'react-native'
import * as Updates from 'expo-updates'

import packageJson from '../package.json' with { type: 'json' }

export type ExpoUpdateEventPhase = 'check' | 'fetch' | 'reload' | 'confirm'

export type ExpoUpdateEventCategory = 'check_failed' | 'apply_failed' | 'telemetry_failed'

export type ExpoUpdateEventErrorType =
  | 'network'
  | 'timeout'
  | 'api-error'
  | 'fetch-failed'
  | 'reload-failed'
  | 'confirm-failed'
  | 'expo-updates-error'
  | 'unknown'

export type ExpoUpdateEventReport = {
  eventId: string
  appId: string
  platform: 'ios' | 'android'
  channel: string
  runtimeVersion?: string
  deviceId?: string
  currentBundleId?: string
  targetBundleId?: string
  phase: ExpoUpdateEventPhase
  category: ExpoUpdateEventCategory
  errorType: ExpoUpdateEventErrorType
  errorMessage: string
  sdkName: string
  sdkVersion: string
}

export type ExpoUpdateEventConfig = {
  apiUrl: string
  apiKey: string
  appId: string
  channel: string
  deviceId?: string
  requestTimeoutMs?: number
  headers?: HeadersInit
  logger?: Pick<Console, 'warn'>
}

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const MAX_SERIALIZED_CAUSE_DEPTH = 5
const MAX_UPDATE_EVENT_ERROR_MESSAGE_LENGTH = 2048
const SDK_LOG_CONTEXT = {
  sdkName: packageJson.name,
  sdkVersion: packageJson.version,
}

export function reportExpoUpdateEvent(
  config: ExpoUpdateEventConfig,
  input: {
    deviceId?: string
    currentBundleId?: string
    targetBundleId?: string
    runtimeVersion?: string
    phase: ExpoUpdateEventPhase
    error: unknown
  },
) {
  const logger = config.logger ?? console

  void (async () => {
    const event = buildExpoUpdateEventReport(config, input)

    await postJson(
      joinUrl(config.apiUrl, '/expo/report-update-event'),
      event,
      buildHeaders(config),
      resolveRequestTimeoutMs(config),
    )
  })().catch((error) => {
    logger.warn('Otalan update event report failed.', serializeErrorForLog(error))
  })
}

export function resolveExpoCheckTargetBundleId(result: unknown) {
  if (!isRecord(result)) {
    return undefined
  }

  const manifest = readRecordField(result, 'manifest')
  if (manifest) {
    return resolveOtalanManifestMetadata(manifest).bundleId
  }

  const updateManifest = readRecordField(result, 'updateManifest')
  if (updateManifest) {
    return resolveOtalanManifestMetadata(updateManifest).bundleId
  }

  return readStringField(result, 'bundleId')
}

function buildExpoUpdateEventReport(
  config: ExpoUpdateEventConfig,
  input: {
    deviceId?: string
    currentBundleId?: string
    targetBundleId?: string
    runtimeVersion?: string
    phase: ExpoUpdateEventPhase
    error: unknown
  },
): ExpoUpdateEventReport {
  const currentContext = resolveExpoCurrentEventContext()
  const errorMessage = readUpdateEventErrorMessage(input.error)
  const runtimeVersion = input.runtimeVersion ?? currentContext.runtimeVersion
  const deviceId = input.deviceId ?? config.deviceId
  const currentBundleId = input.currentBundleId ?? currentContext.currentBundleId

  return {
    eventId: createUpdateEventId(),
    appId: config.appId,
    platform: resolvePlatform(),
    channel: config.channel,
    ...(runtimeVersion ? { runtimeVersion } : {}),
    ...(deviceId ? { deviceId } : {}),
    ...(currentBundleId ? { currentBundleId } : {}),
    ...(input.targetBundleId ? { targetBundleId: input.targetBundleId } : {}),
    phase: input.phase,
    category: resolveUpdateEventCategory(input.phase),
    errorType: classifyUpdateEventError(input.phase, errorMessage),
    errorMessage,
    sdkName: SDK_LOG_CONTEXT.sdkName,
    sdkVersion: SDK_LOG_CONTEXT.sdkVersion,
  }
}

function resolvePlatform() {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    throw new Error(`Unsupported Expo platform: ${Platform.OS}`)
  }

  return Platform.OS
}

function resolveExpoCurrentEventContext() {
  const metadata = resolveOtalanManifestMetadata(Updates.manifest)

  return {
    currentBundleId: metadata.bundleId,
    runtimeVersion: Updates.runtimeVersion ?? metadata.runtimeVersion,
  }
}

function resolveUpdateEventCategory(phase: ExpoUpdateEventPhase): ExpoUpdateEventCategory {
  if (phase === 'check') {
    return 'check_failed'
  }

  if (phase === 'confirm') {
    return 'telemetry_failed'
  }

  return 'apply_failed'
}

function classifyUpdateEventError(
  phase: ExpoUpdateEventPhase,
  message: string,
): ExpoUpdateEventErrorType {
  if (phase === 'fetch') {
    return 'fetch-failed'
  }

  if (phase === 'reload') {
    return 'reload-failed'
  }

  if (message.includes('timed out after')) {
    return 'timeout'
  }

  if (message.includes('failed before response')) {
    return 'network'
  }

  if (message.includes('failed with status')) {
    return 'api-error'
  }

  if (phase === 'confirm') {
    return 'confirm-failed'
  }

  if (phase === 'check') {
    return 'expo-updates-error'
  }

  return 'unknown'
}

function readUpdateEventErrorMessage(error: unknown) {
  const message = readErrorMessage(error)

  return message.length > MAX_UPDATE_EVENT_ERROR_MESSAGE_LENGTH
    ? message.slice(0, MAX_UPDATE_EVENT_ERROR_MESSAGE_LENGTH)
    : message
}

function createUpdateEventId() {
  return `otalan-expo-event-${createRandomToken()}`
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

function buildHeaders(config: ExpoUpdateEventConfig, extra?: HeadersInit) {
  const headers = mergeHeaders(config.headers, extra)

  headers.set('Content-Type', 'application/json')
  headers.set('x-api-key', config.apiKey)

  return headers
}

function resolveRequestTimeoutMs(config: Pick<ExpoUpdateEventConfig, 'requestTimeoutMs'>) {
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
