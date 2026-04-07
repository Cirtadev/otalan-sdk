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

export type CapacitorUpdaterConfig = {
  apiUrl: string
  apiKey: string
  appId: string
  channel: string
  nativeVersion?: string
  platform?: 'ios' | 'android'
  deviceId?: string
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

async function resolveDeviceId(config: CapacitorUpdaterConfig) {
  if (config.deviceId) {
    return config.deviceId
  }

  const result = await LiveUpdate.getDeviceId()
  return result.deviceId
}

async function confirmInstall(config: CapacitorUpdaterConfig, input: {
  platform: 'ios' | 'android'
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

export function createUpdater(config: CapacitorUpdaterConfig) {
  const logger = config.logger ?? console

  return {
    async ready() {
      const result = await LiveUpdate.ready()

      if (result.currentBundleId) {
        const platform = resolvePlatform(config)
        const deviceId = await resolveDeviceId(config).catch(() => config.deviceId)

        await confirmInstall(config, {
          platform,
          bundleId: result.currentBundleId,
          deviceId,
        }).catch((error) => {
          logger.warn('Otalan install confirmation failed.', error)
        })
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
      const deviceId = await resolveDeviceId(config).catch(() => config.deviceId)

      return postJson<OtaCheckResponse>(
        joinUrl(config.apiUrl, '/otalan/check'),
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
