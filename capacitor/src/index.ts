import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { LiveUpdate } from '@capawesome/capacitor-live-update'

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type OtaCheckResponse =
  | { updateAvailable: false }
  | {
    updateAvailable: true
    bundleId: string
    downloadUrl: string
    checksum?: string | null
    mandatory?: boolean
    rolloutPercent?: number
    releaseNotes?: string | null
  }

type OtaPlatform = 'ios' | 'android'

export type CapacitorUpdaterConfig = {
  apiUrl: string
  apiKey: string
  appId: string
  channel: string
  nativeVersion?: string
  platform?: 'ios' | 'android'
  deviceId: string
  autoConfirm?: boolean
  reloadOnSync?: boolean
  headers?: HeadersInit
  logger?: Pick<Console, 'warn'>
}

export type CapacitorSyncResult =
  | { updateAvailable: false }
  | {
    updateAvailable: true
    applied: boolean
    bundleId: string
    mandatory: boolean
    releaseNotes?: string | null
    reloadRequired?: boolean
  }

export type CapacitorSyncTrigger = 'launch' | 'resume' | 'manual'

export type InitializeCapacitorUpdaterConfig = Omit<CapacitorUpdaterConfig, 'appId' | 'logger'> & {
  appId?: string
  enabled?: boolean
  onResume?: boolean
  logger?: Pick<Console, 'warn' | 'info'>
}

export type InitializedCapacitorUpdater = {
  getUpdater: () => Promise<ReturnType<typeof createUpdater> | null>
  sync: (trigger?: CapacitorSyncTrigger) => Promise<CapacitorSyncResult | null>
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function joinUrl(base: string, pathname: string) {
  return `${base.replace(/\/+$/, '')}/${pathname.replace(/^\/+/, '')}`
}

function buildHeaders(config: CapacitorUpdaterConfig, extra?: HeadersInit) {
  return {
    'Content-Type': 'application/json',
    'x-api-key': config.apiKey,
    ...config.headers,
    ...extra,
  }
}

async function parseJsonResponse<T>(response: Response) {
  if (response.status === 204 || response.status === 205) {
    return undefined as T
  }

  const contentLength = response.headers.get('content-length')
  if (contentLength === '0') {
    return undefined as T
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    return undefined as T
  }

  return response.json() as Promise<T>
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

  return parseJsonResponse<T>(response)
}

async function resolveNativeVersion(config: CapacitorUpdaterConfig) {
  if (config.nativeVersion) {
    return config.nativeVersion
  }

  const result = await LiveUpdate.getVersionName()
  return result.versionName
}

function resolvePlatform(config: CapacitorUpdaterConfig) {
  const platform = config.platform ?? Capacitor.getPlatform()

  if (platform !== 'ios' && platform !== 'android') {
    throw new Error(`Unsupported Capacitor platform: ${platform}`)
  }

  return platform
}

function requireDeviceId(config: Pick<CapacitorUpdaterConfig, 'deviceId'>) {
  if (!config.deviceId) {
    throw new Error('Otalan Capacitor updater requires deviceId because POST /capacitor/confirm requires it.')
  }

  return config.deviceId
}

function isNativeOtaPlatform(platform: string): platform is OtaPlatform {
  return platform === 'ios' || platform === 'android'
}

async function confirmInstall(config: CapacitorUpdaterConfig, input: {
  platform: 'ios' | 'android'
  bundleId: string
  deviceId: string
}) {
  if (!config.autoConfirm && config.autoConfirm !== undefined) {
    return
  }

  await postJson(
    joinUrl(config.apiUrl, '/capacitor/confirm'),
    {
      appId: config.appId,
      platform: input.platform,
      bundleId: input.bundleId,
      deviceId: input.deviceId,
    },
    buildHeaders(config),
  )
}

async function hasDownloadedBundle(bundleId: string) {
  const result = await LiveUpdate.getDownloadedBundles()
  return result.bundleIds.includes(bundleId)
}

async function ensureBundleIsAvailable(
  bundle: Extract<OtaCheckResponse, { updateAvailable: true }>,
) {
  if (await hasDownloadedBundle(bundle.bundleId)) {
    return
  }

  try {
    await LiveUpdate.downloadBundle({
      url: bundle.downloadUrl,
      bundleId: bundle.bundleId,
      checksum: bundle.checksum ?? undefined,
    })
  } catch (error) {
    if (await hasDownloadedBundle(bundle.bundleId)) {
      return
    }

    throw error
  }
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export async function initializeUpdater(
  config: InitializeCapacitorUpdaterConfig,
): Promise<InitializedCapacitorUpdater> {
  const logger = config.logger ?? console
  const onResume = config.onResume ?? true

  let initializePromise: Promise<void> | null = null
  let updaterPromise: Promise<ReturnType<typeof createUpdater> | null> | null = null
  let inFlightSync: Promise<CapacitorSyncResult | null> | null = null
  let resumeListenerRegistered = false

  function isEnabled() {
    return config.enabled ?? (
      Capacitor.isNativePlatform()
      && Boolean(config.apiUrl)
      && Boolean(config.apiKey)
    )
  }

  async function getUpdater(): Promise<ReturnType<typeof createUpdater> | null> {
    if (!isEnabled()) {
      return null
    }

    if (updaterPromise) {
      return updaterPromise
    }

    updaterPromise = (async () => {
      const platform = config.platform ?? Capacitor.getPlatform()
      if (!isNativeOtaPlatform(platform)) {
        return null
      }

      const appId = config.appId ?? (await CapacitorApp.getInfo()).id
      const updaterConfig: CapacitorUpdaterConfig = {
        apiUrl: config.apiUrl,
        apiKey: config.apiKey,
        appId,
        channel: config.channel,
        nativeVersion: config.nativeVersion,
        platform,
        deviceId: config.deviceId,
        autoConfirm: config.autoConfirm,
        reloadOnSync: config.reloadOnSync,
        headers: config.headers,
        logger,
      }

      return createUpdater(updaterConfig)
    })().catch((error) => {
      updaterPromise = null
      throw error
    })

    return updaterPromise
  }

  async function sync(trigger: CapacitorSyncTrigger = 'manual') {
    const updater = await getUpdater()
    if (!updater) {
      return null
    }

    if (inFlightSync) {
      return inFlightSync
    }

    inFlightSync = updater.sync().then((result) => {
      if (result.updateAvailable && result.reloadRequired) {
        logger.info?.('[ota] update downloaded and staged', {
          bundleId: result.bundleId,
        })
      }

      return result
    }).catch((error) => {
      logger.warn(`[ota] ${trigger} sync failed`, error)
      return null
    }).finally(() => {
      inFlightSync = null
    })

    return inFlightSync
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
        CapacitorApp.addListener('resume', () => {
          void sync('resume')
        })
        resumeListenerRegistered = true
      }

      await sync('launch')
    })().catch((error) => {
      initializePromise = null
      logger.warn('Otalan initializeUpdater() failed.', error)
    })

    return initializePromise
  }

  const updater = {
    getUpdater,
    sync,
  }

  await initialize()
  return updater
}

export function createUpdater(config: CapacitorUpdaterConfig) {
  const logger = config.logger ?? console
  const deviceId = requireDeviceId(config)
  let confirmedBundleId: string | null = null

  return {
    async ready() {
      const result = await LiveUpdate.ready()

      if (result.currentBundleId && result.currentBundleId !== confirmedBundleId) {
        const platform = resolvePlatform(config)

        await confirmInstall(config, {
          platform,
          bundleId: result.currentBundleId,
          deviceId,
        }).catch((error) => {
          logger.warn('Otalan install confirmation failed.', error)
        })

        confirmedBundleId = result.currentBundleId
      }

      return result
    },

    async getCurrentBundleId() {
      const current = await LiveUpdate.getCurrentBundle()
      return current.bundleId ?? undefined
    },

    async check() {
      const platform = resolvePlatform(config)
      const nativeVersion = await resolveNativeVersion(config)
      const currentBundle = await LiveUpdate.getCurrentBundle()

      return postJson<OtaCheckResponse>(
        joinUrl(config.apiUrl, '/capacitor/check'),
        {
          appId: config.appId,
          platform,
          channel: config.channel,
          nativeVersion,
          currentBundleId: currentBundle.bundleId ?? undefined,
          deviceId,
        },
        buildHeaders(config),
      )
    },

    async sync(): Promise<CapacitorSyncResult> {
      await this.ready().catch((error) => {
        logger.warn('Otalan ready() failed.', error)
      })

      const currentBundle = await LiveUpdate.getCurrentBundle()
      const nextBundle = await LiveUpdate.getNextBundle()
      const check = await this.check()

      if (!check.updateAvailable) {
        return { updateAvailable: false }
      }

      if (check.bundleId === currentBundle.bundleId) {
        return { updateAvailable: false }
      }

      if (check.bundleId === nextBundle.bundleId) {
        if (config.reloadOnSync !== false) {
          await LiveUpdate.reload()
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

      await ensureBundleIsAvailable(check)

      await LiveUpdate.setNextBundle({
        bundleId: check.bundleId,
      })

      if (config.reloadOnSync !== false) {
        await LiveUpdate.reload()
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
