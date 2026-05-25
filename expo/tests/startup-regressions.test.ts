import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

// -----------------------------------------------------------------------------
// Mock State
// -----------------------------------------------------------------------------

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
  setItemError: null as Error | null,
}

const expoState = {
  platformOs: 'ios' as 'ios' | 'android' | 'web',
  isEnabled: true,
  isEmbeddedLaunch: false,
  isEmergencyLaunch: false,
  runtimeVersion: '1.0.0',
  updateId: 'update-1' as string | undefined,
  manifest: createExpoManifest(),
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

function applyModuleMocks() {
  mock.module('@react-native-async-storage/async-storage', () => ({
    default: {
      getItem: async (key: string) => {
        asyncStorageState.getItemCalls.push(key)
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
    setExtraParamAsync: async () => {},
  }))
}

// -----------------------------------------------------------------------------
// Test Helpers
// -----------------------------------------------------------------------------

let importCounter = 0
const originalFetch = globalThis.fetch

async function loadSdk() {
  importCounter += 1
  applyModuleMocks()
  return import(`../src/index?startup-regressions=${importCounter}`)
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

function readJsonBody(call: FetchCall) {
  return JSON.parse(String(call.init?.body)) as Record<string, unknown>
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
  asyncStorageState.setItemError = null

  expoState.platformOs = 'ios'
  expoState.isEnabled = true
  expoState.isEmbeddedLaunch = false
  expoState.isEmergencyLaunch = false
  expoState.runtimeVersion = '1.0.0'
  expoState.updateId = 'update-1'
  expoState.manifest = createExpoManifest()

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
})

afterAll(() => {
  globalThis.fetch = originalFetch
})

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('@otalan/expo startup regressions', () => {
  test('initializeUpdater uses an explicit device ID without touching storage', async () => {
    const { initializeUpdater } = await loadSdk()

    await initializeUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'explicit-device',
    })

    await waitForFetchCalls(1)

    expect(asyncStorageState.getItemCalls).not.toContain('otalan-device-id')
    expect(asyncStorageState.setItemCalls.map(call => call.key)).not.toContain('otalan-device-id')
    expect(fetchState.calls).toHaveLength(1)
    expect(readJsonBody(fetchState.calls[0]!)).toMatchObject({
      channel: 'production',
      deviceId: 'explicit-device',
      transferSource: 'downloaded',
    })
  })

  test('initializeUpdater logs storage write failures and returns a no-op updater', async () => {
    asyncStorageState.setItemError = new Error('storage write failed')

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
    expect(await updater.ready()).toBeNull()
    expect(fetchState.calls).toHaveLength(0)
    expect(logger.warnCalls).toEqual([
      [
        'Otalan device ID initialization failed.',
        {
          sdkName: OTALAN_EXPO_SDK_NAME,
          sdkVersion: OTALAN_EXPO_SDK_VERSION,
          name: 'Error',
          message: 'storage write failed',
        },
      ],
    ])
  })

  test('confirmCurrentUpdate retries after a failed concurrent confirmation', async () => {
    let confirmAttempts = 0
    fetchState.handler = async () => {
      confirmAttempts += 1

      if (confirmAttempts === 1) {
        return Response.json({ message: 'confirm failed' }, { status: 500 })
      }

      return Response.json({ ok: true })
    }

    const { createUpdater } = await loadSdk()
    const updater = createUpdater({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'otalan_ota_xxx',
      appId: 'com.example.app',
      channel: 'production',
      deviceId: 'device-1',
    })

    const first = updater.confirmCurrentUpdate().catch((error: unknown) => error)
    const second = updater.confirmCurrentUpdate().catch((error: unknown) => error)

    await expect(first).resolves.toMatchObject({
      message: 'POST https://api.otalan.com/expo/confirm failed with status 500: confirm failed',
    })
    await expect(second).resolves.toMatchObject({
      message: 'POST https://api.otalan.com/expo/confirm failed with status 500: confirm failed',
    })

    await expect(updater.confirmCurrentUpdate()).resolves.toMatchObject({
      confirmed: true,
      transferSource: 'downloaded',
    })
    expect(fetchState.calls).toHaveLength(2)
  })
})
