import {
  SDK_LOG_CONTEXT,
  buildHeaders,
  isRecord,
  joinUrl,
  postJson,
  resolvePlatform,
  resolveRequestTimeoutMs,
  serializeErrorForLog,
} from './runtime'
import { resolveRuntimeVersion } from './live-update'

import type {
  CapacitorUpdateEventCategory,
  CapacitorUpdateEventErrorType,
  CapacitorUpdateEventPhase,
  CapacitorUpdateEventReport,
  CapacitorUpdaterConfig,
} from './types'

const MAX_UPDATE_EVENT_ERROR_MESSAGE_LENGTH = 2048

export function reportCapacitorUpdateEvent(
  config: CapacitorUpdaterConfig,
  input: {
    deviceId?: string
    currentBundleId?: string
    targetBundleId?: string
    phase: CapacitorUpdateEventPhase
    error: unknown
  },
) {
  const logger = config.logger ?? console

  void (async () => {
    const event = await buildCapacitorUpdateEventReport(config, input)

    await postJson(
      joinUrl(config.apiUrl, '/capacitor/report-update-event'),
      event,
      buildHeaders(config),
      resolveRequestTimeoutMs(config),
    )
  })().catch((error) => {
    logger.warn('Otalan update event report failed.', serializeErrorForLog(error))
  })
}

async function buildCapacitorUpdateEventReport(
  config: CapacitorUpdaterConfig,
  input: {
    deviceId?: string
    currentBundleId?: string
    targetBundleId?: string
    phase: CapacitorUpdateEventPhase
    error: unknown
  },
): Promise<CapacitorUpdateEventReport> {
  const runtimeVersion = await resolveRuntimeVersion(config).catch(() => undefined)
  const errorMessage = readUpdateEventErrorMessage(input.error)

  return {
    eventId: createUpdateEventId(),
    appId: config.appId,
    platform: resolvePlatform(config),
    channel: config.channel,
    ...(runtimeVersion ? { runtimeVersion } : {}),
    ...(input.deviceId ? { deviceId: input.deviceId } : {}),
    ...(input.currentBundleId ? { currentBundleId: input.currentBundleId } : {}),
    ...(input.targetBundleId ? { targetBundleId: input.targetBundleId } : {}),
    phase: input.phase,
    category: resolveUpdateEventCategory(input.phase),
    errorType: classifyUpdateEventError(input.phase, errorMessage),
    errorMessage,
    sdkName: SDK_LOG_CONTEXT.sdkName,
    sdkVersion: SDK_LOG_CONTEXT.sdkVersion,
  }
}

function resolveUpdateEventCategory(phase: CapacitorUpdateEventPhase): CapacitorUpdateEventCategory {
  if (phase === 'check') {
    return 'check_failed'
  }

  if (phase === 'confirm') {
    return 'telemetry_failed'
  }

  return 'apply_failed'
}

function classifyUpdateEventError(
  phase: CapacitorUpdateEventPhase,
  message: string,
): CapacitorUpdateEventErrorType {
  if (phase === 'check') {
    if (message.includes('incompatible with the running app')) {
      return 'incompatible-update'
    }

    if (message.includes('downloadUrl')) {
      return 'invalid-download-url'
    }

    if (message.includes('Otalan check response')) {
      return 'invalid-update-response'
    }
  }

  if (phase === 'download') {
    return 'download-failed'
  }

  if (phase === 'stage') {
    return 'stage-failed'
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

  return 'unknown'
}

function readUpdateEventErrorMessage(error: unknown) {
  const serialized = serializeErrorForLog(error)
  const message = isRecord(serialized) && typeof serialized.message === 'string'
    ? serialized.message
    : String(error)

  return message.length > MAX_UPDATE_EVENT_ERROR_MESSAGE_LENGTH
    ? message.slice(0, MAX_UPDATE_EVENT_ERROR_MESSAGE_LENGTH)
    : message
}

function createUpdateEventId() {
  return `otalan-capacitor-event-${createRandomToken()}`
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
