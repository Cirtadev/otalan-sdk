import { beforeEach, describe, expect, mock, test } from 'bun:test'

// -----------------------------------------------------------------------------
// Mock State
// -----------------------------------------------------------------------------

function createExpoManifest() {
  return {
    id: 'update-1',
    runtimeVersion: '1.0.0',
    metadata: {
      bundleId: 'bundle-1',
      channel: 'production',
    },
    extra: {
      otalan: {
        bundleId: 'bundle-1',
        runtimeVersion: '1.0.0',
        releaseNotes: null,
      },
    },
  }
}

const asyncStorageState = {
  storedItems: new Map<string, string>(),
}

const expoState = {
  platformOs: 'ios' as 'ios' | 'android' | 'web',
  isEnabled: true,
  isEmbeddedLaunch: true,
  isEmergencyLaunch: false,
  runtimeVersion: '1.0.0' as string | null,
  updateId: 'update-1' as string | undefined,
  manifest: createExpoManifest(),
  extraParamCalls: [] as Array<{ key: string; value: string | null | undefined }>,
  requestHeaderOverrideCalls: [] as Array<Record<string, string> | null>,
  checkCalls: 0,
  fetchCalls: 0,
  reloadCalls: 0,
  checkError: null as Error | null,
  checkResult: {
    isAvailable: true,
    isRollBackToEmbedded: false,
  },
}

// -----------------------------------------------------------------------------
// Module Mocks
// -----------------------------------------------------------------------------

function applyModuleMocks() {
  mock.module('@react-native-async-storage/async-storage', () => ({
    default: {
      getItem: async (key: string) => asyncStorageState.storedItems.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        asyncStorageState.storedItems.set(key, value)
      },
    },
  }))

  mock.module('react-native', () => ({
    Platform: {
      OS: expoState.platformOs,
    },
  }))

  mock.module('expo-updates', () => ({
    isEnabled: expoState.isEnabled,
    isEmbeddedLaunch: expoState.isEmbeddedLaunch,
    isEmergencyLaunch: expoState.isEmergencyLaunch,
    runtimeVersion: expoState.runtimeVersion,
    updateId: expoState.updateId,
    manifest: expoState.manifest,
    setExtraParamAsync: async (key: string, value: string | null | undefined) => {
      expoState.extraParamCalls.push({ key, value })
    },
    setUpdateRequestHeadersOverride: (headers: Record<string, string> | null) => {
      expoState.requestHeaderOverrideCalls.push(headers)
    },
    checkForUpdateAsync: async () => {
      expoState.checkCalls += 1

      if (expoState.checkError) {
        throw expoState.checkError
      }

      return expoState.checkResult
    },
    fetchUpdateAsync: async () => {
      expoState.fetchCalls += 1
      return { isNew: true, isRollBackToEmbedded: false }
    },
    reloadAsync: async () => {
      expoState.reloadCalls += 1
    },
  }))

  mock.module('expo-application', () => ({
    getAndroidId: () => null,
    getIosIdForVendorAsync: async () => null,
  }))
}

// -----------------------------------------------------------------------------
// Test Helpers
// -----------------------------------------------------------------------------

let importCounter = 0

async function loadSdk() {
  importCounter += 1
  applyModuleMocks()
  return import(`../src/index?check=${importCounter}`)
}

beforeEach(() => {
  asyncStorageState.storedItems = new Map()

  expoState.platformOs = 'ios'
  expoState.isEnabled = true
  expoState.isEmbeddedLaunch = true
  expoState.isEmergencyLaunch = false
  expoState.runtimeVersion = '1.0.0'
  expoState.updateId = 'update-1'
  expoState.manifest = createExpoManifest()
  expoState.extraParamCalls = []
  expoState.requestHeaderOverrideCalls = []
  expoState.checkCalls = 0
  expoState.fetchCalls = 0
  expoState.reloadCalls = 0
  expoState.checkError = null
  expoState.checkResult = {
    isAvailable: true,
    isRollBackToEmbedded: false,
  }
})

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('@otalan/expo check', () => {
  test('initialized check sets Otalan update context without fetching or reloading', async () => {
    const {
      OTALAN_EXPO_BLOCKED_BUNDLE_IDS_EXTRA_PARAM_KEY,
      OTALAN_EXPO_DEVICE_ID_EXTRA_PARAM_KEY,
      OTALAN_EXPO_ROLLBACK_TARGET_BUNDLE_ID_EXTRA_PARAM_KEY,
      initializeUpdater,
    } = await loadSdk()

    const updater = await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
    })

    await expect(updater.check()).resolves.toEqual({ updateAvailable: true })

    expect(expoState.extraParamCalls).toEqual([
      { key: OTALAN_EXPO_DEVICE_ID_EXTRA_PARAM_KEY, value: 'device-1' },
      { key: OTALAN_EXPO_BLOCKED_BUNDLE_IDS_EXTRA_PARAM_KEY, value: null },
      { key: OTALAN_EXPO_ROLLBACK_TARGET_BUNDLE_ID_EXTRA_PARAM_KEY, value: null },
    ])
    expect(expoState.requestHeaderOverrideCalls).toEqual([
      { 'x-api-key': 'otalan_ota_xxx' },
    ])
    expect(expoState.checkCalls).toBe(1)
    expect(expoState.fetchCalls).toBe(0)
    expect(expoState.reloadCalls).toBe(0)
  })

  test('initialized check returns false when Expo has no update', async () => {
    expoState.checkResult = {
      isAvailable: false,
      isRollBackToEmbedded: false,
    }

    const { initializeUpdater } = await loadSdk()
    const updater = await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
    })

    await expect(updater.check()).resolves.toEqual({ updateAvailable: false })
    expect(expoState.fetchCalls).toBe(0)
    expect(expoState.reloadCalls).toBe(0)
  })

  test('initialized check returns false without fetching when Expo check fails', async () => {
    expoState.checkError = new Error('check failed')
    const warnCalls: unknown[][] = []

    const { initializeUpdater } = await loadSdk()
    const updater = await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
      logger: {
        warn: (...args: unknown[]) => {
          warnCalls.push(args)
        },
      },
    })

    await expect(updater.check()).resolves.toEqual({ updateAvailable: false })
    expect(warnCalls[0]?.[0]).toBe('Otalan Expo check failed.')
    expect(expoState.fetchCalls).toBe(0)
    expect(expoState.reloadCalls).toBe(0)
  })

  test('low-level check treats rollback responses as an available update', async () => {
    expoState.checkResult = {
      isAvailable: false,
      isRollBackToEmbedded: true,
    }

    const { createUpdater } = await loadSdk()
    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
    })

    await expect(updater.check()).resolves.toEqual({ updateAvailable: true })
    expect(expoState.checkCalls).toBe(1)
    expect(expoState.fetchCalls).toBe(0)
    expect(expoState.reloadCalls).toBe(0)
  })
})
