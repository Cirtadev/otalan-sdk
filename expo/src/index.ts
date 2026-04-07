import { Platform } from 'react-native'
import * as Updates from 'expo-updates'

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type OtaCheckResponse =
  | { updateAvailable: false }
  | {
    updateAvailable: true
    bundleId: string
    mandatory?: boolean
    releaseNotes?: string | null
  }

export type ExpoUpdaterConfig = {
  apiUrl: string
  apiKey: string
  appId: string
  channel: string
  runtimeVersion?: string
  currentBundleId?: string | (() => string | null | undefined | Promise<string | null | undefined>)
  deviceId?: string
  autoConfirm?: boolean
  reloadOnSync?: boolean
  headers?: HeadersInit
  logger?: Pick<Console, 'warn'>
  storage?: {
    getItem: (key: string) => string | null | undefined | Promise<string | null | undefined>
    setItem: (key: string, value: string) => void | Promise<void>
    removeItem?: (key: string) => void | Promise<void>
  }
  storageKeyPrefix?: string
}

export type ExpoSyncResult =
  | { updateAvailable: false }
  | {
    updateAvailable: true
    applied: boolean
    bundleId: string
    mandatory: boolean
    releaseNotes?: string | null
    reloadRequired?: boolean
  }

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function joinUrl(base: string, pathname: string) {
  return `${base.replace(/\/+$/, '')}/${pathname.replace(/^\/+/, '')}`
}

function buildHeaders(config: ExpoUpdaterConfig, extra?: HeadersInit) {
  return {
    'Content-Type': 'application/json',
    'x-api-key': config.apiKey,
    ...config.headers,
    ...extra,
  }
}

function resolvePlatform() {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    throw new Error(`Unsupported Expo platform: ${Platform.OS}`)
  }

  return Platform.OS
}

function resolveRuntimeVersion(config: ExpoUpdaterConfig) {
  const runtimeVersion = config.runtimeVersion ?? Updates.runtimeVersion

  if (!runtimeVersion) {
    throw new Error('Expo runtimeVersion is required. Pass it to createUpdater or configure expo-updates runtimeVersion.')
  }

  return runtimeVersion
}

const memoryStorage = new Map<string, string>()

function getStorage(config: ExpoUpdaterConfig) {
  return config.storage ?? {
    getItem(key: string) {
      return memoryStorage.get(key)
    },
    setItem(key: string, value: string) {
      memoryStorage.set(key, value)
    },
    removeItem(key: string) {
      memoryStorage.delete(key)
    },
  }
}

function getStorageKey(config: ExpoUpdaterConfig, suffix: string) {
  const prefix = config.storageKeyPrefix ?? `otalan:${config.appId}:${config.channel}`
  return `${prefix}:${suffix}`
}

async function resolveConfiguredCurrentBundleId(config: ExpoUpdaterConfig) {
  if (!config.currentBundleId) {
    return undefined
  }

  if (typeof config.currentBundleId === 'function') {
    const resolved = await config.currentBundleId()
    return resolved ?? undefined
  }

  return config.currentBundleId
}

async function postJson<T>(url: string, body: unknown, headers: HeadersInit) {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as {
      message?: string
    }

    throw new Error(payload.message ?? `Request failed with status ${response.status}`)
  }

  return response.json() as Promise<T>
}

async function confirmInstall(config: ExpoUpdaterConfig, input: {
  bundleId: string
  deviceId?: string
}) {
  if (!config.autoConfirm && config.autoConfirm !== undefined) {
    return
  }

  if (!input.deviceId) {
    return
  }

  await postJson(
    joinUrl(config.apiUrl, '/otalan/confirm'),
    {
      appId: config.appId,
      platform: resolvePlatform(),
      bundleId: input.bundleId,
      deviceId: input.deviceId,
    },
    buildHeaders(config),
  )
}

async function getStoredBundleId(
  config: ExpoUpdaterConfig,
  suffix: 'current' | 'pending' | 'confirmed',
) {
  const value = await getStorage(config).getItem(getStorageKey(config, suffix))
  return value ?? undefined
}

async function setStoredBundleId(
  config: ExpoUpdaterConfig,
  suffix: 'current' | 'pending' | 'confirmed',
  value?: string,
) {
  const storage = getStorage(config)
  const key = getStorageKey(config, suffix)

  if (!value) {
    await storage.removeItem?.(key)
    return
  }

  await storage.setItem(key, value)
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export function createUpdater(config: ExpoUpdaterConfig) {
  const logger = config.logger ?? console

  return {
    async ready() {
      const pendingBundleId = await getStoredBundleId(config, 'pending')
      let currentBundleId = await getStoredBundleId(config, 'current')
      const confirmedBundleId = await getStoredBundleId(config, 'confirmed')

      if (pendingBundleId) {
        currentBundleId = pendingBundleId
        await setStoredBundleId(config, 'current', pendingBundleId)
        await setStoredBundleId(config, 'pending')
      }

      if (!currentBundleId) {
        currentBundleId = await resolveConfiguredCurrentBundleId(config)

        if (currentBundleId) {
          await setStoredBundleId(config, 'current', currentBundleId)
        }
      }

      if (currentBundleId && currentBundleId !== confirmedBundleId) {
        await confirmInstall(config, {
          bundleId: currentBundleId,
          deviceId: config.deviceId,
        }).then(async () => {
          await setStoredBundleId(config, 'confirmed', currentBundleId)
        }).catch((error) => {
          logger.warn('Otalan install confirmation failed.', error)
        })
      }

      return {
        currentBundleId,
        rollback: false,
      }
    },

    async check() {
      const currentBundleId = await getStoredBundleId(config, 'current')

      return postJson<OtaCheckResponse>(
        joinUrl(config.apiUrl, '/otalan/check'),
        {
          appId: config.appId,
          platform: resolvePlatform(),
          channel: config.channel,
          nativeVersion: resolveRuntimeVersion(config),
          currentBundleId,
          deviceId: config.deviceId,
        },
        buildHeaders(config),
      )
    },

    async sync(): Promise<ExpoSyncResult> {
      await this.ready().catch((error) => {
        logger.warn('Otalan ready() failed.', error)
      })

      const currentBundleId = await getStoredBundleId(config, 'current')
      const pendingBundleId = await getStoredBundleId(config, 'pending')
      const check = await this.check()

      if (!check.updateAvailable) {
        return { updateAvailable: false }
      }

      if (check.bundleId === currentBundleId) {
        return { updateAvailable: false }
      }

      if (check.bundleId === pendingBundleId) {
        if (config.reloadOnSync !== false) {
          await Updates.reloadAsync()
        }

        return {
          updateAvailable: true,
          applied: true,
          bundleId: check.bundleId,
          mandatory: check.mandatory ?? true,
          releaseNotes: check.releaseNotes,
          reloadRequired: config.reloadOnSync === false,
        }
      }

      const expoCheck = await Updates.checkForUpdateAsync()

      if (!expoCheck.isAvailable) {
        return {
          updateAvailable: true,
          applied: false,
          bundleId: check.bundleId,
          mandatory: check.mandatory ?? true,
          releaseNotes: check.releaseNotes,
        }
      }

      await Updates.fetchUpdateAsync()
      await setStoredBundleId(config, 'pending', check.bundleId)

      if (config.reloadOnSync !== false) {
        await Updates.reloadAsync()
      }

      return {
        updateAvailable: true,
        applied: true,
        bundleId: check.bundleId,
        mandatory: check.mandatory ?? true,
        releaseNotes: check.releaseNotes,
        reloadRequired: config.reloadOnSync === false,
      }
    },
  }
}
