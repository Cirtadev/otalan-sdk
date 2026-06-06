import { Platform } from 'react-native'
import * as Updates from 'expo-updates'

import packageJson from '../package.json' with { type: 'json' }
import {
  clearExpoRollbackRequest,
  getExpoRollbackProtectionRequestContext,
  isExpoRollbackProtectionBlockedBundle,
  rememberPendingExpoRollbackProtectionBundle,
} from './expo-rollback-protection'
import { reportExpoUpdateEvent, resolveExpoCheckTargetBundleId } from './update-events'
import type {
  ExpoRollbackProtectionConfig,
  ExpoRollbackProtectionRequestContext,
} from './expo-rollback-protection'

export type ExpoUpdatesAdapterConfig = {
  apiUrl: string
  apiKey: string
  appId: string
  channel: string
  deviceId: string
  requestTimeoutMs?: number
  rollbackProtection?: boolean | ExpoRollbackProtectionConfig
  headers?: HeadersInit
  logger?: Pick<Console, 'warn'>
}

export const OTALAN_EXPO_SDK_NAME = packageJson.name
export const OTALAN_EXPO_SDK_VERSION = packageJson.version
export const OTALAN_EXPO_DEVICE_ID_EXTRA_PARAM_KEY = 'otalan-device-id'
export const OTALAN_EXPO_BLOCKED_BUNDLE_IDS_EXTRA_PARAM_KEY = 'otalan-blocked-bundle-ids'
export const OTALAN_EXPO_ROLLBACK_TARGET_BUNDLE_ID_EXTRA_PARAM_KEY = 'otalan-rollback-target-bundle-id'

const MAX_SERIALIZED_CAUSE_DEPTH = 5
const SDK_LOG_CONTEXT = {
  sdkName: OTALAN_EXPO_SDK_NAME,
  sdkVersion: OTALAN_EXPO_SDK_VERSION,
}

export function buildExpoUpdatesSyncLogContext(extra?: Record<string, unknown>) {
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

export function summarizeExpoUpdateCheckResult(result: {
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

export function hasAvailableExpoUpdate(result: {
  isAvailable?: boolean
  isRollBackToEmbedded?: boolean
}) {
  return Boolean(result.isAvailable || result.isRollBackToEmbedded)
}

export function buildExpoCheckResult(result: {
  isAvailable?: boolean
  isRollBackToEmbedded?: boolean
}) {
  return {
    updateAvailable: hasAvailableExpoUpdate(result),
  }
}

export async function checkForUpdateWithRollbackProtection(
  config: ExpoUpdatesAdapterConfig,
  deviceId: string,
  logger: Pick<Console, 'warn'>,
) {
  const { update, rollbackProtectionContext } = await checkExpoUpdates(config, deviceId, logger)
  const targetBundleId = resolveExpoCheckTargetBundleId(update)

  if (targetBundleId && await isExpoRollbackProtectionBlockedBundle(config, targetBundleId)) {
    logger.warn('[ota] Expo update skipped because bundle failed rollback validation.', {
      ...SDK_LOG_CONTEXT,
      bundleId: targetBundleId,
    })
    return {
      update,
      targetBundleId,
      blocked: true,
      rollbackTargetBundleId: rollbackProtectionContext.rollbackTargetBundleId,
    }
  }

  return {
    update,
    targetBundleId,
    blocked: false,
    rollbackTargetBundleId: rollbackProtectionContext.rollbackTargetBundleId,
  }
}

export function summarizeExpoUpdateFetchResult(result: {
  isNew?: boolean
  isRollBackToEmbedded?: boolean
}) {
  return {
    isNew: result.isNew,
    isRollBackToEmbedded: result.isRollBackToEmbedded,
  }
}

export async function applyExpoRollbackRecoveryUpdate(
  config: ExpoUpdatesAdapterConfig,
  deviceId: string,
  checked: Awaited<ReturnType<typeof checkForUpdateWithRollbackProtection>>,
  targetBundleId: string,
  logger: Pick<Console, 'warn'>,
) {
  if (checked.blocked) {
    return false
  }

  if (!hasAvailableExpoUpdate(checked.update)) {
    logger.warn('Otalan Expo rollback request found no available rollback update.', {
      ...SDK_LOG_CONTEXT,
      targetBundleId,
      update: summarizeExpoUpdateCheckResult(checked.update),
    })
    return false
  }

  const fetchResult = await Updates.fetchUpdateAsync().catch((error) => {
    reportExpoUpdateEvent(config, {
      deviceId,
      targetBundleId: checked.targetBundleId ?? targetBundleId,
      phase: 'fetch',
      error,
    })
    throw error
  })

  const fetchedSafeUpdate = fetchResult.isNew && checked.targetBundleId && !fetchResult.isRollBackToEmbedded
  if (!fetchResult.isRollBackToEmbedded && !fetchedSafeUpdate) {
    logger.warn('Otalan Expo rollback request fetch returned no rollback update.', {
      ...SDK_LOG_CONTEXT,
      targetBundleId,
      fetchResult: summarizeExpoUpdateFetchResult(fetchResult),
    })
    return false
  }

  if (fetchedSafeUpdate) {
    await rememberPendingExpoRollbackProtectionBundle(config, {
      targetBundleId: checked.targetBundleId,
    })
  }

  await clearExpoRollbackRequest(config)

  await Updates.reloadAsync().catch((error) => {
    reportExpoUpdateEvent(config, {
      deviceId,
      targetBundleId: checked.targetBundleId ?? targetBundleId,
      phase: 'reload',
      error,
    })
    throw error
  })
  return true
}

export async function requestExpoRollbackToEmbedded(
  config: ExpoUpdatesAdapterConfig,
  deviceId: string,
  targetBundleId: string,
  logger: Pick<Console, 'warn'>,
) {
  const checked = await checkForUpdateWithRollbackProtection(config, deviceId, logger).catch((error) => {
    reportExpoUpdateEvent(config, {
      deviceId,
      targetBundleId,
      phase: 'check',
      error,
    })
    throw error
  })

  return applyExpoRollbackRecoveryUpdate(config, deviceId, checked, targetBundleId, logger)
}

async function checkExpoUpdates(
  config: ExpoUpdatesAdapterConfig,
  deviceId: string,
  logger: Pick<Console, 'warn'>,
) {
  await setExpoUpdateDeviceIdExtraParam(deviceId, logger)
  const rollbackProtectionContext = await getExpoRollbackProtectionRequestContext(config)
  await setExpoUpdateRollbackProtectionExtraParams(rollbackProtectionContext, logger)
  setExpoUpdateRequestHeaders(config, rollbackProtectionContext, logger)

  return {
    rollbackProtectionContext,
    update: await Updates.checkForUpdateAsync(),
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

async function setExpoUpdateRollbackProtectionExtraParams(
  context: ExpoRollbackProtectionRequestContext,
  logger: Pick<Console, 'warn'>,
) {
  const blockedBundleIds = context.blockedBundleIds.length > 0
    ? JSON.stringify(context.blockedBundleIds)
    : null
  const rollbackTargetBundleId = context.rollbackTargetBundleId ?? null

  try {
    await Updates.setExtraParamAsync(OTALAN_EXPO_BLOCKED_BUNDLE_IDS_EXTRA_PARAM_KEY, blockedBundleIds)
    await Updates.setExtraParamAsync(
      OTALAN_EXPO_ROLLBACK_TARGET_BUNDLE_ID_EXTRA_PARAM_KEY,
      rollbackTargetBundleId,
    )
  } catch (error) {
    logger.warn('Otalan Expo rollback protection extra param failed.', serializeErrorForLog(error))
  }
}

function setExpoUpdateRequestHeaders(
  config: Pick<ExpoUpdatesAdapterConfig, 'apiKey'>,
  context: ExpoRollbackProtectionRequestContext,
  logger: Pick<Console, 'warn'>,
) {
  const headers: Record<string, string> = {
    'x-api-key': config.apiKey,
  }

  if (context.blockedBundleIds.length > 0) {
    headers['x-otalan-blocked-bundle-ids'] = JSON.stringify(context.blockedBundleIds)
  }

  if (context.rollbackTargetBundleId) {
    headers['x-otalan-rollback-target-bundle-id'] = context.rollbackTargetBundleId
  }

  try {
    Updates.setUpdateRequestHeadersOverride(headers)
  } catch (error) {
    logger.warn('Otalan Expo update request header override failed.', serializeErrorForLog(error))
  }
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
