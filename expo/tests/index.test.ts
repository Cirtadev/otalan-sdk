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
  extraParamCalls: [] as Array<{ key: string; value: string | null | undefined }>,
  extraParamError: null as Error | null,
  requestHeaderOverrideCalls: [] as Array<Record<string, string> | null>,
  requestHeaderOverrideError: null as Error | null,
  checkCalls: 0,
  fetchCalls: 0,
  reloadCalls: 0,
  checkError: null as Error | null,
  fetchError: null as Error | null,
  reloadError: null as Error | null,
  checkResult: {
    isAvailable: true,
    isRollBackToEmbedded: false,
  },
  fetchResult: {
    isNew: true,
    isRollBackToEmbedded: false,
  },
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
    setExtraParamAsync: async (key: string, value: string | null | undefined) => {
      expoState.extraParamCalls.push({ key, value })

      if (expoState.extraParamError) {
        throw expoState.extraParamError
      }
    },
    setUpdateRequestHeadersOverride: (headers: Record<string, string> | null) => {
      expoState.requestHeaderOverrideCalls.push(headers)

      if (expoState.requestHeaderOverrideError) {
        throw expoState.requestHeaderOverrideError
      }
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

      if (expoState.fetchError) {
        throw expoState.fetchError
      }

      return expoState.fetchResult
    },
    reloadAsync: async () => {
      expoState.reloadCalls += 1

      if (expoState.reloadError) {
        throw expoState.reloadError
      }
    },
  }))

  mock.module('expo-application', () => ({
    getAndroidId: () => null,
    getIosIdForVendorAsync: async () => null,
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

function createExpectedExpoSyncLogContext(
  sdkName: string,
  sdkVersion: string,
  extra: Record<string, unknown>,
) {
  return {
    sdkName,
    sdkVersion,
    platform: expoState.platformOs,
    expoUpdates: {
      isEnabled: expoState.isEnabled,
      isEmbeddedLaunch: expoState.isEmbeddedLaunch,
      isEmergencyLaunch: expoState.isEmergencyLaunch,
      runtimeVersion: expoState.runtimeVersion,
      updateId: expoState.updateId,
    },
    ...extra,
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
  expoState.extraParamCalls = []
  expoState.extraParamError = null
  expoState.requestHeaderOverrideCalls = []
  expoState.requestHeaderOverrideError = null
  expoState.checkCalls = 0
  expoState.fetchCalls = 0
  expoState.reloadCalls = 0
  expoState.checkError = null
  expoState.fetchError = null
  expoState.reloadError = null
  expoState.checkResult = {
    isAvailable: true,
    isRollBackToEmbedded: false,
  }
  expoState.fetchResult = {
    isNew: true,
    isRollBackToEmbedded: false,
  }

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
    fetchState.handler = async (url) => {
      if (url.endsWith('/expo/report-update-event')) {
        return new Response(null, { status: 204 })
      }

      return Response.json({ message: 'app is archived' }, { status: 403 })
    }

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

  test('initialized sync sets Otalan update request context internally and reloads fetched updates', async () => {
    expoState.isEmbeddedLaunch = true

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
    })
    const deviceId = await updater.getDeviceId()

    await expect(updater.sync()).resolves.toBe(true)

    expect(expoState.extraParamCalls).toEqual([
      { key: OTALAN_EXPO_DEVICE_ID_EXTRA_PARAM_KEY, value: deviceId },
      { key: OTALAN_EXPO_BLOCKED_BUNDLE_IDS_EXTRA_PARAM_KEY, value: null },
      { key: OTALAN_EXPO_ROLLBACK_TARGET_BUNDLE_ID_EXTRA_PARAM_KEY, value: null },
    ])
    expect(expoState.requestHeaderOverrideCalls).toEqual([
      {
        'x-api-key': 'otalan_ota_xxx',
        'x-otalan-blocked-bundle-ids': '',
        'x-otalan-rollback-target-bundle-id': '',
      },
    ])
    expect(expoState.requestHeaderOverrideCalls[0]).not.toHaveProperty('x-device-id')
    expect(expoState.checkCalls).toBe(1)
    expect(expoState.fetchCalls).toBe(1)
    expect(expoState.reloadCalls).toBe(1)
  })

  test('initialized sync returns false without fetching when no update is available', async () => {
    expoState.isEmbeddedLaunch = true
    expoState.checkResult = {
      isAvailable: false,
      isRollBackToEmbedded: false,
    }

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

    await expect(updater.sync()).resolves.toBe(false)

    expect(logger.warnCalls).toEqual([
      [
        'Otalan Expo sync found no available update.',
        createExpectedExpoSyncLogContext(OTALAN_EXPO_SDK_NAME, OTALAN_EXPO_SDK_VERSION, {
          update: {
            isAvailable: false,
            isRollBackToEmbedded: false,
          },
        }),
      ],
    ])
    expect(expoState.checkCalls).toBe(1)
    expect(expoState.fetchCalls).toBe(0)
    expect(expoState.reloadCalls).toBe(0)
  })

  test('initialized sync logs when fetch returns no new update', async () => {
    expoState.isEmbeddedLaunch = true
    expoState.fetchResult = {
      isNew: false,
      isRollBackToEmbedded: false,
    }

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
      deviceId: 'device-1',
      logger: logger.logger,
    })

    await expect(updater.sync()).resolves.toBe(false)

    expect(logger.warnCalls).toEqual([
      [
        'Otalan Expo sync fetch returned no new update.',
        createExpectedExpoSyncLogContext(OTALAN_EXPO_SDK_NAME, OTALAN_EXPO_SDK_VERSION, {
          fetchResult: {
            isNew: false,
            isRollBackToEmbedded: false,
          },
        }),
      ],
    ])
    expect(expoState.checkCalls).toBe(1)
    expect(expoState.fetchCalls).toBe(1)
    expect(expoState.reloadCalls).toBe(0)
  })

  test('initialized sync continues when Expo update extra params are unavailable', async () => {
    expoState.isEmbeddedLaunch = true
    expoState.extraParamError = new Error('extra params unavailable')

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

    await expect(updater.sync()).resolves.toBe(true)

    expect(logger.warnCalls).toEqual([
      [
        'Otalan Expo update device ID extra param failed.',
        {
          sdkName: OTALAN_EXPO_SDK_NAME,
          sdkVersion: OTALAN_EXPO_SDK_VERSION,
          name: 'Error',
          message: 'extra params unavailable',
        },
      ],
      [
        'Otalan Expo rollback protection extra param failed.',
        {
          sdkName: OTALAN_EXPO_SDK_NAME,
          sdkVersion: OTALAN_EXPO_SDK_VERSION,
          name: 'Error',
          message: 'extra params unavailable',
        },
      ],
    ])
    expect(expoState.checkCalls).toBe(1)
    expect(expoState.fetchCalls).toBe(1)
    expect(expoState.reloadCalls).toBe(1)
  })

  test('initialized sync continues when Expo update header override is unavailable', async () => {
    expoState.isEmbeddedLaunch = true
    expoState.requestHeaderOverrideError = new Error('request headers unavailable')

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

    await expect(updater.sync()).resolves.toBe(true)

    expect(logger.warnCalls).toEqual([
      [
        'Otalan Expo update request header override failed.',
        {
          sdkName: OTALAN_EXPO_SDK_NAME,
          sdkVersion: OTALAN_EXPO_SDK_VERSION,
          name: 'Error',
          message: 'request headers unavailable',
        },
      ],
    ])
    expect(expoState.requestHeaderOverrideCalls).toEqual([
      {
        'x-api-key': 'otalan_ota_xxx',
        'x-otalan-blocked-bundle-ids': '',
        'x-otalan-rollback-target-bundle-id': '',
      },
    ])
    expect(expoState.checkCalls).toBe(1)
    expect(expoState.fetchCalls).toBe(1)
    expect(expoState.reloadCalls).toBe(1)
  })

  test('initialized sync logs Expo update failures and returns false', async () => {
    expoState.isEmbeddedLaunch = true
    expoState.checkError = new Error('check failed')

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
      deviceId: 'device-1',
      logger: logger.logger,
    })

    await expect(updater.sync()).resolves.toBe(false)
    await waitForFetchCalls(1)

    expect(logger.warnCalls).toEqual([
      [
        'Otalan Expo sync failed.',
        createExpectedExpoSyncLogContext(OTALAN_EXPO_SDK_NAME, OTALAN_EXPO_SDK_VERSION, {
          error: {
            sdkName: OTALAN_EXPO_SDK_NAME,
            sdkVersion: OTALAN_EXPO_SDK_VERSION,
            name: 'Error',
            message: 'check failed',
          },
        }),
      ],
    ])
    expect(fetchState.calls[0]?.url).toBe('https://api.otalan.com/expo/report-update-event')
    expect(readJsonBody(fetchState.calls[0]!)).toMatchObject({
      appId: 'com.example.app',
      platform: 'ios',
      channel: 'production',
      runtimeVersion: '1.0.0',
      deviceId: 'device-1',
      currentBundleId: 'bundle-1',
      phase: 'check',
      category: 'check_failed',
      errorType: 'expo-updates-error',
      errorMessage: 'check failed',
      sdkName: OTALAN_EXPO_SDK_NAME,
      sdkVersion: OTALAN_EXPO_SDK_VERSION,
    })
    expect(readJsonBody(fetchState.calls[0]!).eventId).toEqual(expect.any(String))
    expect(expoState.fetchCalls).toBe(0)
    expect(expoState.reloadCalls).toBe(0)
  })

  test('initialized sync reports Expo fetch failures as apply failures with target context', async () => {
    expoState.isEmbeddedLaunch = true
    expoState.checkResult = {
      isAvailable: true,
      isRollBackToEmbedded: false,
      manifest: createExpoManifest({
        metadata: {
          bundleId: 'bundle-2',
          channel: 'production',
        },
        extra: {
          otalan: {
            bundleId: 'bundle-2',
            runtimeVersion: '1.0.0',
          },
        },
      }),
    } as typeof expoState.checkResult
    expoState.fetchError = new Error('fetch failed')

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
      deviceId: 'device-1',
      logger: logger.logger,
    })

    await expect(updater.sync()).resolves.toBe(false)
    await waitForFetchCalls(1)

    expect(fetchState.calls[0]?.url).toBe('https://api.otalan.com/expo/report-update-event')
    expect(readJsonBody(fetchState.calls[0]!)).toMatchObject({
      appId: 'com.example.app',
      platform: 'ios',
      channel: 'production',
      runtimeVersion: '1.0.0',
      deviceId: 'device-1',
      currentBundleId: 'bundle-1',
      targetBundleId: 'bundle-2',
      phase: 'fetch',
      category: 'apply_failed',
      errorType: 'fetch-failed',
      errorMessage: 'fetch failed',
      sdkName: OTALAN_EXPO_SDK_NAME,
      sdkVersion: OTALAN_EXPO_SDK_VERSION,
    })
    expect(expoState.reloadCalls).toBe(0)
  })

  test('initialized sync reports Expo reload failures as apply failures with target context', async () => {
    expoState.isEmbeddedLaunch = true
    expoState.checkResult = {
      isAvailable: true,
      isRollBackToEmbedded: false,
      manifest: createExpoManifest({
        metadata: {
          bundleId: 'bundle-2',
          channel: 'production',
        },
        extra: {
          otalan: {
            bundleId: 'bundle-2',
            runtimeVersion: '1.0.0',
          },
        },
      }),
    } as typeof expoState.checkResult
    expoState.reloadError = new Error('reload failed')

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
      deviceId: 'device-1',
      logger: logger.logger,
    })

    await expect(updater.sync()).resolves.toBe(false)
    await waitForFetchCalls(1)

    expect(fetchState.calls[0]?.url).toBe('https://api.otalan.com/expo/report-update-event')
    expect(readJsonBody(fetchState.calls[0]!)).toMatchObject({
      appId: 'com.example.app',
      platform: 'ios',
      channel: 'production',
      runtimeVersion: '1.0.0',
      deviceId: 'device-1',
      currentBundleId: 'bundle-1',
      targetBundleId: 'bundle-2',
      phase: 'reload',
      category: 'apply_failed',
      errorType: 'reload-failed',
      errorMessage: 'reload failed',
      sdkName: OTALAN_EXPO_SDK_NAME,
      sdkVersion: OTALAN_EXPO_SDK_VERSION,
    })
    expect(expoState.fetchCalls).toBe(1)
    expect(expoState.reloadCalls).toBe(1)
  })

  test('initializeUpdater no-ops when required config is empty', async () => {
    const {
      OTALAN_EXPO_SDK_NAME,
      OTALAN_EXPO_SDK_VERSION,
      initializeUpdater,
    } = await loadSdk()
    const logger = createLogger()

    const updater = await initializeUpdater({
      apiUrl: '',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      logger: logger.logger,
    })

    expect(updater.getUpdater()).toBeNull()
    expect(await updater.getDeviceId()).toBeNull()
    expect(await updater.ready()).toBeNull()
    expect(await updater.sync()).toBe(false)
    expect(logger.warnCalls).toEqual([
      [
        'Otalan Expo sync skipped.',
        createExpectedExpoSyncLogContext(OTALAN_EXPO_SDK_NAME, OTALAN_EXPO_SDK_VERSION, {
          reason: 'missing-api-url',
          hasDeviceId: false,
          hasUpdater: false,
        }),
      ],
    ])
    expect(asyncStorageState.getItemCalls).toHaveLength(0)
    expect(asyncStorageState.setItemCalls).toHaveLength(0)
    expect(fetchState.calls).toHaveLength(0)
  })

  test('initializeUpdater no-ops when required channel is empty', async () => {
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
      channel: '',
      logger: logger.logger,
    })

    expect(updater.getUpdater()).toBeNull()
    expect(await updater.getDeviceId()).toBeNull()
    expect(await updater.ready()).toBeNull()
    expect(await updater.sync()).toBe(false)
    expect(logger.warnCalls).toEqual([
      [
        'Otalan Expo sync skipped.',
        createExpectedExpoSyncLogContext(OTALAN_EXPO_SDK_NAME, OTALAN_EXPO_SDK_VERSION, {
          reason: 'missing-channel',
          hasDeviceId: false,
          hasUpdater: false,
        }),
      ],
    ])
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
    expect(await updater.sync()).toBe(false)
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
      [
        'Otalan Expo sync skipped.',
        createExpectedExpoSyncLogContext(OTALAN_EXPO_SDK_NAME, OTALAN_EXPO_SDK_VERSION, {
          reason: 'missing-device-id',
          hasDeviceId: false,
          hasUpdater: false,
        }),
      ],
    ])
  })
})
