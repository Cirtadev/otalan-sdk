import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

// -----------------------------------------------------------------------------
// Mock State
// -----------------------------------------------------------------------------

type FetchCall = {
  url: string
  init?: RequestInit
}

const asyncStorageState = {
  getItemCalls: [] as string[],
  setItemCalls: [] as Array<{ key: string; value: string }>,
  storedValue: null as string | null,
  getItemError: null as Error | null,
  setItemError: null as Error | null,
}

const expoState = {
  platformOs: 'ios' as 'ios' | 'android' | 'web',
  isEnabled: true,
  isEmbeddedLaunch: false,
  isEmergencyLaunch: false,
  runtimeVersion: '1.0.0',
  updateId: 'update-1' as string | undefined,
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

        return asyncStorageState.storedValue
      },
      setItem: async (key: string, value: string) => {
        asyncStorageState.setItemCalls.push({ key, value })

        if (asyncStorageState.setItemError) {
          throw asyncStorageState.setItemError
        }

        asyncStorageState.storedValue = value
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

beforeEach(() => {
  asyncStorageState.getItemCalls = []
  asyncStorageState.setItemCalls = []
  asyncStorageState.storedValue = null
  asyncStorageState.getItemError = null
  asyncStorageState.setItemError = null

  expoState.platformOs = 'ios'
  expoState.isEnabled = true
  expoState.isEmbeddedLaunch = false
  expoState.isEmergencyLaunch = false
  expoState.runtimeVersion = '1.0.0'
  expoState.updateId = 'update-1'

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
      deviceId: 'device-1',
      headers: [
        ['x-api-key', 'should-not-override-configured-key'],
        ['x-custom-header', 'custom-value'],
      ],
    })

    const result = await updater.confirmCurrentUpdate()

    expect(result.confirmed).toBe(true)
    expect(result.transferSource).toBe('downloaded')
    expect(fetchState.calls).toHaveLength(1)
    expect(readJsonBody(fetchState.calls[0]!)).toEqual({
      appId: 'com.example.app',
      platform: 'ios',
      updateId: 'update-1',
      runtimeVersion: '1.0.0',
      deviceId: 'device-1',
      transferSource: 'downloaded',
    })
  })

  test('confirmCurrentUpdate includes request context when the API rejects the request', async () => {
    fetchState.handler = async () => Response.json({ message: 'invalid OTA key' }, { status: 401 })

    const { createUpdater } = await loadSdk()
    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      deviceId: 'device-1',
    })

    await expect(updater.confirmCurrentUpdate()).rejects.toThrow(
      'POST https://api.otalan.com/expo/confirm failed with status 401: invalid OTA key',
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
      deviceId: 'device-1',
    })

    await expect(updater.confirmCurrentUpdate()).rejects.toThrow(
      'POST https://api.otalan.com/expo/confirm failed before response: Load failed',
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
      deviceId: 'device-1',
      logger: logger.logger,
    })

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
      deviceId: 'device-1',
    })
    const { confirmCurrentUpdate, ready } = updater

    const confirmed = await confirmCurrentUpdate()
    const readyResult = await ready()

    expect(confirmed.confirmed).toBe(true)
    expect(readyResult.confirmed).toBe(true)
    expect(fetchState.calls).toHaveLength(1)
  })

  test('confirmCurrentUpdate skips emergency launches', async () => {
    expoState.isEmergencyLaunch = true

    const { createUpdater } = await loadSdk()
    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      deviceId: 'device-1',
    })

    const result = await updater.confirmCurrentUpdate()

    expect(result).toEqual({
      enabled: true,
      confirmed: false,
      isEmbeddedLaunch: false,
      isEmergencyLaunch: true,
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
      deviceId: 'device-1',
    })

    const first = updater.confirmCurrentUpdate()
    const second = updater.confirmCurrentUpdate()

    await Promise.resolve()
    expect(fetchState.calls).toHaveLength(1)

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
    })

    expect(asyncStorageState.getItemCalls).toEqual(['otalan-device-id'])
    expect(asyncStorageState.setItemCalls).toHaveLength(1)
    expect(asyncStorageState.setItemCalls[0]?.key).toBe('otalan-device-id')
    expect(asyncStorageState.setItemCalls[0]?.value.startsWith('otalan-expo-')).toBe(true)
    expect(await updater.getDeviceId()).toBe(asyncStorageState.storedValue)
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

    expect(await updater.getDeviceId()).toBe('custom-device-1')
    expect(storageCalls.getItem).toEqual(['custom-device-key'])
    expect(storageCalls.setItem).toHaveLength(0)
    expect(asyncStorageState.getItemCalls).toHaveLength(0)
    expect(fetchState.calls).toHaveLength(1)
  })

  test('initializeUpdater no-ops when required credentials are empty', async () => {
    const { initializeUpdater } = await loadSdk()

    const updater = await initializeUpdater({
      apiUrl: '',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
    })

    expect(updater.getUpdater()).toBeNull()
    expect(await updater.getDeviceId()).toBeNull()
    expect(await updater.ready()).toBeNull()
    expect(asyncStorageState.getItemCalls).toHaveLength(0)
    expect(asyncStorageState.setItemCalls).toHaveLength(0)
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
