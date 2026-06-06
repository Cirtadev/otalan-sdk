import {
  getCurrentBundle,
  reloadStagedBundle,
  resetToDefaultBundle,
  setNextBundle,
} from './live-update'
import { SDK_LOG_CONTEXT, serializeErrorForLog } from './runtime'

import type { LiveUpdateReadyResult } from './live-update'
import type {
  CapacitorRollbackProtectionConfig,
  CapacitorUpdaterConfig,
} from './types'

type RollbackProtectionSettings = {
  enabled: boolean
  validationDelayMs: number
}

type PendingRollbackProtection = {
  targetBundleId: string
  stagedAt: number
  previousBundleId?: string
  launchAttemptedAt?: number
}

type RollbackProtectionReadyResult =
  | { action: 'continue'; validationDelayMs: number }
  | { action: 'rolled-back'; result: LiveUpdateReadyResult }

const DEFAULT_ROLLBACK_VALIDATION_DELAY_MS = 10_000
const MAX_BLOCKED_ROLLBACK_BUNDLES = 100
const BLOCKED_ROLLBACK_BUNDLES_STORAGE_KEY_PREFIX = 'otalan:capacitor:blocked-rollback-bundles:'
const ROLLBACK_PROTECTION_STORAGE_KEY_PREFIX = 'otalan:capacitor:rollback-protection:'

export function rememberPendingRollbackProtectionBundle(
  config: CapacitorUpdaterConfig,
  input: {
    targetBundleId: string
    previousBundleId?: string
  },
) {
  if (!resolveRollbackProtectionSettings(config).enabled) {
    return
  }

  writePendingRollbackProtection(config, {
    targetBundleId: input.targetBundleId,
    stagedAt: Date.now(),
    ...(input.previousBundleId ? { previousBundleId: input.previousBundleId } : {}),
  })
}

export function isRollbackProtectionBlockedBundle(config: CapacitorUpdaterConfig, bundleId: string) {
  return resolveRollbackProtectionSettings(config).enabled
    && readBlockedRollbackBundles(config).includes(bundleId)
}

export async function prepareRollbackProtectionBeforeReady(
  config: CapacitorUpdaterConfig,
  logger: Pick<Console, 'warn'>,
): Promise<RollbackProtectionReadyResult> {
  const settings = resolveRollbackProtectionSettings(config)
  if (!settings.enabled) {
    return { action: 'continue', validationDelayMs: 0 }
  }

  const pending = readPendingRollbackProtection(config)
  if (!pending) {
    return { action: 'continue', validationDelayMs: 0 }
  }

  const currentBundle = await getCurrentBundle()
  if (currentBundle.bundleId !== pending.targetBundleId) {
    clearPendingRollbackProtection(config)
    return { action: 'continue', validationDelayMs: 0 }
  }

  if (pending.launchAttemptedAt !== undefined) {
    const result = await rollBackFailedBundle(config, pending, logger)
    return { action: 'rolled-back', result }
  }

  writePendingRollbackProtection(config, {
    ...pending,
    launchAttemptedAt: Date.now(),
  })

  return {
    action: 'continue',
    validationDelayMs: settings.validationDelayMs,
  }
}

export async function waitForRollbackProtectionValidation(delayMs: number) {
  if (delayMs <= 0) {
    return
  }

  await new Promise((resolve) => setTimeout(resolve, delayMs))
}

export function clearRollbackProtectionAfterReady(
  config: CapacitorUpdaterConfig,
  result: LiveUpdateReadyResult,
) {
  const pending = readPendingRollbackProtection(config)
  if (result.rollback) {
    const rolledBackBundleId = result.previousBundleId ?? pending?.targetBundleId
    if (rolledBackBundleId) {
      rememberBlockedRollbackBundle(config, rolledBackBundleId)
    }
    clearPendingRollbackProtection(config)
    return
  }

  if (!pending) {
    return
  }

  if (result.currentBundleId === pending.targetBundleId) {
    clearPendingRollbackProtection(config)
  }
}

async function rollBackFailedBundle(
  config: CapacitorUpdaterConfig,
  pending: PendingRollbackProtection,
  logger: Pick<Console, 'warn'>,
): Promise<LiveUpdateReadyResult> {
  logger.warn('[ota] rollback protection restoring previous bundle', {
    ...SDK_LOG_CONTEXT,
    targetBundleId: pending.targetBundleId,
    previousBundleId: pending.previousBundleId,
  })

  const restoredBundleId = await stageRollbackTarget(config, pending, logger)
  rememberBlockedRollbackBundle(config, pending.targetBundleId)
  await reloadStagedBundle(restoredBundleId ?? 'default')
  clearPendingRollbackProtection(config)

  return {
    currentBundleId: restoredBundleId ?? null,
    previousBundleId: pending.targetBundleId,
    rollback: true,
  }
}

async function stageRollbackTarget(
  config: CapacitorUpdaterConfig,
  pending: PendingRollbackProtection,
  logger: Pick<Console, 'warn'>,
) {
  if (!pending.previousBundleId) {
    await resetToDefaultBundle(pending.targetBundleId)
    return undefined
  }

  try {
    await setNextBundle(pending.previousBundleId)
    return pending.previousBundleId
  } catch (error) {
    logger.warn('Otalan rollback to previous bundle failed; resetting to default bundle.', {
      ...SDK_LOG_CONTEXT,
      targetBundleId: pending.targetBundleId,
      previousBundleId: pending.previousBundleId,
      error: serializeErrorForLog(error),
    })
    await resetToDefaultBundle(pending.targetBundleId)
    return undefined
  }
}

function resolveRollbackProtectionSettings(config: CapacitorUpdaterConfig): RollbackProtectionSettings {
  const rollbackProtection = config.rollbackProtection

  if (rollbackProtection === false) {
    return {
      enabled: false,
      validationDelayMs: 0,
    }
  }

  if (rollbackProtection === true || rollbackProtection === undefined) {
    return {
      enabled: true,
      validationDelayMs: DEFAULT_ROLLBACK_VALIDATION_DELAY_MS,
    }
  }

  return {
    enabled: rollbackProtection.enabled ?? true,
    validationDelayMs: resolveValidationDelayMs(rollbackProtection),
  }
}

function resolveValidationDelayMs(config: CapacitorRollbackProtectionConfig) {
  return typeof config.validationDelayMs === 'number'
    && Number.isFinite(config.validationDelayMs)
    && config.validationDelayMs >= 0
    ? config.validationDelayMs
    : DEFAULT_ROLLBACK_VALIDATION_DELAY_MS
}

function readPendingRollbackProtection(config: CapacitorUpdaterConfig) {
  const storage = getRollbackProtectionStorage()
  if (!storage) {
    return undefined
  }

  try {
    const value = storage.getItem(buildRollbackProtectionStorageKey(config))
    if (!value) {
      return undefined
    }

    const parsed = JSON.parse(value) as unknown
    return isPendingRollbackProtection(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function writePendingRollbackProtection(
  config: CapacitorUpdaterConfig,
  pending: PendingRollbackProtection,
) {
  const storage = getRollbackProtectionStorage()
  if (!storage) {
    return
  }

  try {
    storage.setItem(buildRollbackProtectionStorageKey(config), JSON.stringify(pending))
  } catch {
    // If storage is unavailable, the normal update flow still works without rollback protection.
  }
}

function clearPendingRollbackProtection(config: CapacitorUpdaterConfig) {
  const storage = getRollbackProtectionStorage()
  if (!storage) {
    return
  }

  try {
    storage.removeItem(buildRollbackProtectionStorageKey(config))
  } catch {
    // Best effort cleanup only.
  }
}

function rememberBlockedRollbackBundle(config: CapacitorUpdaterConfig, bundleId: string) {
  const blockedBundles = readBlockedRollbackBundles(config)
  const nextBlockedBundles = [
    ...blockedBundles.filter((blockedBundleId) => blockedBundleId !== bundleId),
    bundleId,
  ].slice(-MAX_BLOCKED_ROLLBACK_BUNDLES)

  writeBlockedRollbackBundles(config, nextBlockedBundles)
}

function readBlockedRollbackBundles(config: CapacitorUpdaterConfig) {
  const storage = getRollbackProtectionStorage()
  if (!storage) {
    return []
  }

  try {
    const value = storage.getItem(buildBlockedRollbackBundlesStorageKey(config))
    if (!value) {
      return []
    }

    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && item.length > 0)
      : []
  } catch {
    return []
  }
}

function writeBlockedRollbackBundles(config: CapacitorUpdaterConfig, bundleIds: string[]) {
  const storage = getRollbackProtectionStorage()
  if (!storage) {
    return
  }

  try {
    storage.setItem(buildBlockedRollbackBundlesStorageKey(config), JSON.stringify(bundleIds))
  } catch {
    // If storage is unavailable, the normal update flow still works without local blocking.
  }
}

function isPendingRollbackProtection(value: unknown): value is PendingRollbackProtection {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const record = value as Partial<PendingRollbackProtection>

  return typeof record.targetBundleId === 'string'
    && record.targetBundleId.length > 0
    && typeof record.stagedAt === 'number'
    && Number.isFinite(record.stagedAt)
    && (record.previousBundleId === undefined || typeof record.previousBundleId === 'string')
    && (
      record.launchAttemptedAt === undefined
      || (typeof record.launchAttemptedAt === 'number' && Number.isFinite(record.launchAttemptedAt))
    )
}

function buildRollbackProtectionStorageKey(config: CapacitorUpdaterConfig) {
  return `${ROLLBACK_PROTECTION_STORAGE_KEY_PREFIX}${buildStorageKeySuffix(config)}`
}

function buildBlockedRollbackBundlesStorageKey(config: CapacitorUpdaterConfig) {
  return `${BLOCKED_ROLLBACK_BUNDLES_STORAGE_KEY_PREFIX}${buildStorageKeySuffix(config)}`
}

function buildStorageKeySuffix(config: CapacitorUpdaterConfig) {
  const parts = [
    config.appId,
    config.channel,
    config.deviceId,
  ].map(encodeURIComponent).join(':')

  return parts
}

function getRollbackProtectionStorage() {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}
