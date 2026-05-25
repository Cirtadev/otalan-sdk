import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

// -----------------------------------------------------------------------------
// Mock State
// -----------------------------------------------------------------------------

type FetchCall = {
  url: string
  init?: RequestInit
}

function createExpoManifest(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
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
}

const applicationState = {
  androidId: 'android-device-1' as string | null,
  getAndroidIdCalls: 0,
  getAndroidIdError: null as Error | null,
}

const fetchState = {
  calls: [] as FetchCall[],
  handler: async (url: string, init?: RequestInit) => {
    void url
    void init
    return Response.json({ ok: true })
  },
}

// -----------------------------------------------------------------------------
// Module Mocks
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// Test Helpers
// -----------------------------------------------------------------------------

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
  }))

  mock.module('expo-application', () => ({
    getAndroidId: () => {
      applicationState.getAndroidIdCalls += 1

      if (applicationState.getAndroidIdError) {
        throw applicationState.getAndroidIdError
      }

      return applicationState.androidId
    },
  }))
}

async function loadSdk() {
  importCounter += 1
  applyModuleMocks()
  return import(`../src/index?test=${importCounter}`)
}

function readHeader(headers: HeadersInit | undefined, name: string) {
  return new Headers(headers).get(name)
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
  await waitForCondition(
    () => fetchState.calls.length >= count,
    `Expected at least ${count} fetch call(s), received ${fetchState.calls.length}.`,
  )
}

async function waitForWarnCalls(warnCalls: unknown[][], count: number) {
  await waitForCondition(
    () => warnCalls.length >= count,
    `Expected at least ${count} warning call(s), received ${warnCalls.length}.`,
  )
}

async function waitForCondition(condition: () => boolean, message: string) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    if (condition()) {
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  throw new Error(message)
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

  applicationState.androidId = 'android-device-1'
  applicationState.getAndroidIdCalls = 0
  applicationState.getAndroidIdError = null

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

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('@otalan/expo', () => {
  test('exports the package version used in native logs', async () => {
    const packageJson = await Bun.file(new URL('../package.json', import.meta.url)).json() as {
      name: string
      version: string
    }
    const {
      OTALAN_EXPO_SDK_NAME,
      OTALAN_EXPO_SDK_VERSION,
    } = await loadSdk()

    expect(OTALAN_EXPO_SDK_NAME).toBe(packageJson.name)
    expect(OTALAN_EXPO_SDK_VERSION).toBe(packageJson.version)
  })

  test('confirmCurrentUpdate supports tuple arrays in custom request headers', async () => {
    fetchState.handler = async (_url, init) => {
      expect(readHeader(init?.headers, 'content-type')).toBe('application/json')
      expect(readHeader(init?.headers, 'x-api-key')).toBe('otalan_ota_xxx')
      expect(readHeader(init?.headers, 'x-custom-header')).toBe('custom-value')

      return Response.json({ ok: true })
    }

    const { createUpdater } = await loadSdk()
    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
      headers: [
        ['x-api-key', 'should-not-override-configured-key'],
        ['x-custom-header', 'custom-value'],
      ],
    })

    const result = await updater.confirmCurrentUpdate()

    expect(result.confirmed).toBe(true)
    expect(result.bundleId).toBe('bundle-1')
    expect(result.transferSource).toBe('downloaded')
    expect(fetchState.calls).toHaveLength(1)
    expect(readJsonBody(fetchState.calls[0]!)).toEqual({
      appId: 'com.example.app',
      platform: 'ios',
      channel: 'production',
      bundleId: 'bundle-1',
      runtimeVersion: '1.0.0',
      deviceId: 'device-1',
      transferSource: 'downloaded',
    })
  })

  test('confirmCurrentUpdate includes request context when the API rejects the request', async () => {
    fetchState.handler = async () => Response.json({ message: 'invalid OTA App Key' }, { status: 401 })

    const { createUpdater } = await loadSdk()
    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
    })

    await expect(updater.confirmCurrentUpdate()).rejects.toThrow(
      'POST https://api.otalan.com/expo/confirm failed with status 401: invalid OTA App Key',
    )
  })

  test('confirmCurrentUpdate surfaces nested API error messages', async () => {
    fetchState.handler = async () => Response.json({
      error: {
        message: 'runtimeVersion is required',
      },
    }, { status: 400 })

    const { createUpdater } = await loadSdk()
    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
    })

    await expect(updater.confirmCurrentUpdate()).rejects.toThrow(
      'POST https://api.otalan.com/expo/confirm failed with status 400: runtimeVersion is required',
    )
  })

  test('confirmCurrentUpdate includes request context when fetch fails before a response', async () => {
    fetchState.handler = async () => {
      throw new TypeError('Load failed')
    }

    const { createUpdater } = await loadSdk()
    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
    })

    await expect(updater.confirmCurrentUpdate()).rejects.toThrow(
      'POST https://api.otalan.com/expo/confirm failed before response: Load failed',
    )
  })

  test('confirmCurrentUpdate times out slow confirmation requests', async () => {
    fetchState.handler = async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new Error('aborted'))
      })
    })

    const { createUpdater } = await loadSdk()
    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
      requestTimeoutMs: 1,
    })

    await expect(updater.confirmCurrentUpdate()).rejects.toThrow(
      'POST https://api.otalan.com/expo/confirm timed out after 1ms.',
    )
  })

  test('ready logs serializable confirmation errors for native consoles', async () => {
    fetchState.handler = async () => Response.json({ message: 'app is archived' }, { status: 403 })

    const logger = createLogger()
    const {
      OTALAN_EXPO_SDK_NAME,
      OTALAN_EXPO_SDK_VERSION,
      initializeUpdater,
    } = await loadSdk()

    await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
      logger: logger.logger,
    })

    await waitForWarnCalls(logger.warnCalls, 1)

    expect(logger.warnCalls).toEqual([
      [
        'Otalan install confirmation failed.',
        {
          sdkName: OTALAN_EXPO_SDK_NAME,
          sdkVersion: OTALAN_EXPO_SDK_VERSION,
          name: 'Error',
          message: 'POST https://api.otalan.com/expo/confirm failed with status 403: app is archived',
        },
      ],
    ])
  })

  test('updater methods work when destructured from the updater object', async () => {
    const { createUpdater } = await loadSdk()
    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
    })
    const { confirmCurrentUpdate, ready } = updater

    const confirmed = await confirmCurrentUpdate()
    const readyResult = await ready()

    expect(confirmed.confirmed).toBe(true)
    expect(readyResult.confirmed).toBe(true)
    expect(fetchState.calls).toHaveLength(1)
  })

  test('confirmCurrentUpdate falls back to Otalan extra manifest metadata without updateId', async () => {
    expoState.runtimeVersion = null
    expoState.updateId = undefined
    expoState.manifest = createExpoManifest({
      runtimeVersion: undefined,
      metadata: {},
      extra: {
        otalan: {
          bundleId: 'bundle-from-extra',
          runtimeVersion: '2.0.0',
          releaseNotes: null,
        },
      },
    })

    const { createUpdater } = await loadSdk()
    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
    })

    const result = await updater.confirmCurrentUpdate()

    expect(result.confirmed).toBe(true)
    expect(result.bundleId).toBe('bundle-from-extra')
    expect(result.runtimeVersion).toBe('2.0.0')
    expect(readJsonBody(fetchState.calls[0]!)).toMatchObject({
      bundleId: 'bundle-from-extra',
      runtimeVersion: '2.0.0',
    })
  })

  test('confirmCurrentUpdate skips launched updates without Otalan bundle metadata', async () => {
    expoState.manifest = createExpoManifest({
      metadata: {},
      extra: {},
    })

    const { createUpdater } = await loadSdk()
    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
    })

    const result = await updater.confirmCurrentUpdate()

    expect(result).toMatchObject({
      confirmed: false,
      updateId: 'update-1',
    })
    expect(result.bundleId).toBeUndefined()
    expect(fetchState.calls).toHaveLength(0)
  })

  test('confirmCurrentUpdate skips emergency launches', async () => {
    expoState.isEmergencyLaunch = true

    const { createUpdater } = await loadSdk()
    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
    })

    const result = await updater.confirmCurrentUpdate()

    expect(result).toEqual({
      enabled: true,
      confirmed: false,
      isEmbeddedLaunch: false,
      isEmergencyLaunch: true,
      bundleId: 'bundle-1',
      runtimeVersion: '1.0.0',
      updateId: 'update-1',
    })
    expect(fetchState.calls).toHaveLength(0)
  })

  test('confirmCurrentUpdate confirms the same update only once', async () => {
    const { createUpdater } = await loadSdk()
    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
    })

    const first = await updater.confirmCurrentUpdate()
    const second = await updater.confirmCurrentUpdate()

    expect(first.confirmed).toBe(true)
    expect(second.confirmed).toBe(true)
    expect(first.transferSource).toBe('downloaded')
    expect(second.transferSource).toBe('downloaded')
    expect(fetchState.calls).toHaveLength(1)
  })

  test('confirmCurrentUpdate skips confirmations persisted by a previous updater instance', async () => {
    const { createUpdater } = await loadSdk()
    const firstUpdater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
    })

    await firstUpdater.confirmCurrentUpdate()

    const secondUpdater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
    })

    const second = await secondUpdater.confirmCurrentUpdate()

    expect(second.confirmed).toBe(true)
    expect(fetchState.calls).toHaveLength(1)
  })

  test('confirmCurrentUpdate deduplicates concurrent confirmation calls', async () => {
    let resolveConfirm: (response: Response) => void = () => undefined
    const confirmResponse = new Promise<Response>((resolve) => {
      resolveConfirm = resolve
    })
    fetchState.handler = async () => confirmResponse

    const { createUpdater } = await loadSdk()
    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
    })

    const first = updater.confirmCurrentUpdate()
    const second = updater.confirmCurrentUpdate()

    await waitForFetchCalls(1)

    resolveConfirm(Response.json({ ok: true }))

    await expect(first).resolves.toMatchObject({
      confirmed: true,
      transferSource: 'downloaded',
    })
    await expect(second).resolves.toMatchObject({
      confirmed: true,
      transferSource: 'downloaded',
    })
    expect(fetchState.calls).toHaveLength(1)
  })

  test('initializeUpdater creates and persists a device id when one is not provided', async () => {
    Date.now = () => 1_700_000_000_000
    Math.random = () => 0.123456789

    const { initializeUpdater } = await loadSdk()
    fetchState.handler = async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        deviceId?: string
        transferSource?: string
      }

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

  test('initializeUpdater keeps an existing stored device id on iOS', async () => {
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
    expect(asyncStorageState.setItemCalls.filter(call => call.key === 'otalan-device-id')).toHaveLength(0)
    expect(fetchState.calls).toHaveLength(1)
  })

  test('initializeUpdater migrates stored generated device ids to the Android platform id', async () => {
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

  test('initializeUpdater continues with the Android platform id when storage migration fails', async () => {
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
        'Otalan Android device ID storage migration failed.',
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

  test('initializeUpdater falls back to stored device ids when Android platform lookup fails', async () => {
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

  test('initializeUpdater reads device id from custom storage', async () => {
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

  test('initializeUpdater no-ops when required config is empty', async () => {
    const { initializeUpdater } = await loadSdk()

    const updater = await initializeUpdater({
      apiUrl: '',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
    })

    expect(updater.getUpdater()).toBeNull()
    expect(await updater.getDeviceId()).toBeNull()
    expect(await updater.ready()).toBeNull()
    expect(asyncStorageState.getItemCalls).toHaveLength(0)
    expect(asyncStorageState.setItemCalls).toHaveLength(0)
    expect(fetchState.calls).toHaveLength(0)
  })

  test('initializeUpdater no-ops when required channel is empty', async () => {
    const { initializeUpdater } = await loadSdk()

    const updater = await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: '',
    })

    expect(updater.getUpdater()).toBeNull()
    expect(await updater.getDeviceId()).toBeNull()
    expect(await updater.ready()).toBeNull()
    expect(asyncStorageState.getItemCalls).toHaveLength(0)
    expect(fetchState.calls).toHaveLength(0)
  })

  test('initializeUpdater logs device ID storage failures and no-ops', async () => {
    asyncStorageState.getItemError = new Error('storage unavailable')

    const {
      OTALAN_EXPO_SDK_NAME,
      OTALAN_EXPO_SDK_VERSION,
      initializeUpdater,
    } = await loadSdk()
    const logger = createLogger()

    const updater = await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      logger: logger.logger,
    })

    expect(updater.getUpdater()).toBeNull()
    expect(await updater.getDeviceId()).toBeNull()
    expect(await updater.ready()).toBeNull()
    expect(fetchState.calls).toHaveLength(0)
    expect(logger.warnCalls).toEqual([
      [
        'Otalan device ID initialization failed.',
        {
          sdkName: OTALAN_EXPO_SDK_NAME,
          sdkVersion: OTALAN_EXPO_SDK_VERSION,
          name: 'Error',
          message: 'storage unavailable',
        },
      ],
    ])
  })
})
