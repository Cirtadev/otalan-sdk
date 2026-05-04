export type OtaCheckResponse =
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

export type OtaPlatform = 'ios' | 'android'

export type CapacitorTransferSource = 'downloaded' | 'cached'

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
    transferSource: CapacitorTransferSource
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
