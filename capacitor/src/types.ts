export type OtaPlatform = 'ios' | 'android'

export type CapacitorUpdateCompatibility = {
  appId: string
  platform: OtaPlatform
  runtimeVersion: string
}

export type CapacitorCheckResult =
  | (CapacitorUpdateCompatibility & { updateAvailable: false })
  | (CapacitorUpdateCompatibility & {
    updateAvailable: true
    bundleId: string
    downloadUrl: string
    checksum?: string | null
    mandatory?: boolean
    rolloutPercent?: number
    releaseNotes?: string | null
  })

export type OtaCheckResponse = CapacitorCheckResult

export type DeviceIdStorage = {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
}

/** @experimental Advisory client-reported transfer metadata. */
export type CapacitorTransferSource = 'downloaded' | 'cached'

export type CapacitorUpdaterConfig = {
  apiUrl: string
  apiKey: string
  appId: string
  channel: string
  runtimeVersion?: string
  platform?: OtaPlatform
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
    /** @experimental Advisory client-reported transfer metadata. */
    transferSource: CapacitorTransferSource
    releaseNotes?: string | null
    reloadRequired?: boolean
  }

export type CapacitorSyncTrigger = 'launch' | 'resume' | 'manual'

export type InitializeCapacitorUpdaterConfig = Omit<CapacitorUpdaterConfig, 'appId' | 'deviceId' | 'logger'> & {
  appId?: string
  deviceId?: string
  deviceIdStorage?: DeviceIdStorage
  deviceIdStorageKey?: string
  enabled?: boolean
  onResume?: boolean
  logger?: Pick<Console, 'warn' | 'info'>
}
