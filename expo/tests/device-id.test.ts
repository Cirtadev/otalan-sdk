import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

type FetchCall = {
  url: string
  init?: RequestInit
}

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
  getItemCalls: [] as string[],
  setItemCalls: [] as Array<{ key: string; value: string }>,
  storedValue: null as string | null,
  storedItems: new Map<string, string>(),
  getItemError: null as Error | null,
  setItemError: null as Error | null,
}

const expoState = {
  platformOs: 'ios' as 'ios' | 'android' | 'web',
  isEnabled: true,
  isEmbeddedLaunch: false,
  isEmergencyLaunch: false,
  runtimeVersion: '1.0.0' as string | null,
  updateId: 'update-1' as string | undefined,
  manifest: createExpoManifest(),
  extraParamCalls: [] as Array<{ key: string; value: string | null | undefined }>,
  requestHeaderOverrideCalls: [] as Array<Record<string, string> | null>,
  checkCalls: 0,
  fetchCalls: 0,
  reloadCalls: 0,
  checkResult: {
    isAvailable: true,
    isRollBackToEmbedded: false,
  },
  fetchResult: {
    isNew: true,
    isRollBackToEmbedded: false,
  },
}

const applicationState = {
  androidId: 'android-device-1' as string | null,
  iosId: null as string | null,
  getAndroidIdCalls: 0,
  getIosIdForVendorCalls: 0,
  getAndroidIdError: null as Error | null,
  getIosIdForVendorError: null as Error | null,
}

const fetchState = {
  calls: [] as FetchCall[],
  handler: async (url: string, init?: RequestInit) => {
    void url
    void init
    return Response.json({ ok: true })
  },
}

const originalDateNow = Date.now
const originalFetch = globalThis.fetch
const originalMathRandom = Math.random
let importCounter = 0

function applyModuleMocks() {
  mock.module('@react-native-async-storage/async-storage', () => ({
    default: {
      getItem: async (key: string) => {
        asyncStorageState.getItemCalls.push(key)

        if (asyncStorageState.getItemError) {
          throw asyncStorageState.getItemError
        }

        return asyncStorageState.storedItems.get(key) ?? null
      },
      setItem: async (key: string, value: string) => {
        asyncStorageState.setItemCalls.push({ key, value })

        if (asyncStorageState.setItemError) {
          throw asyncStorageState.setItemError
        }

        asyncStorageState.storedItems.set(key, value)
        if (!key.startsWith('otalan:expo:confirmed-install:')) {
          asyncStorageState.storedValue = value
        }
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
      return expoState.checkResult
    },
    fetchUpdateAsync: async () => {
      expoState.fetchCalls += 1
      return expoState.fetchResult
    },
    reloadAsync: async () => {
      expoState.reloadCalls += 1
    },
  }))

  mock.module('expo-application', () => ({
    getAndroidId: () => {
      applicationState.getAndroidIdCalls += 1

      if (applicationState.getAndroidIdError) {
        throw applicationState.getAndroidIdError
      }

      return applicationState.androidId
    },
    getIosIdForVendorAsync: async () => {
      applicationState.getIosIdForVendorCalls += 1

      if (applicationState.getIosIdForVendorError) {
        throw applicationState.getIosIdForVendorError
      }

      return applicationState.iosId
    },
  }))
}

async function loadSdk() {
  importCounter += 1
  applyModuleMocks()
  return import(`../src/index?device-id=${importCounter}`)
}

function readJsonBody(call: FetchCall) {
  return JSON.parse(String(call.init?.body)) as Record<string, unknown>
}

function createLogger() {
  const warnCalls: unknown[][] = []

  return {
    warnCalls,
    logger: {
      warn: (...args: unknown[]) => {
        warnCalls.push(args)
      },
    },
  }
}

async function waitForFetchCalls(count: number) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    if (fetchState.calls.length >= count) {
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  throw new Error(`Expected at least ${count} fetch call(s), received ${fetchState.calls.length}.`)
}

beforeEach(() => {
  asyncStorageState.getItemCalls = []
  asyncStorageState.setItemCalls = []
  asyncStorageState.storedValue = null
  asyncStorageState.storedItems = new Map()
  asyncStorageState.getItemError = null
  asyncStorageState.setItemError = null

  expoState.platformOs = 'ios'
  expoState.isEnabled = true
  expoState.isEmbeddedLaunch = false
  expoState.isEmergencyLaunch = false
  expoState.runtimeVersion = '1.0.0'
  expoState.updateId = 'update-1'
  expoState.manifest = createExpoManifest()
  expoState.extraParamCalls = []
  expoState.requestHeaderOverrideCalls = []
  expoState.checkCalls = 0
  expoState.fetchCalls = 0
  expoState.reloadCalls = 0
  expoState.checkResult = {
    isAvailable: true,
    isRollBackToEmbedded: false,
  }
  expoState.fetchResult = {
    isNew: true,
    isRollBackToEmbedded: false,
  }

  applicationState.androidId = 'android-device-1'
  applicationState.iosId = null
  applicationState.getAndroidIdCalls = 0
  applicationState.getIosIdForVendorCalls = 0
  applicationState.getAndroidIdError = null
  applicationState.getIosIdForVendorError = null

  fetchState.calls = []
  fetchState.handler = async (url: string, init?: RequestInit) => {
    void url
    void init
    return Response.json({ ok: true })
  }

  globalThis.fetch = (async (input, init) => {
    fetchState.calls.push({
      url: String(input),
      init,
    })

    return fetchState.handler(String(input), init)
  }) as typeof fetch

  Date.now = originalDateNow
  Math.random = originalMathRandom
})

afterAll(() => {
  globalThis.fetch = originalFetch
  Date.now = originalDateNow
  Math.random = originalMathRandom
})

describe('@otalan/expo device id resolver', () => {
  test('creates and persists a generated device id when platform ids are unavailable', async () => {
    Date.now = () => 1_700_000_000_000
    Math.random = () => 0.123456789

    const { initializeUpdater } = await loadSdk()
    fetchState.handler = async (_url, init) => {
      const body = readJsonBody({ url: '', init })

      expect(body.deviceId).toBe(asyncStorageState.storedValue)
      expect(body.transferSource).toBe('downloaded')
      return Response.json({ ok: true })
    }

    const updater = await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
    })

    await waitForFetchCalls(1)

    expect(asyncStorageState.getItemCalls).toContain('otalan-device-id')
    const deviceIdWrite = asyncStorageState.setItemCalls.find(call => call.key === 'otalan-device-id')
    expect(deviceIdWrite?.value.startsWith('otalan-expo-')).toBe(true)
    expect(await updater.getDeviceId()).toBe(asyncStorageState.storedValue)
    expect(fetchState.calls).toHaveLength(1)
  })

  test('uses an explicit device id without platform or storage lookup', async () => {
    expoState.platformOs = 'android'
    asyncStorageState.storedItems.set('otalan-device-id', 'stale-storage-device')

    const { initializeUpdater } = await loadSdk()
    fetchState.handler = async (_url, init) => {
      expect(readJsonBody({ url: '', init }).deviceId).toBe('explicit-device')
      return Response.json({ ok: true })
    }

    const updater = await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'explicit-device',
    })

    await waitForFetchCalls(1)

    expect(await updater.getDeviceId()).toBe('explicit-device')
    expect(applicationState.getAndroidIdCalls).toBe(0)
    expect(applicationState.getIosIdForVendorCalls).toBe(0)
    expect(asyncStorageState.getItemCalls).not.toContain('otalan-device-id')
    expect(asyncStorageState.setItemCalls.map(call => call.key)).not.toContain('otalan-device-id')
    expect(fetchState.calls).toHaveLength(1)
  })

  test('falls through to platform id when explicit device id is blank', async () => {
    expoState.platformOs = 'android'
    asyncStorageState.storedItems.set('otalan-device-id', 'stale-storage-device')

    const { initializeUpdater } = await loadSdk()
    fetchState.handler = async (_url, init) => {
      expect(readJsonBody({ url: '', init }).deviceId).toBe('android-device-1')
      return Response.json({ ok: true })
    }

    const updater = await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: '   ',
    })

    await waitForFetchCalls(1)

    expect(await updater.getDeviceId()).toBe('android-device-1')
    expect(applicationState.getAndroidIdCalls).toBe(1)
    expect(asyncStorageState.setItemCalls.filter(call => call.key === 'otalan-device-id')).toEqual([
      { key: 'otalan-device-id', value: 'android-device-1' },
    ])
    expect(fetchState.calls).toHaveLength(1)
  })

  test('falls back to an existing stored device id when iOS vendor id is unavailable', async () => {
    asyncStorageState.storedItems.set('otalan-device-id', 'otalan-expo-old-ios')

    const { initializeUpdater } = await loadSdk()
    fetchState.handler = async (_url, init) => {
      expect(readJsonBody({ url: '', init }).deviceId).toBe('otalan-expo-old-ios')
      return Response.json({ ok: true })
    }

    const updater = await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
    })

    await waitForFetchCalls(1)

    expect(await updater.getDeviceId()).toBe('otalan-expo-old-ios')
    expect(applicationState.getAndroidIdCalls).toBe(0)
    expect(applicationState.getIosIdForVendorCalls).toBe(1)
    expect(asyncStorageState.setItemCalls.filter(call => call.key === 'otalan-device-id')).toHaveLength(0)
    expect(fetchState.calls).toHaveLength(1)
  })

  test('falls back to stored device ids when iOS vendor lookup fails', async () => {
    applicationState.getIosIdForVendorError = new Error('ios vendor unavailable')
    asyncStorageState.storedItems.set('otalan-device-id', 'otalan-expo-old-ios')

    const { initializeUpdater } = await loadSdk()
    const logger = createLogger()
    fetchState.handler = async (_url, init) => {
      expect(readJsonBody({ url: '', init }).deviceId).toBe('otalan-expo-old-ios')
      return Response.json({ ok: true })
    }

    const updater = await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      logger: logger.logger,
    })

    await waitForFetchCalls(1)

    expect(await updater.getDeviceId()).toBe('otalan-expo-old-ios')
    expect(applicationState.getIosIdForVendorCalls).toBe(1)
    expect(logger.warnCalls).toHaveLength(0)
    expect(fetchState.calls).toHaveLength(1)
  })

  test('uses the iOS vendor id when available', async () => {
    applicationState.iosId = 'ios-vendor-1'
    asyncStorageState.storedItems.set('otalan-device-id', 'otalan-expo-old-ios')

    const { initializeUpdater } = await loadSdk()
    fetchState.handler = async (_url, init) => {
      expect(readJsonBody({ url: '', init }).deviceId).toBe('ios-vendor-1')
      return Response.json({ ok: true })
    }

    const updater = await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
    })

    await waitForFetchCalls(1)

    expect(await updater.getDeviceId()).toBe('ios-vendor-1')
    expect(applicationState.getIosIdForVendorCalls).toBe(1)
    expect(asyncStorageState.setItemCalls.filter(call => call.key === 'otalan-device-id')).toEqual([
      { key: 'otalan-device-id', value: 'ios-vendor-1' },
    ])
    expect(fetchState.calls).toHaveLength(1)
  })

  test('persists the Android platform id when storage is empty', async () => {
    expoState.platformOs = 'android'

    const { initializeUpdater } = await loadSdk()
    fetchState.handler = async (_url, init) => {
      expect(readJsonBody({ url: '', init }).deviceId).toBe('android-device-1')
      return Response.json({ ok: true })
    }

    const updater = await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
    })

    await waitForFetchCalls(1)

    expect(await updater.getDeviceId()).toBe('android-device-1')
    expect(applicationState.getAndroidIdCalls).toBe(1)
    expect(asyncStorageState.getItemCalls.filter(key => key === 'otalan-device-id')).toEqual(['otalan-device-id'])
    expect(asyncStorageState.setItemCalls.filter(call => call.key === 'otalan-device-id')).toEqual([
      { key: 'otalan-device-id', value: 'android-device-1' },
    ])
    expect(fetchState.calls).toHaveLength(1)
  })

  test('does not rewrite storage when it already matches the Android platform id', async () => {
    expoState.platformOs = 'android'
    asyncStorageState.storedItems.set('otalan-device-id', 'android-device-1')

    const { initializeUpdater } = await loadSdk()
    fetchState.handler = async (_url, init) => {
      expect(readJsonBody({ url: '', init }).deviceId).toBe('android-device-1')
      return Response.json({ ok: true })
    }

    const updater = await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
    })

    await waitForFetchCalls(1)

    expect(await updater.getDeviceId()).toBe('android-device-1')
    expect(applicationState.getAndroidIdCalls).toBe(1)
    expect(asyncStorageState.getItemCalls.filter(key => key === 'otalan-device-id')).toEqual(['otalan-device-id'])
    expect(asyncStorageState.setItemCalls.filter(call => call.key === 'otalan-device-id')).toHaveLength(0)
    expect(fetchState.calls).toHaveLength(1)
  })

  test('migrates stored generated device ids to the Android platform id', async () => {
    expoState.platformOs = 'android'
    asyncStorageState.storedItems.set('otalan-device-id', 'otalan-expo-old-android')

    const { initializeUpdater } = await loadSdk()
    fetchState.handler = async (_url, init) => {
      expect(readJsonBody({ url: '', init }).deviceId).toBe('android-device-1')
      return Response.json({ ok: true })
    }

    const updater = await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
    })

    await waitForFetchCalls(1)

    expect(await updater.getDeviceId()).toBe('android-device-1')
    expect(applicationState.getAndroidIdCalls).toBe(1)
    expect(asyncStorageState.getItemCalls.filter(key => key === 'otalan-device-id')).toEqual(['otalan-device-id'])
    expect(asyncStorageState.setItemCalls.filter(call => call.key === 'otalan-device-id')).toEqual([
      { key: 'otalan-device-id', value: 'android-device-1' },
    ])
    expect(fetchState.calls).toHaveLength(1)
  })

  test('uses the Android platform id when storage read fails', async () => {
    expoState.platformOs = 'android'
    asyncStorageState.getItemError = new Error('storage read failed')

    const {
      OTALAN_EXPO_SDK_NAME,
      OTALAN_EXPO_SDK_VERSION,
      initializeUpdater,
    } = await loadSdk()
    const logger = createLogger()

    fetchState.handler = async (_url, init) => {
      expect(readJsonBody({ url: '', init }).deviceId).toBe('android-device-1')
      return Response.json({ ok: true })
    }

    const updater = await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      logger: logger.logger,
    })

    await waitForFetchCalls(1)

    expect(await updater.getDeviceId()).toBe('android-device-1')
    expect(applicationState.getAndroidIdCalls).toBe(1)
    expect(asyncStorageState.setItemCalls.filter(call => call.key === 'otalan-device-id')).toEqual([
      { key: 'otalan-device-id', value: 'android-device-1' },
    ])
    expect(logger.warnCalls).toEqual([
      [
        'Otalan device ID storage read failed.',
        {
          sdkName: OTALAN_EXPO_SDK_NAME,
          sdkVersion: OTALAN_EXPO_SDK_VERSION,
          name: 'Error',
          message: 'storage read failed',
        },
      ],
    ])
    expect(fetchState.calls).toHaveLength(1)
  })

  test('continues with the Android platform id when storage migration fails', async () => {
    expoState.platformOs = 'android'
    asyncStorageState.setItemError = new Error('storage write failed')

    const {
      OTALAN_EXPO_SDK_NAME,
      OTALAN_EXPO_SDK_VERSION,
      initializeUpdater,
    } = await loadSdk()
    const logger = createLogger()

    fetchState.handler = async (_url, init) => {
      expect(readJsonBody({ url: '', init }).deviceId).toBe('android-device-1')
      return Response.json({ ok: true })
    }

    const updater = await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      logger: logger.logger,
    })

    await waitForFetchCalls(1)

    expect(await updater.getDeviceId()).toBe('android-device-1')
    expect(updater.getUpdater()).not.toBeNull()
    expect(logger.warnCalls).toEqual([
      [
        'Otalan device ID storage migration failed.',
        {
          sdkName: OTALAN_EXPO_SDK_NAME,
          sdkVersion: OTALAN_EXPO_SDK_VERSION,
          name: 'Error',
          message: 'storage write failed',
        },
      ],
    ])
    expect(fetchState.calls).toHaveLength(1)
  })

  test('falls back to stored device ids when Android platform id is unavailable', async () => {
    expoState.platformOs = 'android'
    applicationState.androidId = null
    asyncStorageState.storedItems.set('otalan-device-id', 'stored-android-device')

    const { initializeUpdater } = await loadSdk()
    fetchState.handler = async (_url, init) => {
      expect(readJsonBody({ url: '', init }).deviceId).toBe('stored-android-device')
      return Response.json({ ok: true })
    }

    const updater = await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
    })

    await waitForFetchCalls(1)

    expect(await updater.getDeviceId()).toBe('stored-android-device')
    expect(applicationState.getAndroidIdCalls).toBe(1)
    expect(asyncStorageState.setItemCalls.filter(call => call.key === 'otalan-device-id')).toHaveLength(0)
    expect(fetchState.calls).toHaveLength(1)
  })

  test('falls back to stored device ids when Android platform lookup fails', async () => {
    expoState.platformOs = 'android'
    applicationState.getAndroidIdError = new Error('android id unavailable')
    asyncStorageState.storedItems.set('otalan-device-id', 'otalan-expo-old-android')

    const {
      OTALAN_EXPO_SDK_NAME,
      OTALAN_EXPO_SDK_VERSION,
      initializeUpdater,
    } = await loadSdk()
    const logger = createLogger()

    fetchState.handler = async (_url, init) => {
      expect(readJsonBody({ url: '', init }).deviceId).toBe('otalan-expo-old-android')
      return Response.json({ ok: true })
    }

    const updater = await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      logger: logger.logger,
    })

    await waitForFetchCalls(1)

    expect(await updater.getDeviceId()).toBe('otalan-expo-old-android')
    expect(applicationState.getAndroidIdCalls).toBe(1)
    expect(asyncStorageState.setItemCalls.filter(call => call.key === 'otalan-device-id')).toHaveLength(0)
    expect(logger.warnCalls).toEqual([
      [
        'Otalan Android device ID lookup failed.',
        {
          sdkName: OTALAN_EXPO_SDK_NAME,
          sdkVersion: OTALAN_EXPO_SDK_VERSION,
          name: 'Error',
          message: 'android id unavailable',
        },
      ],
    ])
    expect(fetchState.calls).toHaveLength(1)
  })

  test('reads device id from custom storage on iOS when vendor id is unavailable', async () => {
    const storageCalls = {
      getItem: [] as string[],
      setItem: [] as Array<{ key: string; value: string }>,
    }

    const { initializeUpdater } = await loadSdk()
    fetchState.handler = async (_url, init) => {
      expect(readJsonBody({ url: '', init }).deviceId).toBe('custom-device-1')
      return Response.json({ ok: true })
    }

    const updater = await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceIdStorage: {
        getItem: async (key) => {
          storageCalls.getItem.push(key)
          return 'custom-device-1'
        },
        setItem: async (key, value) => {
          storageCalls.setItem.push({ key, value })
        },
      },
      deviceIdStorageKey: 'custom-device-key',
    })

    await waitForFetchCalls(1)

    expect(await updater.getDeviceId()).toBe('custom-device-1')
    expect(storageCalls.getItem).toEqual(['custom-device-key'])
    expect(storageCalls.setItem).toHaveLength(0)
    expect(asyncStorageState.getItemCalls).not.toContain('custom-device-key')
    expect(fetchState.calls).toHaveLength(1)
  })

  test('replaces custom stored device ids with the Android platform id', async () => {
    expoState.platformOs = 'android'
    const storageCalls = {
      getItem: [] as string[],
      setItem: [] as Array<{ key: string; value: string }>,
    }

    const { initializeUpdater } = await loadSdk()
    fetchState.handler = async (_url, init) => {
      expect(readJsonBody({ url: '', init }).deviceId).toBe('android-device-1')
      return Response.json({ ok: true })
    }

    const updater = await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceIdStorage: {
        getItem: async (key) => {
          storageCalls.getItem.push(key)
          return 'custom-device-android'
        },
        setItem: async (key, value) => {
          storageCalls.setItem.push({ key, value })
        },
      },
      deviceIdStorageKey: 'custom-device-key',
    })

    await waitForFetchCalls(1)

    expect(await updater.getDeviceId()).toBe('android-device-1')
    expect(applicationState.getAndroidIdCalls).toBe(1)
    expect(storageCalls.getItem).toEqual(['custom-device-key'])
    expect(storageCalls.setItem).toEqual([
      { key: 'custom-device-key', value: 'android-device-1' },
    ])
    expect(fetchState.calls).toHaveLength(1)
  })

  test('sync sends the Android platform id through Expo extra params when storage has an old id', async () => {
    expoState.platformOs = 'android'
    expoState.isEmbeddedLaunch = true
    asyncStorageState.storedItems.set('otalan-device-id', 'otalan-expo-old-android')

    const {
      OTALAN_EXPO_DEVICE_ID_EXTRA_PARAM_KEY,
      initializeUpdater,
    } = await loadSdk()

    const updater = await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
    })

    await expect(updater.sync()).resolves.toBe(true)

    expect(await updater.getDeviceId()).toBe('android-device-1')
    expect(expoState.extraParamCalls).toEqual([
      { key: OTALAN_EXPO_DEVICE_ID_EXTRA_PARAM_KEY, value: 'android-device-1' },
    ])
    expect(expoState.requestHeaderOverrideCalls).toEqual([
      { 'x-api-key': 'otalan_ota_xxx' },
    ])
    expect(expoState.requestHeaderOverrideCalls[0]).not.toHaveProperty('x-device-id')
    expect(expoState.checkCalls).toBe(1)
    expect(expoState.fetchCalls).toBe(1)
    expect(expoState.reloadCalls).toBe(1)
  })

  test('sync uses an explicit device id before platform and storage ids', async () => {
    expoState.platformOs = 'android'
    expoState.isEmbeddedLaunch = true
    asyncStorageState.storedItems.set('otalan-device-id', 'stale-storage-device')

    const {
      OTALAN_EXPO_DEVICE_ID_EXTRA_PARAM_KEY,
      initializeUpdater,
    } = await loadSdk()

    const updater = await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'explicit-device',
    })

    await expect(updater.sync()).resolves.toBe(true)

    expect(await updater.getDeviceId()).toBe('explicit-device')
    expect(applicationState.getAndroidIdCalls).toBe(0)
    expect(asyncStorageState.getItemCalls).not.toContain('otalan-device-id')
    expect(expoState.extraParamCalls).toEqual([
      { key: OTALAN_EXPO_DEVICE_ID_EXTRA_PARAM_KEY, value: 'explicit-device' },
    ])
  })

  test('sync sends the stored iOS id when the vendor id is unavailable', async () => {
    expoState.isEmbeddedLaunch = true
    asyncStorageState.storedItems.set('otalan-device-id', 'otalan-expo-old-ios')

    const {
      OTALAN_EXPO_DEVICE_ID_EXTRA_PARAM_KEY,
      initializeUpdater,
    } = await loadSdk()

    const updater = await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
    })

    await expect(updater.sync()).resolves.toBe(true)

    expect(await updater.getDeviceId()).toBe('otalan-expo-old-ios')
    expect(applicationState.getIosIdForVendorCalls).toBe(1)
    expect(asyncStorageState.setItemCalls.filter(call => call.key === 'otalan-device-id')).toHaveLength(0)
    expect(expoState.extraParamCalls).toEqual([
      { key: OTALAN_EXPO_DEVICE_ID_EXTRA_PARAM_KEY, value: 'otalan-expo-old-ios' },
    ])
  })
})
