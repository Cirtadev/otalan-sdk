import AsyncStorage from '@react-native-async-storage/async-storage'

export type ExpoRollbackProtectionConfig = {
  enabled?: boolean
  validationDelayMs?: number
}

export type ExpoRollbackProtectionSettings = {
  enabled: boolean
  validationDelayMs: number
}

export type ExpoRollbackProtectionRequestContext = {
  blockedBundleIds: string[]
  rollbackTargetBundleId?: string
}

type ExpoRollbackProtectionStorageConfig = {
  appId: string
  channel: string
  deviceId: string
  rollbackProtection?: boolean | ExpoRollbackProtectionConfig
}

type ExpoCurrentUpdate = {
  bundleId?: string
  isEmbeddedLaunch: boolean
  isEmergencyLaunch: boolean
}

type PendingExpoRollbackProtection = {
  targetBundleId: string
  stagedAt: number
  launchAttemptedAt?: number
}

export type ExpoRollbackProtectionReadyResult =
  | { action: 'continue'; validationDelayMs: number }
  | { action: 'request-rollback'; targetBundleId: string }

const DEFAULT_ROLLBACK_VALIDATION_DELAY_MS = 10_000
const MAX_BLOCKED_ROLLBACK_BUNDLES = 100
const BLOCKED_ROLLBACK_BUNDLES_STORAGE_KEY_PREFIX = 'otalan:expo:blocked-rollback-bundles:'
const ROLLBACK_PROTECTION_STORAGE_KEY_PREFIX = 'otalan:expo:rollback-protection:'
const ROLLBACK_REQUEST_STORAGE_KEY_PREFIX = 'otalan:expo:rollback-request:'

export async function rememberPendingExpoRollbackProtectionBundle(
  config: ExpoRollbackProtectionStorageConfig,
  input: {
    targetBundleId?: string
  },
) {
  if (!input.targetBundleId || !resolveExpoRollbackProtectionSettings(config).enabled) {
    return
  }

  await writePendingExpoRollbackProtection(config, {
    targetBundleId: input.targetBundleId,
    stagedAt: Date.now(),
  })
}

export async function prepareExpoRollbackProtectionBeforeReady(
  config: ExpoRollbackProtectionStorageConfig,
  current: ExpoCurrentUpdate,
): Promise<ExpoRollbackProtectionReadyResult> {
  const settings = resolveExpoRollbackProtectionSettings(config)
  if (!settings.enabled) {
    return { action: 'continue', validationDelayMs: 0 }
  }

  const pending = await readPendingExpoRollbackProtection(config)
  if (!pending) {
    return { action: 'continue', validationDelayMs: 0 }
  }

  if (current.isEmbeddedLaunch || current.isEmergencyLaunch) {
    await rememberBlockedExpoRollbackBundle(config, pending.targetBundleId)
    await clearExpoRollbackRequest(config)
    await clearPendingExpoRollbackProtection(config)
    return { action: 'continue', validationDelayMs: 0 }
  }

  if (current.bundleId !== pending.targetBundleId) {
    await clearExpoRollbackRequest(config)
    await clearPendingExpoRollbackProtection(config)
    return { action: 'continue', validationDelayMs: 0 }
  }

  if (pending.launchAttemptedAt !== undefined) {
    await rememberBlockedExpoRollbackBundle(config, pending.targetBundleId)
    await rememberExpoRollbackRequest(config, pending.targetBundleId)
    return {
      action: 'request-rollback',
      targetBundleId: pending.targetBundleId,
    }
  }

  await writePendingExpoRollbackProtection(config, {
    ...pending,
    launchAttemptedAt: Date.now(),
  })

  return {
    action: 'continue',
    validationDelayMs: settings.validationDelayMs,
  }
}

export async function waitForExpoRollbackProtectionValidation(delayMs: number) {
  if (delayMs <= 0) {
    return
  }

  await new Promise((resolve) => setTimeout(resolve, delayMs))
}

export async function clearExpoRollbackProtectionAfterReady(
  config: ExpoRollbackProtectionStorageConfig,
  current: ExpoCurrentUpdate,
) {
  const pending = await readPendingExpoRollbackProtection(config)
  if (pending?.targetBundleId === current.bundleId) {
    await clearPendingExpoRollbackProtection(config)
  }
}

export async function isExpoRollbackProtectionBlockedBundle(
  config: ExpoRollbackProtectionStorageConfig,
  bundleId: string,
) {
  return resolveExpoRollbackProtectionSettings(config).enabled
    && (await readBlockedExpoRollbackBundles(config)).includes(bundleId)
}

export async function getExpoRollbackProtectionRequestContext(
  config: ExpoRollbackProtectionStorageConfig,
): Promise<ExpoRollbackProtectionRequestContext> {
  if (!resolveExpoRollbackProtectionSettings(config).enabled) {
    return { blockedBundleIds: [] }
  }

  const [blockedBundleIds, rollbackTargetBundleId] = await Promise.all([
    readBlockedExpoRollbackBundles(config),
    readExpoRollbackRequest(config),
  ])

  return {
    blockedBundleIds,
    ...(rollbackTargetBundleId ? { rollbackTargetBundleId } : {}),
  }
}

export async function clearExpoRollbackRequest(config: ExpoRollbackProtectionStorageConfig) {
  await removeItem(buildRollbackRequestStorageKey(config))
}

function resolveExpoRollbackProtectionSettings(
  config: ExpoRollbackProtectionStorageConfig,
): ExpoRollbackProtectionSettings {
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

function resolveValidationDelayMs(config: ExpoRollbackProtectionConfig) {
  return typeof config.validationDelayMs === 'number'
    && Number.isFinite(config.validationDelayMs)
    && config.validationDelayMs >= 0
    ? config.validationDelayMs
    : DEFAULT_ROLLBACK_VALIDATION_DELAY_MS
}

async function readPendingExpoRollbackProtection(config: ExpoRollbackProtectionStorageConfig) {
  const value = await getItem(buildRollbackProtectionStorageKey(config))
  if (!value) {
    return undefined
  }

  try {
    const parsed = JSON.parse(value) as unknown
    return isPendingExpoRollbackProtection(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

async function writePendingExpoRollbackProtection(
  config: ExpoRollbackProtectionStorageConfig,
  pending: PendingExpoRollbackProtection,
) {
  await setItem(buildRollbackProtectionStorageKey(config), JSON.stringify(pending))
}

async function clearPendingExpoRollbackProtection(config: ExpoRollbackProtectionStorageConfig) {
  await removeItem(buildRollbackProtectionStorageKey(config))
}

async function rememberBlockedExpoRollbackBundle(
  config: ExpoRollbackProtectionStorageConfig,
  bundleId: string,
) {
  const blockedBundles = await readBlockedExpoRollbackBundles(config)
  const nextBlockedBundles = [
    ...blockedBundles.filter((blockedBundleId) => blockedBundleId !== bundleId),
    bundleId,
  ].slice(-MAX_BLOCKED_ROLLBACK_BUNDLES)

  await writeBlockedExpoRollbackBundles(config, nextBlockedBundles)
}

async function readBlockedExpoRollbackBundles(config: ExpoRollbackProtectionStorageConfig) {
  const value = await getItem(buildBlockedRollbackBundlesStorageKey(config))
  if (!value) {
    return []
  }

  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && item.length > 0)
      : []
  } catch {
    return []
  }
}

async function writeBlockedExpoRollbackBundles(
  config: ExpoRollbackProtectionStorageConfig,
  bundleIds: string[],
) {
  await setItem(buildBlockedRollbackBundlesStorageKey(config), JSON.stringify(bundleIds))
}

async function rememberExpoRollbackRequest(
  config: ExpoRollbackProtectionStorageConfig,
  bundleId: string,
) {
  await setItem(buildRollbackRequestStorageKey(config), bundleId)
}

async function readExpoRollbackRequest(config: ExpoRollbackProtectionStorageConfig) {
  return await getItem(buildRollbackRequestStorageKey(config)) ?? undefined
}

function isPendingExpoRollbackProtection(value: unknown): value is PendingExpoRollbackProtection {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const record = value as Partial<PendingExpoRollbackProtection>

  return typeof record.targetBundleId === 'string'
    && record.targetBundleId.length > 0
    && typeof record.stagedAt === 'number'
    && Number.isFinite(record.stagedAt)
    && (
      record.launchAttemptedAt === undefined
      || (typeof record.launchAttemptedAt === 'number' && Number.isFinite(record.launchAttemptedAt))
    )
}

function buildRollbackProtectionStorageKey(config: ExpoRollbackProtectionStorageConfig) {
  return `${ROLLBACK_PROTECTION_STORAGE_KEY_PREFIX}${buildStorageKeySuffix(config)}`
}

function buildBlockedRollbackBundlesStorageKey(config: ExpoRollbackProtectionStorageConfig) {
  return `${BLOCKED_ROLLBACK_BUNDLES_STORAGE_KEY_PREFIX}${buildStorageKeySuffix(config)}`
}

function buildRollbackRequestStorageKey(config: ExpoRollbackProtectionStorageConfig) {
  return `${ROLLBACK_REQUEST_STORAGE_KEY_PREFIX}${buildStorageKeySuffix(config)}`
}

function buildStorageKeySuffix(config: ExpoRollbackProtectionStorageConfig) {
  return [
    config.appId,
    config.channel,
    config.deviceId,
  ].map(encodeURIComponent).join(':')
}

async function getItem(key: string) {
  try {
    return await AsyncStorage.getItem(key)
  } catch {
    return null
  }
}

async function setItem(key: string, value: string) {
  try {
    await AsyncStorage.setItem(key, value)
  } catch {
    // If storage is unavailable, the normal update flow still works without rollback protection.
  }
}

async function removeItem(key: string) {
  try {
    await AsyncStorage.removeItem(key)
  } catch {
    // Best effort cleanup only.
  }
}
